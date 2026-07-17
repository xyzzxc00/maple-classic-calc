/**
 * community.js — 社群資料庫（Firebase Firestore）
 */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyBpx9FoF2kKfgv3_VCoSJHnCBRVCjLu8iM",
    authDomain: "maple-classic-calc.firebaseapp.com",
    projectId: "maple-classic-calc",
    storageBucket: "maple-classic-calc.firebasestorage.app",
    messagingSenderId: "468368517060",
    appId: "1:468368517060:web:d9c9deb8390d32089f2691",
  };

  // 免費額度用完前先降用量：一批抓少一點，翻頁/自動補抓時就會多打幾次
  // Firestore，但每次讀取量變小，尖峰期比較不容易一口氣衝到單日配額上限
  const PAGE_SIZE = 20;
  const VOTED_KEY = "maple_classic_voted";
  // 回報功能開關（2026-07 已開放）。改成 false 可暫時關閉回報：入口按鈕會鎖住、
  // submit 會被擋；真正的防線是 firestore.rules 的 allow create，兩邊要一起改
  const SUBMISSIONS_OPEN = true;
  // 「回報還沒開放」統一用這句，避免同一件事在不同地方各自寫一種措辭
  const SUBMISSIONS_CLOSED_MSG = "遊戲尚未上線，暫不開放回報，敬請期待";
  const FB_VERSION = "10.14.1";
  // App Check（reCAPTCHA Enterprise）金鑰 — 公開的、放前端沒問題。
  // 原本用 classic reCAPTCHA v3 一直出現「Invalid reCAPTCHA configuration」
  // 400 錯誤（換新金鑰、重新綁定專案都沒用），改用 Enterprise 這個 provider，
  // 因為這個 GCP 專案已經啟用了 reCAPTCHA Enterprise API。
  const RECAPTCHA_ENTERPRISE_SITE_KEY = "6Lc4bE8tAAAAAGGl0UWtEMePt27pi2FD17L5cPCN";
  const FB_SCRIPTS = [
    `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app-check-compat.js`,
    `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore-compat.js`,
  ];

  let db = null;
  let dbPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("load failed: " + src));
      document.head.appendChild(s);
    });
  }

  // 只有真的要用到社群資料庫時才下載 Firebase SDK（純計算的訪客完全不會載）
  function ensureDb() {
    if (db) return Promise.resolve(db);
    if (!firebaseConfig.apiKey) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = (async () => {
        if (!window.firebase) {
          for (const src of FB_SCRIPTS) await loadScript(src);
        }
        firebase.initializeApp(firebaseConfig);
        // App Check 要在使用其他服務(Firestore)前啟用。Enterprise provider
        // 要包成 ReCaptchaEnterpriseProvider 物件，不能像 v3 那樣直接傳金鑰字串
        try {
          firebase.appCheck().activate(
            new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
            true
          );
        } catch (e) {
          // 啟用失敗不阻擋讀取；enforcement 未開時仍可運作，開了才會擋
        }
        db = firebase.firestore();
        return db;
      })().catch((e) => {
        dbPromise = null; // 讓下次可重試
        throw e;
      });
    }
    return dbPromise;
  }

  const els = {
    filterJob: document.getElementById("cmFilterJob"),
    filterMap: document.getElementById("cmFilterMap"),
    filterLvMin: document.getElementById("cmFilterLvMin"),
    filterLvMax: document.getElementById("cmFilterLvMax"),
    sortBtns: document.querySelectorAll(".cm-sort-btn"),
    addBtn: document.getElementById("cmAddBtn"),
    form: document.getElementById("cmForm"),
    job: document.getElementById("cmJob"),
    map: document.getElementById("cmMap"),
    level: document.getElementById("cmLevel"),
    expPer10Min: document.getElementById("cmExpPer10Min"),
    note: document.getElementById("cmNote"),
    submitBtn: document.getElementById("cmSubmitBtn"),
    cancelBtn: document.getElementById("cmCancelBtn"),
    msg: document.getElementById("cmMsg"),
    list: document.getElementById("cmList"),
    pagination: document.getElementById("cmPagination"),
  };

  // 職業選單改由 jobsData.js 的單一資料來源動態產生，避免 HTML 裡多份清單各自維護
  if (window.MapleJobOptionsHtml) {
    els.filterJob.insertAdjacentHTML("beforeend", window.MapleJobOptionsHtml);
    els.job.insertAdjacentHTML("beforeend", window.MapleJobOptionsHtml);
  }

  let allRecords = [];
  let lastDoc = null;
  let formOpen = false;
  let lastLoadedAt = 0;
  // spots.js 只看 getRecords() 的長度來判斷「還沒人回報」，沒辦法分辨這跟
  // 「這次真的讀取失敗」的差別；曝露這個旗標讓它能顯示對的訊息，而不是
  // 把讀取失敗誤判成單純的空狀態。
  let lastLoadFailed = false;
  // 進行中的載入數（自動補抓可能跟初次載入重疊，用計數不用布林）。spots.js
  // 靠這個分辨「載入中」跟「真的沒資料」——沒有它，切分頁的瞬間會先閃出
  // 「還沒人回報」的錯誤結論，等載入完成才被蓋掉
  let loadsInFlight = 0;
  // 5 分鐘內重複進入分頁直接用快取，避免來回切分頁每次都重打 Firestore。
  // 拉長是為了降低免費額度用完的風險（原本 60 秒），代價是這幾分鐘內剛好有人
  // 送出新回報的話，其他使用者要多等一下才看得到——社群練功地點資料本來就
  // 不是即時性很重要的內容，可以接受
  const CACHE_MS = 5 * 60 * 1000;
  // Firestore 端是否還有下一批（PAGE_SIZE 筆一批）還沒抓進 allRecords
  let hasMoreFromServer = false;
  let currentPage = 1;
  // 篩選在前端做，篩空時會自動往伺服器補抓下一批；不設上限的話，輸入一個
  // 不存在的地圖名就等於把整個 collection 抓完（讀取量隨資料成長無上限）。
  // 上限 10 批 = 最多自動搜最近 500 筆，超過就停下來明講搜了多少
  const MAX_AUTO_FETCH_ROUNDS = 10;
  let autoFetchRounds = 0;

  function getVotedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(VOTED_KEY)) || []); } catch { return new Set(); }
  }
  function saveVote(id) {
    const s = getVotedSet();
    s.add(id);
    localStorage.setItem(VOTED_KEY, JSON.stringify([...s]));
  }

  const parseExpVal = MapleCalculator.parseExpVal;
  const escHtml = MapleCalculator.escHtml;

  function formatTS(date) {
    return date.toLocaleDateString("zh-TW") + " " + date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }

  function toggleForm() {
    formOpen = !formOpen;
    els.form.hidden = !formOpen;
    els.addBtn.textContent = formOpen ? "✕ 收起" : "＋ 新增紀錄";
  }

  els.addBtn.addEventListener("click", toggleForm);
  els.cancelBtn.addEventListener("click", toggleForm);

  function openForm() {
    if (!SUBMISSIONS_OPEN) return; // 關閉期間不開表單
    if (!formOpen) toggleForm();
    setTimeout(() => {
      els.form.scrollIntoView({ behavior: "smooth", block: "center" });
      els.job.focus();
    }, 150);
  }

  // 遊戲上線前：鎖住回報入口（真正的防護在 firestore.rules 的 allow create）
  if (!SUBMISSIONS_OPEN) {
    els.addBtn.disabled = true;
    els.addBtn.textContent = "遊戲上線後開放回報";
    els.addBtn.title = "遊戲正式上線後才開放新增紀錄";
    const spotsAddBtn = document.getElementById("spotsAddBtn");
    if (spotsAddBtn) {
      spotsAddBtn.disabled = true;
      spotsAddBtn.textContent = "遊戲上線後開放回報";
      spotsAddBtn.title = "遊戲正式上線後才開放新增紀錄";
    }
  }

  function openFormWithExpPer10Min(val) {
    openForm();
    els.expPer10Min.value = val;
  }

  async function submitRecord() {
    if (!SUBMISSIONS_OPEN) {
      els.msg.textContent = SUBMISSIONS_CLOSED_MSG;
      els.msg.className = "cm-msg err";
      return;
    }

    const job = els.job.value.trim();
    const map = els.map.value.trim();
    const level = parseInt(els.level.value, 10);
    const expPer10Min = parseExpVal(els.expPer10Min.value);
    const note = els.note.value.trim();

    // 逐欄檢查、給對應訊息，不要把 4 種不同的錯誤都壓成同一句「請填寫所有必填欄位」——
    // 那樣即使只有一欄有問題，使用者也會以為自己整份表單都沒填
    let fieldError = "";
    if (!job) fieldError = "請選擇職業";
    else if (!map) fieldError = "請輸入地圖名稱";
    else if (isNaN(level) || level < 1 || level > 200) fieldError = "請輸入有效的角色等級（1~200）";
    else if (isNaN(expPer10Min) || expPer10Min <= 0) fieldError = "請輸入有效的 EXP / 10分鐘數值";

    if (fieldError) {
      els.msg.textContent = fieldError;
      els.msg.className = "cm-msg err";
      return;
    }

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "送出中...";
    els.msg.textContent = "";

    // SDK 載入失敗（網路問題）跟「資料庫根本沒設定」是兩回事：前者重試就好，
    // 後者重試也沒用。之前混在同一句「尚未設定、上線前無法送出」，網路不穩的
    // 使用者會以為功能沒開直接放棄，而不是再試一次
    let sdkLoadFailed = false;
    try {
      await ensureDb();
    } catch {
      sdkLoadFailed = true;
    }
    if (!db) {
      els.msg.textContent = sdkLoadFailed
        ? "連不上社群資料庫，請檢查網路後再按一次送出"
        : "社群資料庫尚未設定，暫時無法送出";
      els.msg.className = "cm-msg err";
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "送出";
      return;
    }

    try {
      await db.collection("exp_records").add({
        job, map, level,
        expPer10Min: Math.round(expPer10Min),
        helpful: 0,
        ...(note && { note }),
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已送出！感謝分享";
      els.msg.className = "cm-msg ok";
      els.job.value = ""; els.map.value = "";
      els.level.value = ""; els.expPer10Min.value = ""; els.note.value = "";
      allRecords = []; lastDoc = null;
      await loadRecords();
      if (window.MapleSpots) window.MapleSpots.render();
    } catch (e) {
      // permission-denied 通常代表 firestore.rules 還沒同步成驗證版（或規則本身有問題），
      // 跟一般網路錯誤混在同一句「請稍後再試」的話，這種情況會一直重試一直失敗、
      // 使用者跟站長都看不出真正原因
      els.msg.textContent = (e && e.code === "permission-denied")
        ? "送出被資料庫拒絕，可能是設定尚未同步，請稍後再試或回報給站長"
        : "送出失敗，請稍後再試";
      els.msg.className = "cm-msg err";
    } finally {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "送出";
    }
  }

  els.submitBtn.addEventListener("click", submitRecord);

  async function loadRecords(append = false) {
    if (!append) {
      if (allRecords.length && Date.now() - lastLoadedAt < CACHE_MS) {
        renderRecords();
        return;
      }
      els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
      allRecords = [];
      lastDoc = null;
    }
    lastLoadFailed = false;
    loadsInFlight++;
    try {
      await loadRecordsInner(append);
    } finally {
      loadsInFlight--;
    }
  }

  async function loadRecordsInner(append) {
    try {
      await ensureDb();
    } catch {
      lastLoadFailed = true;
      els.list.innerHTML = '<p class="cm-empty">連線失敗，請檢查網路後重新整理頁面</p>';
      hasMoreFromServer = false;
      return;
    }
    if (!db) {
      els.list.innerHTML = '<p class="cm-empty">社群資料庫尚未開放（遊戲還沒上線），敬請期待。</p>';
      hasMoreFromServer = false;
      return;
    }

    try {
      // 多抓 1 筆只用來判斷「後面還有沒有資料」，不會顯示出來——單純抓
      // PAGE_SIZE 筆的話，「剛好抓滿」跟「後面還有更多」拿到的筆數一模一樣
      // 分不出來，總筆數剛好是 PAGE_SIZE 整數倍時會誤判成 hasMore=true，
      // 使用者按下一頁會多打一次空手而回的請求（會自動修正，但浪費一次讀取）
      let query = db.collection("exp_records").orderBy("ts", "desc").limit(PAGE_SIZE + 1);
      if (append && lastDoc) query = query.startAfter(lastDoc);

      const snap = await query.get();
      const hasExtra = snap.docs.length > PAGE_SIZE;
      const pageDocs = hasExtra ? snap.docs.slice(0, PAGE_SIZE) : snap.docs;
      const newRecords = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
      lastDoc = pageDocs[pageDocs.length - 1] || null;
      allRecords = append ? [...allRecords, ...newRecords] : newRecords;
      lastLoadedAt = Date.now();

      hasMoreFromServer = hasExtra;
      renderRecords();
    } catch (e) {
      lastLoadFailed = true;
      // 網路離線、資料庫拒絕存取（規則/App Check）、其他錯誤這裡分開講，
      // 不然使用者跟站長都只看到同一句「載入失敗」，猜不出是哪一種狀況
      let msg = "載入失敗，請重新整理頁面";
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        msg = "目前似乎沒有網路連線，請檢查後重新整理頁面";
      } else if (e && e.code === "permission-denied") {
        msg = "資料庫拒絕了這次讀取，請重新整理頁面再試一次";
      } else if (e && e.code === "unavailable") {
        msg = "連不上資料庫伺服器，請稍後重新整理頁面";
      }
      // 補抓失敗時別把已經顯示的紀錄整片換成錯誤訊息——保留清單、
      // 把錯誤放在分頁區；同時關掉 hasMoreFromServer 避免 renderRecords
      // 又觸發補抓、失敗、再補抓的迴圈
      if (append && allRecords.length) {
        hasMoreFromServer = false;
        renderRecords();
        els.pagination.innerHTML = `<p class="cm-empty">${msg}</p>`;
        return;
      }
      els.list.innerHTML = `<p class="cm-empty">${msg}</p>`;
    }
  }

  function renderRecords() {
    const fJob = els.filterJob.value.trim().toLowerCase();
    const fMap = els.filterMap.value.trim().toLowerCase();
    const fLvMin = parseInt(els.filterLvMin.value, 10) || 0;
    const fLvMax = parseInt(els.filterLvMax.value, 10) || 999;
    const activeSort = document.querySelector(".cm-sort-btn.active");
    const sortBy = activeSort ? activeSort.dataset.sort : "time";

    const filtered = allRecords
      .filter((r) =>
        (!fJob || r.job.toLowerCase().includes(fJob)) &&
        (!fMap || r.map.toLowerCase().includes(fMap)) &&
        r.level >= fLvMin && r.level <= fLvMax
      )
      .sort((a, b) => {
        if (sortBy === "exp") return b.expPer10Min - a.expPer10Min;
        const ta = a.ts && a.ts.toDate ? a.ts.toDate() : new Date(0);
        const tb = b.ts && b.ts.toDate ? b.ts.toDate() : new Date(0);
        return tb - ta;
      });

    if (!filtered.length) {
      // 已載入的前 50/100/... 筆裡沒有符合條件的紀錄，不代表伺服器上真的沒有——
      // 篩選只在前端做，資料變多後很可能符合條件的紀錄還沒被抓進來，
      // 這裡沒抓過就先別下「沒有符合條件的紀錄」的結論
      if (hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
        autoFetchRounds++;
        // 補抓期間畫面別停在舊清單或空白，明講正在往更早的紀錄搜
        els.list.innerHTML = '<p class="cm-loading">在更早的紀錄中搜尋...</p>';
        els.pagination.innerHTML = "";
        loadRecords(true);
        return;
      }
      // 空資料庫（從沒人回報過）跟「篩選後沒有符合的」是兩種不同狀況，
      // 用同一句「沒有符合條件的紀錄」會讓開服初期的空資料庫看起來像篩選出了問題
      els.list.innerHTML = !allRecords.length
        ? '<p class="cm-empty">目前還沒有玩家回報紀錄，遊戲上線後歡迎來分享你的練功效率！</p>'
        : hasMoreFromServer
          ? `<p class="cm-empty">最近 ${allRecords.length} 筆紀錄中沒有符合條件的，可以放寬條件再試</p>`
          : '<p class="cm-empty">沒有符合條件的紀錄</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / MaplePagination.PAGE_SIZE));
    // 篩選/排序後已載入的資料不夠撐滿目前頁碼，但 Firestore 那邊還有更多，先補抓再重繪
    if (currentPage > totalPages && hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
      autoFetchRounds++;
      els.pagination.innerHTML = '<p class="cm-loading">載入更多紀錄中...</p>';
      loadRecords(true);
      return;
    }
    if (currentPage > totalPages) currentPage = totalPages;
    const pageRecords = MaplePagination.slice(filtered, currentPage);

    const voted = getVotedSet();
    els.list.innerHTML =
      '<div class="cm-grid">' +
      pageRecords.map((r) => {
        const tsText = r.ts && r.ts.toDate ? formatTS(r.ts.toDate()) : "—";
        const hasVoted = voted.has(r.id);
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(r.job)}</div>
          <div class="cm-map">${escHtml(r.map)}</div>
          <div class="cm-stat"><span>角色等級</span><span>Lv.${r.level}</span></div>
          <div class="cm-stat"><span>EXP / 10分鐘</span><span>${r.expPer10Min.toLocaleString()}</span></div>
          ${r.note ? `<div class="cm-note">${escHtml(r.note)}</div>` : ""}
          <div class="cm-card-footer">
            <span class="cm-ts">${tsText}</span>
            <button class="cm-helpful-btn${hasVoted ? " voted" : ""}" data-id="${r.id}" ${hasVoted ? "disabled" : ""} type="button">
              有幫助 <span class="cm-helpful-count">${r.helpful || 0}</span>
            </button>
          </div>
        </div>`;
      }).join("") +
      "</div>";

    MaplePagination.render(els.pagination, {
      total: filtered.length,
      page: currentPage,
      // Firestore 還有更早的資料時，讓最後一頁的「›」保持可按——按下去
      // currentPage 會超過 totalPages，走上面既有的補抓路徑載入下一批
      hasMore: hasMoreFromServer,
      onChange: (p) => { currentPage = p; renderRecords(); },
    });
    // 排序/篩選都只在已載入的資料內做，資料還沒抓完時如果不講，「效率↓」
    // 看起來像全站排行榜、篩選結果看起來像完整結果，其實都只涵蓋最近幾批
    if (hasMoreFromServer) {
      els.pagination.insertAdjacentHTML(
        "beforeend",
        `<p class="cm-range-hint">排序與篩選目前涵蓋最近 ${allRecords.length} 筆回報，按「›」可繼續載入更早的紀錄</p>`
      );
    }
    // 成功渲染出結果 = 這一輪補抓鏈結束，下一次篩空可以重新往下搜
    autoFetchRounds = 0;
  }

  // 單一委派監聽器（在初始化時綁一次，避免每次 render 疊加）
  function onHelpfulClick(e) {
    const btn = e.target.closest(".cm-helpful-btn");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    if (!db || getVotedSet().has(id)) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    db.collection("exp_records").doc(id).update({
      helpful: firebase.firestore.FieldValue.increment(1),
    }).then(() => {
      saveVote(id);
      btn.classList.add("voted");
      const countEl = btn.querySelector(".cm-helpful-count");
      if (countEl) countEl.textContent = parseInt(countEl.textContent || "0") + 1;
      const rec = allRecords.find((r) => r.id === id);
      if (rec) rec.helpful = (rec.helpful || 0) + 1;
    }).catch(() => {
      // 靜默失敗會讓使用者以為自己按過了；短暫顯示失敗訊息再恢復原狀，
      // 這樣使用者知道剛剛那次沒算數，可以再按一次。原本整個 innerHTML 被換掉
      // 會連讚數一起消失 2 秒，這裡改成只換文字、讚數維持顯示
      const countEl = btn.querySelector(".cm-helpful-count");
      const count = countEl ? countEl.textContent : "0";
      btn.innerHTML = `✕ 送出失敗，再試一次 <span class="cm-helpful-count">${count}</span>`;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }, 2000);
    });
  }
  els.list.addEventListener("click", onHelpfulClick);

  function renderRecordsFromStart() {
    currentPage = 1;
    autoFetchRounds = 0;
    renderRecords();
  }

  els.filterJob.addEventListener("change", renderRecordsFromStart);
  els.sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.sortBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderRecordsFromStart();
    });
  });
  // 文字/數字欄位打一個字就重繪一次的話，篩空時每個按鍵都可能觸發一輪
  // PAGE_SIZE 筆的 Firestore 補抓（打「不存在的地圖名」的過程中會連抓好幾輪）；
  // 停手 300ms 再算，中途按鍵只是重設計時
  let filterDebounce = null;
  [els.filterMap, els.filterLvMin, els.filterLvMax].forEach((el) =>
    el.addEventListener("input", () => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(renderRecordsFromStart, 300);
    })
  );

  // 「建議練功地點」/「回報紀錄」子分頁切換，記住使用者上次選的分頁
  const CM_SUBTAB_KEY = "maple_classic_cm_subtab";
  const subSuggestBtn = document.getElementById("cmSubSuggest");
  const subRecordsBtn = document.getElementById("cmSubRecords");
  const suggestView = document.getElementById("cmSuggestView");
  const recordsView = document.getElementById("cmRecordsView");

  function showSuggestTab(skipSave) {
    suggestView.hidden = false;
    recordsView.hidden = true;
    subSuggestBtn.classList.add("active");
    subRecordsBtn.classList.remove("active");
    subSuggestBtn.setAttribute("aria-selected", "true");
    subRecordsBtn.setAttribute("aria-selected", "false");
    if (!skipSave) localStorage.setItem(CM_SUBTAB_KEY, "suggest");
    if (window.MapleSpots) window.MapleSpots.render();
  }

  function showRecordsTab(skipSave) {
    suggestView.hidden = true;
    recordsView.hidden = false;
    subSuggestBtn.classList.remove("active");
    subRecordsBtn.classList.add("active");
    subSuggestBtn.setAttribute("aria-selected", "false");
    subRecordsBtn.setAttribute("aria-selected", "true");
    if (!skipSave) localStorage.setItem(CM_SUBTAB_KEY, "records");
  }

  subSuggestBtn.addEventListener("click", () => showSuggestTab());
  subRecordsBtn.addEventListener("click", () => showRecordsTab());

  if (localStorage.getItem(CM_SUBTAB_KEY) === "records") showRecordsTab(true);

  window.MapleCommunity = {
    loadRecords,
    openForm,
    openFormWithExpPer10Min,
    getRecords: () => allRecords,
    hasLoadFailed: () => lastLoadFailed,
    isLoading: () => loadsInFlight > 0,
    isSubmissionsOpen: () => SUBMISSIONS_OPEN,
    submissionsClosedMsg: SUBMISSIONS_CLOSED_MSG,
    showRecordsTab,
  };
})();
