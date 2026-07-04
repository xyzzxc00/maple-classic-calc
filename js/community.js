/**
 * community.js — 社群經驗資料庫（Firebase Firestore）
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

  const PAGE_SIZE = 50;
  const VOTED_KEY = "maple_classic_voted";
  // 遊戲上線後改成 true 即可開放回報（同時記得把 firestore.rules 的 allow create 改回驗證版）
  const SUBMISSIONS_OPEN = false;
  // 「回報還沒開放」統一用這句，避免同一件事在不同地方各自寫一種措辭
  const SUBMISSIONS_CLOSED_MSG = "遊戲尚未上線，暫不開放回報，敬請期待";
  const FB_VERSION = "10.12.2";
  // App Check（reCAPTCHA v3）網站金鑰 — 公開的、放前端沒問題
  const RECAPTCHA_SITE_KEY = "6Ld6qz4tAAAAAEEUb-X6ZGmRWgrwFif0dG76hbBU";
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
        // App Check 要在使用其他服務(Firestore)前啟用
        try {
          firebase.appCheck().activate(RECAPTCHA_SITE_KEY, true);
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
    loadMore: document.getElementById("cmLoadMore"),
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
  // 60 秒內重複進入分頁直接用快取，避免來回切分頁每次都重打 Firestore（一次 50 筆讀取）
  const CACHE_MS = 60000;

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
    else if (isNaN(level) || level < 1) fieldError = "請輸入有效的角色等級";
    else if (isNaN(expPer10Min) || expPer10Min <= 0) fieldError = "請輸入有效的 EXP / 10分鐘數值";

    if (fieldError) {
      els.msg.textContent = fieldError;
      els.msg.className = "cm-msg err";
      return;
    }

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "送出中...";
    els.msg.textContent = "";

    try {
      await ensureDb();
    } catch {
      // ignore；下方 !db 檢查會處理
    }
    if (!db) {
      els.msg.textContent = "社群資料庫尚未設定，遊戲上線前無法送出";
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
      els.msg.textContent = "送出失敗，請稍後再試";
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

    try {
      await ensureDb();
    } catch {
      lastLoadFailed = true;
      els.list.innerHTML = '<p class="cm-empty">連線失敗，請檢查網路後重新整理頁面</p>';
      if (els.loadMore) els.loadMore.hidden = true;
      return;
    }
    if (!db) {
      els.list.innerHTML = '<p class="cm-empty">社群資料庫尚未開放（遊戲還沒上線），敬請期待。</p>';
      if (els.loadMore) els.loadMore.hidden = true;
      return;
    }

    try {
      let query = db.collection("exp_records").orderBy("ts", "desc").limit(PAGE_SIZE);
      if (append && lastDoc) query = query.startAfter(lastDoc);

      const snap = await query.get();
      const newRecords = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      lastDoc = snap.docs[snap.docs.length - 1] || null;
      allRecords = append ? [...allRecords, ...newRecords] : newRecords;
      lastLoadedAt = Date.now();

      if (els.loadMore) els.loadMore.hidden = snap.docs.length < PAGE_SIZE;
      renderRecords();
    } catch (e) {
      lastLoadFailed = true;
      els.list.innerHTML = '<p class="cm-empty">載入失敗，請重新整理頁面</p>';
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
      els.list.innerHTML = '<p class="cm-empty">沒有符合條件的紀錄</p>';
      return;
    }

    const voted = getVotedSet();
    els.list.innerHTML =
      '<div class="cm-grid">' +
      filtered.map((r) => {
        const tsText = r.ts && r.ts.toDate ? formatTS(r.ts.toDate()) : "—";
        const hasVoted = voted.has(r.id);
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(r.job)}</div>
          <div class="cm-map">📍 ${escHtml(r.map)}</div>
          <div class="cm-stat"><span>角色等級</span><span>Lv.${r.level}</span></div>
          <div class="cm-stat"><span>EXP / 10分鐘</span><span>${r.expPer10Min.toLocaleString()}</span></div>
          ${r.note ? `<div class="cm-note">💬 ${escHtml(r.note)}</div>` : ""}
          <div class="cm-card-footer">
            <span class="cm-ts">${tsText}</span>
            <button class="cm-helpful-btn${hasVoted ? " voted" : ""}" data-id="${r.id}" ${hasVoted ? "disabled" : ""} type="button">
              👍 <span class="cm-helpful-count">${r.helpful || 0}</span>
            </button>
          </div>
        </div>`;
      }).join("") +
      "</div>";
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
      // 這樣使用者知道剛剛那次沒算數，可以再按一次
      btn.textContent = "送出失敗，再試一次";
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }, 2000);
    });
  }
  els.list.addEventListener("click", onHelpfulClick);

  if (els.loadMore) {
    els.loadMore.addEventListener("click", () => loadRecords(true));
  }

  els.filterJob.addEventListener("change", renderRecords);
  els.sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.sortBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderRecords();
    });
  });
  [els.filterMap, els.filterLvMin, els.filterLvMax].forEach((el) =>
    el.addEventListener("input", renderRecords)
  );

  window.MapleCommunity = {
    loadRecords,
    openForm,
    openFormWithExpPer10Min,
    getRecords: () => allRecords,
    hasLoadFailed: () => lastLoadFailed,
    isSubmissionsOpen: () => SUBMISSIONS_OPEN,
    submissionsClosedMsg: SUBMISSIONS_CLOSED_MSG,
  };
})();
