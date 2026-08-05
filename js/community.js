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

  // 一批抓的筆數。原本降到 20 是免費方案配額吃緊時的暫時措施，2026-07-20
  // 升級 Blaze（+ 預算警示）後配額不再是硬上限，調回 50 讓使用者少點幾次
  // 「下一頁」就能看到更多資料，多出來的讀取量換算費用可忽略不計
  const PAGE_SIZE = 50;
  const VOTED_KEY = "maple_classic_voted";
  // 裝置識別碼，產生一次就長期存在 localStorage。回報時存進 exp_records
  // 的 deviceId 欄位，讓回報者之後能在「回報紀錄」認出哪些是自己發的、
  // 打錯數字時可以自己刪掉（見 onRemoveClick）。這不是真正的身分驗證，
  // 清 localStorage 或換瀏覽器就會變成「新裝置」，是刻意的取捨（防止
  // 誤刪別人資料用的軟性機制，不是防駭客）。
  const DEVICE_ID_KEY = "maple_classic_device_id";
  function getDeviceId() {
    let id;
    try { id = localStorage.getItem(DEVICE_ID_KEY); } catch { id = null; }
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      try { localStorage.setItem(DEVICE_ID_KEY, id); } catch {
        // 無痕模式等擋 localStorage 寫入的情況下，退化成每次呼叫都拿到新 id，
        // 等於失去「一人一則」限制，但不影響其他功能，不用特別處理
      }
    }
    return id;
  }
  // 回報功能開關（2026-07 已開放）。改成 false 可暫時關閉回報：入口按鈕會鎖住、
  // submit 會被擋；真正的防線是 firestore.rules 的 allow create，兩邊要一起改
  const SUBMISSIONS_OPEN = true;
  // 「回報還沒開放」統一用這句，避免同一件事在不同地方各自寫一種措辭
  const SUBMISSIONS_CLOSED_MSG = "遊戲尚未上線，暫不開放回報，敬請期待";
  // 2026-07-24 健檢時升到 12.16.0，結果正式站馬上出現 App Check 403
  // + throttle（appCheck/initial-throttle，清掉 IndexedDB 重新整理也一樣
  // 立刻重現，不是快取殘留）——升級本身造成了新的 App Check 迴歸，先退回
  // 已知能用的版本，之後要再升級的話要先在真的能測 App Check 的環境
  // （不是 localhost，這裡的失敗訊息看起來一樣）驗證過再上
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
        // 本機開發環境（localhost）改接 Firebase Local Emulator Suite，
        // 完全不碰正式資料庫——`firebase emulators:start --only firestore`
        // 啟動一個假的、可以隨便寫壞的 Firestore，讀的還是同一份 firestore.rules
        // 所以驗證邏輯跟正式站一致。App Check 在 localhost 上面那個 try/catch
        // 本來就會啟用失敗（reCAPTCHA 網域沒註冊 localhost），不影響——
        // 模擬器本來就不檢查 App Check token，兩邊互不干擾，不用特別處理。
        if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
          db.useEmulator("localhost", 8080);
        }
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
    sortBtns: document.querySelectorAll("#cmRecordsView .cm-sort-btn"),
    addBtn: document.getElementById("cmAddBtn"),
    form: document.getElementById("cmForm"),
    job: document.getElementById("cmJob"),
    map: document.getElementById("cmMap"),
    mapCount: document.getElementById("cmMapCount"),
    level: document.getElementById("cmLevel"),
    expPer10Min: document.getElementById("cmExpPer10Min"),
    mode: document.getElementById("cmMode"),
    note: document.getElementById("cmNote"),
    noteCount: document.getElementById("cmNoteCount"),
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
  } else {
    // jobsData.js 沒載到時職業下拉只剩「請選擇職業」placeholder，送出
    // 永遠卡在「請選擇職業」的錯誤、又沒有選項可選，使用者無從理解。
    // 明講原因並直接停用送出（跟其他資料檔的兜底比照辦理）
    els.submitBtn.disabled = true;
    els.msg.textContent = "職業清單載入失敗，請重新整理頁面後再回報";
    els.msg.className = "cm-msg err";
  }

  // 字數硬上限＋IME 安全裁切（formGuard.js，四板共用）；掛上計數器讓使用者
  // 知道快到上限了，不然超過的部分會被靜默裁掉，使用者不會發現自己的
  // 地圖名稱或備註被截斷
  const updateMapCount = MapleFormGuard.attach(els.map, 40, els.mapCount);
  const updateNoteCount = MapleFormGuard.attach(els.note, 60, els.noteCount);

  let allRecords = [];
  let lastDoc = null;
  let formOpen = false;
  let lastLoadedAt = 0;
  // spots.js 只看 getRecords() 的長度來判斷「還沒人回報」，沒辦法分辨這跟
  // 「這次真的讀取失敗」的差別；曝露這個旗標讓它能顯示對的訊息，而不是
  // 把讀取失敗誤判成單純的空狀態。
  let lastLoadFailed = false;
  // 失敗原因的完整訊息也留一份：spots.js（建議練功地點）跟這裡共用同一次
  // 讀取，失敗時要能顯示一樣細的原因，不能只有一句籠統的「載入失敗」
  let lastLoadErrorMsg = "";
  // 進行中的載入數（自動補抓可能跟初次載入重疊，用計數不用布林）。spots.js
  // 靠這個分辨「載入中」跟「真的沒資料」——沒有它，切分頁的瞬間會先閃出
  // 「還沒人回報」的錯誤結論，等載入完成才被蓋掉
  let loadsInFlight = 0;
  // 60 秒內重複進入分頁直接用快取，避免來回切分頁每次都重打 Firestore。
  // 曾經拉長到 5 分鐘是免費方案配額吃緊時的暫時措施，2026-07-20 升級
  // Blaze 後改回 60 秒——剛送出的回報，其他人幾乎立刻就看得到，對這種
  // 靠即時回報累積價值的社群功能來說，資料新鮮度值得換一點點讀取成本
  const CACHE_MS = 60 * 1000;
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

  // Firestore 離線持久化的寫入（add/update）在「網路看似正常但連不到
  // Firestore 伺服器」時（例如廣告封鎖器/防火牆擋了 Firestore 網域）不會
  // reject，會排進本地佇列無限期 pending——navigator.onLine 判斷不出這種
  // 情況（那只測「裝置有沒有網路」，不是「連不連得到 Firestore」），沒有
  // 這層保護的話按鈕會永久卡在「送出中...」，2026-07-31 健檢實測重現過。
  // 幫寫入包一層逾時，逾時就當失敗處理，讓使用者至少看得到「可以再試
  // 一次」，不會卡死看不出發生什麼事。
  const WRITE_TIMEOUT_MS = 15000;
  function withWriteTimeout(promise) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("write-timeout")), WRITE_TIMEOUT_MS)),
    ]);
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
    // 練功方式：solo（單練）/ party（團練）。歷史紀錄沒有這個欄位（當時
    // 表單還沒有這一欄），所以顯示端要把「沒有 mode」當成未知而不是單練
    const mode = els.mode.value === "party" ? "party" : "solo";
    const note = els.note.value.trim();

    // 逐欄檢查、給對應訊息，不要把 4 種不同的錯誤都壓成同一句「請填寫所有必填欄位」——
    // 那樣即使只有一欄有問題，使用者也會以為自己整份表單都沒填。
    // errEl 記住出錯的欄位：手機版表單直排很長、錯誤訊息在最底部的按鈕旁，
    // 只給文字的話使用者要自己往上捲逐欄對照，直接把焦點跟畫面帶過去
    let fieldError = "";
    let errEl = null;
    if (!job) { fieldError = "請選擇職業"; errEl = els.job; }
    else if (!map) { fieldError = "請輸入地圖名稱"; errEl = els.map; }
    else if (isNaN(level) || level < 1 || level > 200) { fieldError = "請輸入有效的角色等級（1~200）"; errEl = els.level; }
    else if (isNaN(expPer10Min) || expPer10Min <= 0) { fieldError = "請輸入有效的 EXP / 10分鐘數值"; errEl = els.expPer10Min; }
    // 上限跟 firestore.rules 的 expPer10Min <= 1000000000 一致——沒有這條的話，
    // W 縮寫多打一個 0（例如 500000W = 50 億）會被規則整筆拒絕，前端只能顯示
    // 籠統的 permission-denied 訊息，使用者會以為站掛了
    else if (expPer10Min > 1000000000) { fieldError = "EXP 數值太大（上限 10 億），請確認是不是多打了一個 0 或 W"; errEl = els.expPer10Min; }

    if (fieldError) {
      els.msg.textContent = fieldError;
      els.msg.className = "cm-msg err";
      if (errEl) {
        errEl.focus();
        errEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    // Firestore 寫入在離線時不會 reject、promise 永遠 pending，finally 不會
    // 執行、按鈕會永久卡在「送出中...」——讀取路徑有 onLine 判斷，寫入也要有
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      els.msg.textContent = "目前似乎沒有網路連線，請檢查後再按一次送出（表單內容會保留）";
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
      await withWriteTimeout(db.collection("exp_records").add({
        job, map, level,
        expPer10Min: Math.round(expPer10Min),
        mode,
        helpful: 0,
        // 讓自己之後能在「回報紀錄」認出這筆是不是自己發的、打錯數字時可以
        // 自己刪掉，見下面 onRemoveClick／isMarkRemoved()（firestore.rules）
        deviceId: getDeviceId(),
        ...(note && { note }),
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      }));
      els.msg.textContent = "✓ 已送出！感謝分享";
      els.msg.className = "cm-msg ok";
      els.job.value = ""; els.map.value = "";
      els.level.value = ""; els.expPer10Min.value = ""; els.mode.value = "solo"; els.note.value = "";
      updateMapCount(); updateNoteCount();
      allRecords = []; lastDoc = null;
      await loadRecords();
      if (window.MapleSpots) window.MapleSpots.render();
    } catch (e) {
      // permission-denied 通常代表 firestore.rules 還沒同步成驗證版（或規則本身有問題），
      // resource-exhausted 是免費方案每日寫入額度用完——這兩種「重試也沒用」的情況
      // 都不能沿用「請稍後再試」的措辭，不然使用者會一直重試一直失敗、猜不出真正原因
      if (e && e.code === "permission-denied") {
        els.msg.textContent = "送出被資料庫拒絕，可能是設定尚未同步，請稍後再試或回報給站長";
      } else if (e && e.code === "resource-exhausted") {
        els.msg.textContent = "今天的回報額度已滿，明天會自動恢復，麻煩明天再試一次";
      } else if (e && e.message === "write-timeout") {
        els.msg.textContent = "連線太久沒回應，可能是網路擋住了社群資料庫，請檢查網路後再試一次";
      } else {
        els.msg.textContent = "送出失敗，請稍後再試";
      }
      els.msg.className = "cm-msg err";
    } finally {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "送出";
    }
  }

  els.submitBtn.addEventListener("click", submitRecord);

  // 載入世代計數：每次「整批重載」（非 append）就 +1。在途的補抓（append）
  // 回來時如果世代已經變了（例如補抓鏈跑到一半使用者送出了新回報、觸發
  // 整批重載），代表它抓的是舊清單的下一批，直接丟棄——不然舊批次會疊進
  // 新清單，出現重複卡片、lastDoc 游標也會錯亂
  let loadGen = 0;

  async function loadRecords(append = false) {
    if (!append) {
      if (allRecords.length && Date.now() - lastLoadedAt < CACHE_MS) {
        renderRecords();
        return;
      }
      els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
      allRecords = [];
      lastDoc = null;
      loadGen++;
    }
    lastLoadFailed = false;
    lastLoadErrorMsg = "";
    loadsInFlight++;
    try {
      await loadRecordsInner(append, loadGen);
    } finally {
      loadsInFlight--;
    }
  }

  async function loadRecordsInner(append, gen) {
    try {
      await ensureDb();
    } catch {
      lastLoadFailed = true;
      lastLoadErrorMsg = "連線失敗，請檢查網路後重新整理頁面";
      els.list.innerHTML = `<p class="cm-empty cm-empty--error">${lastLoadErrorMsg}</p>`;
      hasMoreFromServer = false;
      return;
    }
    if (!db) {
      els.list.innerHTML = '<p class="cm-empty cm-empty--error">社群資料庫目前無法連線，請稍後再試。</p>';
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
      // 世代變了＝這批是針對已被重載捨棄的舊清單抓的，丟棄不合併
      if (gen !== loadGen) return;
      // 離線時 Firestore 的 get() 不會丟錯誤，而是從（空的）本機快取
      // 「成功」回傳空結果——放著不管會走到「目前還沒有玩家回報紀錄」的
      // 空狀態文案，把斷線誤報成沒資料。空結果＋來自快取＝根本沒連上
      // 伺服器，改走連線失敗訊息（快取裡有資料的話照常顯示，那是真資料）
      if (!append && snap.empty && snap.metadata && snap.metadata.fromCache) {
        lastLoadFailed = true;
        lastLoadErrorMsg = "連不上資料庫伺服器，請檢查網路後重新整理頁面";
        els.list.innerHTML = `<p class="cm-empty cm-empty--error">${lastLoadErrorMsg}</p>`;
        hasMoreFromServer = false;
        return;
      }
      const hasExtra = snap.docs.length > PAGE_SIZE;
      const pageDocs = hasExtra ? snap.docs.slice(0, PAGE_SIZE) : snap.docs;
      const newRecords = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
      lastDoc = pageDocs[pageDocs.length - 1] || null;
      allRecords = append ? [...allRecords, ...newRecords] : newRecords;
      lastLoadedAt = Date.now();

      hasMoreFromServer = hasExtra;
      renderRecords();
    } catch (e) {
      if (gen !== loadGen) return;
      lastLoadFailed = true;
      // 網路離線、資料庫拒絕存取（規則/App Check）、其他錯誤這裡分開講，
      // 不然使用者跟站長都只看到同一句「載入失敗」，猜不出是哪一種狀況
      let msg = "載入失敗，請重新整理頁面";
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        msg = "目前似乎沒有網路連線，請檢查後重新整理頁面";
      } else if (e && e.code === "permission-denied") {
        // 站方用 rules 暫時關閉功能時也會走到這裡——「請重新整理」在維護
        // 期間是反效果措辭（重新整理也沒用），把兩種可能都講清楚
        msg = "資料庫拒絕了這次讀取，可能是功能暫時維護中；稍後重新整理頁面再試一次";
      } else if (e && e.code === "unavailable") {
        msg = "連不上資料庫伺服器，請稍後重新整理頁面";
      } else if (e && e.code === "resource-exhausted") {
        // 免費方案的每日讀取額度用完時 Firestore 回這個錯誤碼，重新整理沒有用
        // （額度要等隔天美西時間午夜才重置），不能沿用「請重新整理」的措辭誤導使用者
        msg = "今天社群功能的使用量已達上限，明天會自動恢復，其他功能不受影響";
      }
      lastLoadErrorMsg = msg;
      // 補抓失敗時別把已經顯示的紀錄整片換成錯誤訊息——保留清單、
      // 把錯誤放在分頁區；同時關掉 hasMoreFromServer 避免 renderRecords
      // 又觸發補抓、失敗、再補抓的迴圈
      if (append && allRecords.length) {
        hasMoreFromServer = false;
        renderRecords();
        els.pagination.innerHTML = `<p class="cm-empty cm-empty--error">${msg}</p>`;
        return;
      }
      els.list.innerHTML = `<p class="cm-empty cm-empty--error">${msg}</p>`;
    }
  }

  function renderRecords() {
    const fJob = els.filterJob.value.trim().toLowerCase();
    const fMap = els.filterMap.value.trim().toLowerCase();
    const fLvMin = parseInt(els.filterLvMin.value, 10) || 0;
    const fLvMax = parseInt(els.filterLvMax.value, 10) || 999;
    const activeSort = document.querySelector("#cmRecordsView .cm-sort-btn.active");
    const sortBy = activeSort ? activeSort.dataset.sort : "time";

    const filtered = allRecords
      .filter((r) =>
        !r.removed &&
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
      // 如果上一次讀取本來就失敗了（loadRecordsInner 的 catch 已經顯示了
      // 正確的錯誤訊息），這裡不能因為 allRecords 剛好是空的就蓋成「還沒有
      // 人回報」——那會把「讀取失敗，重新整理」的正確結論，蓋成一個看起來
      // 像正常空狀態的錯誤結論。點排序/篩選按鈕會呼叫到這裡但不會重新
      // 觸發載入，所以失敗狀態會一直維持到使用者真的重新整理頁面為止
      if (lastLoadFailed && !allRecords.length) return;
      // 空資料庫（從沒人回報過）跟「篩選後沒有符合的」是兩種不同狀況，
      // 用同一句「沒有符合條件的紀錄」會讓開服初期的空資料庫看起來像篩選出了問題
      els.list.innerHTML = !allRecords.length
        ? '<p class="cm-empty">目前還沒有玩家回報紀錄，歡迎來分享你的練功效率！</p>'
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
    const deviceId = getDeviceId();
    els.list.innerHTML =
      '<div class="cm-grid">' +
      pageRecords.map((r) => {
        const tsText = r.ts && r.ts.toDate ? formatTS(r.ts.toDate()) : "—";
        const hasVoted = voted.has(r.id);
        // 舊資料（deviceId 欄位加進來之前的回報）沒有這欄，比對一定是
        // false——本來就沒辦法讓人自己刪掉那些舊紀錄，跟 note／mode 欄位
        // 的向後相容處理是同一種取捨
        const isMine = r.deviceId === deviceId;
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(r.job)}${r.mode === "party" ? '<span class="cm-mode-tag">團練</span>' : ""}</div>
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
          ${isMine ? `<div class="cm-card-footer">
            <button class="cm-helpful-btn cm-remove-btn" data-id="${r.id}" type="button">✕ 刪除這筆回報</button>
          </div>` : ""}
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
    if (getVotedSet().has(id)) return;

    const originalHtml = btn.innerHTML;
    const showBtnError = (text) => {
      // 靜默失敗會讓使用者以為自己按過了；短暫顯示失敗訊息再恢復原狀。
      // 只換文字、讚數維持顯示（原本整個 innerHTML 被換掉會連讚數一起消失）
      const countEl = btn.querySelector(".cm-helpful-count");
      const count = countEl ? countEl.textContent : "0";
      btn.innerHTML = `${text} <span class="cm-helpful-count">${count}</span>`;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }, 2000);
    };
    // db 沒初始化（理論上列表能顯示就代表已初始化，防禦性處理）跟離線都
    // 不能靜默 return——Firestore 離線寫入不會 reject，會永久卡 disabled
    if (!db || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      btn.disabled = true;
      showBtnError("✕ 沒有網路，稍後再試");
      return;
    }

    btn.disabled = true;
    // 寫入期間顯示進行中文案（送出/刪除按鈕都有「…中...」，這顆之前只
    // disabled 文字不變，慢網路下按了像沒反應）；成功時先還原原字樣再更新
    // 數字，失敗時 showBtnError 自己會還原
    const countNow = (btn.querySelector(".cm-helpful-count") || { textContent: "0" }).textContent;
    btn.innerHTML = `送出中... <span class="cm-helpful-count">${countNow}</span>`;
    withWriteTimeout(db.collection("exp_records").doc(id).update({
      helpful: firebase.firestore.FieldValue.increment(1),
    })).then(() => {
      saveVote(id);
      btn.innerHTML = originalHtml;
      btn.classList.add("voted");
      const countEl = btn.querySelector(".cm-helpful-count");
      if (countEl) countEl.textContent = parseInt(countEl.textContent || "0") + 1;
      const rec = allRecords.find((r) => r.id === id);
      if (rec) rec.helpful = (rec.helpful || 0) + 1;
    }).catch(() => {
      showBtnError("✕ 送出失敗，再試一次");
    });
  }
  els.list.addEventListener("click", onHelpfulClick);

  // 自己刪掉打錯數字的回報，跟 team.js 的 onFoundClick／stall.js 的
  // onClosedClick 同一套做法：單一委派監聽器、按鈕只在 isMine 時渲染出來。
  function onRemoveClick(e) {
    const btn = e.target.closest(".cm-remove-btn");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;

    // 沒辦法復原（規則不開放把 removed 改回 false），怕手滑誤刪先跳確認
    if (!confirm("確定要刪除這筆回報嗎？如果是打錯數字，可以刪掉後重新回報正確的。這個動作沒辦法復原。")) return;

    // 離線時 Firestore 的 update 不會 reject，會永久卡在「處理中...」
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      btn.textContent = "沒有網路，稍後再試";
      setTimeout(() => { btn.textContent = "✕ 刪除這筆回報"; }, 2000);
      return;
    }

    btn.disabled = true;
    btn.textContent = "刪除中...";
    ensureDb().then((db) => {
      if (!db) throw new Error("no-db");
      return withWriteTimeout(db.collection("exp_records").doc(id).update({ removed: true }));
    }).then(() => {
      // 刪除成功就直接從畫面上拿掉，不用等下次重新載入
      allRecords = allRecords.filter((r) => r.id !== id);
      renderRecords();
      if (window.MapleSpots) window.MapleSpots.render();
    }).catch(() => {
      // 失敗機率不高（自己發的文、規則本來就允許這個更新），失敗了讓
      // 使用者知道可以再按一次，不要靜默失敗
      btn.disabled = false;
      btn.textContent = "刪除失敗，再按一次試試";
    });
  }
  els.list.addEventListener("click", onRemoveClick);

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

  // 「建議練功地點」/「回報紀錄」兩個子分頁切換，記住使用者上次選的分頁。
  const CM_SUBTAB_KEY = "maple_classic_cm_subtab";
  const cmSubtabs = [
    { key: "suggest", btn: document.getElementById("cmSubSuggest"), view: document.getElementById("cmSuggestView") },
    { key: "picks", btn: document.getElementById("cmSubPicks"), view: document.getElementById("cmPicksView") },
    { key: "records", btn: document.getElementById("cmSubRecords"), view: document.getElementById("cmRecordsView") },
  ];

  function showCmSubtab(key, skipSave) {
    cmSubtabs.forEach((t) => {
      const active = t.key === key;
      t.view.hidden = !active;
      t.btn.classList.toggle("active", active);
      t.btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (!skipSave) localStorage.setItem(CM_SUBTAB_KEY, key);
    if (key === "suggest" && window.MapleSpots) window.MapleSpots.render();
  }

  cmSubtabs.forEach((t) => t.btn.addEventListener("click", () => showCmSubtab(t.key)));

  // timer.js 的「套用到社群回報」按鈕會直接呼叫這個函式名稱，保留舊名字
  // 當 showCmSubtab("records") 的包裝，不用去改 timer.js
  function showRecordsTab(skipSave) {
    showCmSubtab("records", skipSave);
  }

  // 網址錨點 #cm-<subtab>（例如攻略文連的 #cm-records）比 localStorage
  // 的舊紀錄優先，跟 nav.js 處理 #calc-* 的規則一致。
  const [cmHashMain, cmHashSub] = location.hash.slice(1).split("-");
  const hashSubtab = cmHashMain === "cm" && cmSubtabs.some((t) => t.key === cmHashSub) ? cmHashSub : null;
  const savedSubtab = localStorage.getItem(CM_SUBTAB_KEY);
  const initialSubtab = hashSubtab || savedSubtab;
  // "suggest" 不用特別切——它本來就是 HTML 裡預設亮著的那個子分頁，再呼叫
  // 一次只是白跑一次 MapleSpots.render()。其餘的都要真的切過去：原本這裡
  // 只認 records，導致 guides/ 文章側邊欄連過來的 #cm-picks 會停在建議
  // 練功地點（2026-08-05 文章頁注入側邊欄時抓到）
  if (initialSubtab && initialSubtab !== "suggest") showCmSubtab(initialSubtab, true);

  window.MapleCommunity = {
    loadRecords,
    openForm,
    openFormWithExpPer10Min,
    // spots.js（建議練功地點）算平均效率用的是這份清單，被刪除的紀錄不能
    // 混進去，見 onRemoveClick
    getRecords: () => allRecords.filter((r) => !r.removed),
    hasLoadFailed: () => lastLoadFailed,
    loadErrorMsg: () => lastLoadErrorMsg,
    hasMoreOnServer: () => hasMoreFromServer,
    isLoading: () => loadsInFlight > 0,
    isSubmissionsOpen: () => SUBMISSIONS_OPEN,
    submissionsClosedMsg: SUBMISSIONS_CLOSED_MSG,
    showRecordsTab,
    // 計算機結果區的「看 Lv.X 附近的推薦練功地點」導流用，跟 showRecordsTab
    // 同一套包裝
    showSuggestTab: (skipSave) => showCmSubtab("suggest", skipSave),
    // nav.js 補觸發子分頁 render 時要讀同一個 localStorage key——鍵名只在
    // 這裡定義一次，nav.js 透過這個屬性拿，避免兩邊字面量各自漂移
    cmSubtabKey: CM_SUBTAB_KEY,
  };
})();
