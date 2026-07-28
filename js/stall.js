/**
 * stall.js — 自由市場擺攤公告（Firestore stall_posts）
 * -----------------------------------------------------------------
 * 跟 community.js／team.js 共用同一個 Firebase app／db（透過
 * window.MapleCommunity.ensureDb()），不要自己 initializeApp 一次。
 *
 * 比 team.js 簡單的地方：擺攤是「現在就開著」，不像組隊揪團可以先公告
 * 未來的時間，所以不需要 scheduledAt 這個欄位——直接用 ts（發文時間，
 * 伺服器蓋章）往後推 24 小時當到期時間就好，沒有「集合時間 + 緩衝」
 * 那種兩段式邏輯。
 *
 * 到期規則＝發文 24 小時後還沒被篩掉，就代表這篇多半已經過時，過濾掉。
 * 查詢直接在 Firestore 端用 where ts >= (現在 - 24 小時) 擋掉，跟
 * orderBy 是同一個欄位，不需要複合索引。
 *
 * 「已收攤」是自願回報，不是強制的——設計上討論過讓「其他玩家」也能
 * 回報「這攤已經不在了」，但那樣任何人都能動別人的貼文，會被拿來惡意
 * 洗掉競爭對手的貼文，所以最後決定只保留「發文者自己下架」這條路，
 * 靠 24 小時到期當保底，不做群眾回報機制。
 *
 * 2026-07-27 起改成「一人一則＋冷卻」：文件 ID 直接用
 * window.MapleCommunity.getDeviceId()（裝置層級識別碼，存在
 * localStorage，跟 team.js／guild.js／livestream.js 共用同一個值），
 * 用 doc(deviceId).set() 而不是 add()——同一台裝置在這個板永遠只有一篇
 * 公告，重新發布是覆蓋舊的那篇，不是疊加新的一筆。firestore.rules 用
 * isRefresh() 擋住太頻繁的覆蓋（1 小時內不能刷新，不因標記過「已收攤」
 * 而提早解除——不然會被拿來「標記已收攤→立刻重發」無限循環繞過冷卻），
 * 這裡在送出前先讀一次自己的舊文件、算冷卻剩餘時間，
 * 給比伺服器直接回絕更友善的錯誤訊息；真正的防線還是規則那邊，前端
 * 這層檢查只是體驗優化，讀取失敗也不擋發文。「這是我的貼文」（isMine，
 * 決定要不要顯示「已收攤」按鈕）現在直接比對文件 ID 是不是自己的
 * deviceId，不用再像以前那樣維護一份 localStorage 貼文 ID 清單。這一樣
 * 不是真正的身分驗證——清 localStorage 或換瀏覽器就是新裝置，是刻意的
 * 取捨（防洗版用的軟性機制，不是防駭客）。
 *
 * Firestore 裡過期後的舊文件不會被刪除，理論上集合會無限變大。目前
 * 量級太小不值得處理；真的長很大的話，可以用 `gcloud firestore fields
 * ttls update` 幫 ts 欄位設原生 TTL policy，讓 Firestore 自動清掉。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    typeFilterBtns: document.getElementById("stallTypeFilterBtns"),
    serverFilterBtns: document.getElementById("stallServerFilterBtns"),
    addBtn: document.getElementById("stallAddBtn"),
    form: document.getElementById("stallForm"),
    type: document.getElementById("stallType"),
    server: document.getElementById("stallServer"),
    channel: document.getElementById("stallChannel"),
    market: document.getElementById("stallMarket"),
    charId: document.getElementById("stallCharId"),
    descriptionLabel: document.getElementById("stallDescriptionLabel"),
    description: document.getElementById("stallDescription"),
    submitBtn: document.getElementById("stallSubmitBtn"),
    cancelBtn: document.getElementById("stallCancelBtn"),
    msg: document.getElementById("stallMsg"),
    list: document.getElementById("stallList"),
    pagination: document.getElementById("stallPagination"),
  };
  if (!els.form) return;

  // 字數硬上限＋IME 安全裁切（formGuard.js，四板共用）；內容欄是主要
  // 自由輸入欄位，加即時字數計數，做法跟公會招募的簡介欄一致
  const updateDescriptionCount = MapleFormGuard.attach(els.description, 100, document.getElementById("stallDescCount"));
  MapleFormGuard.attach(els.market, 40);
  MapleFormGuard.attach(els.charId, 20);

  // 「內容」欄位的說明文字跟著交易類型換，賣/收要打的東西方向相反，
  // 固定寫死一種措辭會讓另一種類型的使用者看了困惑
  function updateDescriptionLabel() {
    if (els.type.value === "收購") {
      els.descriptionLabel.textContent = "收購內容 *";
      els.description.placeholder = "例：收購潔淨的力量卷軸、龍族武器";
    } else {
      els.descriptionLabel.textContent = "交易內容 *";
      els.description.placeholder = "例：卷軸大特賣、武器防具便宜出清";
    }
  }
  els.type.addEventListener("change", updateDescriptionLabel);

  const EXPIRE_MS = 24 * 60 * 60 * 1000; // 固定 24 小時，發文時系統自動套用，不用玩家選
  // 顯示的一頁筆數，跟每次跟 Firestore 要資料的批次大小共用同一個數字，
  // 做法跟 team.js 一樣，「按下一頁」＝「剛好去問伺服器要下一批」
  const PAGE_SIZE = 30;
  // 篩選（伺服器）在前端做，篩空時會自動往伺服器補抓下一批；上限 10 批 =
  // 最多自動搜 300 筆，做法跟 team.js／exp_records 一樣
  const MAX_AUTO_FETCH_ROUNDS = 10;
  const CACHE_MS = 60 * 1000; // 跟 community.js／team.js 同標準
  // 一人一則的冷卻時間，跟 team.js／guild.js／livestream.js 同標準
  const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

  const escHtml = MapleCalculator.escHtml;

  // 伺服器清單跟揪團板共用同一份資料來源（teamData.js），不用另外維護一份
  if (window.MapleTeamServers) {
    els.server.insertAdjacentHTML(
      "beforeend",
      window.MapleTeamServers.map((s) => `<option value="${s}">${s}</option>`).join("")
    );
    // 篩選按鈕跟表單的伺服器下拉選單同一份資料來源，動態產生，伺服器
    // 清單改了不用兩邊維護
    els.serverFilterBtns.insertAdjacentHTML(
      "beforeend",
      window.MapleTeamServers.map((s) => `<button class="cm-sort-btn" data-server="${s}" type="button">${s}</button>`).join("")
    );
  }

  let allPosts = [];
  let lastDoc = null;
  let hasMoreFromServer = false; // Firestore 端是否還有下一批（PAGE_SIZE 筆一批）還沒抓進 allPosts
  // renderStallPosts() 靠這個分辨「讀取真的失敗」跟「單純還沒有資料」，
  // 理由跟 community.js 的 exp_records 一樣：不然點篩選按鈕會把已經顯示
  // 的正確錯誤訊息，悄悄蓋成「還沒有擺攤公告」
  let lastLoadFailed = false;
  let lastLoadedAt = 0;
  let currentPage = 1;
  let autoFetchRounds = 0;
  let activeType = ""; // "" = 全部（賣／收）
  let activeServer = ""; // "" = 全部

  let formOpen = false;
  function setFormOpen(open) {
    formOpen = open;
    els.form.hidden = !open;
    // 「發布」比其他板的入口按鈕籠統，明講擺攤／收購兩種用途
    els.addBtn.textContent = open ? "✕ 收起" : "＋ 我要擺攤／收購";
  }
  els.addBtn.addEventListener("click", () => setFormOpen(!formOpen));
  els.cancelBtn.addEventListener("click", () => setFormOpen(false));

  // 板別開關（開關本體在 community.js 的 BOARDS_OPEN，跟 firestore.rules
  // 的 allow create 要一起改）
  const BOARD_OPEN = !window.MapleCommunity || window.MapleCommunity.isBoardOpen("stall");
  if (!BOARD_OPEN) {
    els.addBtn.disabled = true;
    els.addBtn.textContent = "暫時關閉維護中";
    els.addBtn.title = window.MapleCommunity.boardClosedMsg;
  }

  async function submitStallPost() {
    if (!BOARD_OPEN) {
      els.msg.textContent = window.MapleCommunity.boardClosedMsg;
      els.msg.className = "cm-msg err";
      return;
    }
    const type = els.type.value;
    const server = els.server.value;
    const channel = parseInt(els.channel.value, 10);
    const market = els.market.value.trim();
    const charId = els.charId.value.trim();
    const description = els.description.value.trim();

    let fieldError = "";
    let errEl = null;
    if (!type) { fieldError = "請選擇交易類型"; errEl = els.type; }
    else if (!server) { fieldError = "請選擇伺服器"; errEl = els.server; }
    else if (isNaN(channel) || channel < 1 || channel > 50) { fieldError = "請輸入有效的頻道（1~50）"; errEl = els.channel; }
    else if (!market) { fieldError = "請輸入自由市場地點"; errEl = els.market; }
    else if (!charId) { fieldError = "請輸入角色 ID"; errEl = els.charId; }
    else if (!description) { fieldError = "請輸入交易內容"; errEl = els.description; }

    if (fieldError) {
      els.msg.textContent = fieldError;
      els.msg.className = "cm-msg err";
      if (errEl) {
        errEl.focus();
        errEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    // Firestore 寫入在離線時不會 reject、promise 永遠 pending，按鈕會永久
    // 卡在「送出中...」——讀取路徑有 onLine 判斷，寫入也要有
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      els.msg.textContent = "目前似乎沒有網路連線，請檢查後再按一次送出（表單內容會保留）";
      els.msg.className = "cm-msg err";
      return;
    }

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "送出中...";
    els.msg.textContent = "";

    let sdkLoadFailed = false;
    let db = null;
    try {
      db = await window.MapleCommunity.ensureDb();
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

    const deviceId = window.MapleCommunity.getDeviceId();
    try {
      const existingDoc = await db.collection("stall_posts").doc(deviceId).get();
      if (existingDoc.exists) {
        const existing = existingDoc.data();
        const tsMs = existing.ts && existing.ts.toMillis ? existing.ts.toMillis() : 0;
        const remainMs = REFRESH_COOLDOWN_MS - (Date.now() - tsMs);
        // 冷卻不因已標記「已收攤」而提早解除——理由跟 guild.js 一樣，
        // firestore.rules 的 isRefresh() 也是同一套邏輯，兩邊要一起改
        if (remainMs > 0) {
          const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
          els.msg.textContent = `這台裝置剛發過一篇公告，距離上次發布還不到 1 小時，請再等約 ${remainMin} 分鐘才能重新發布（標記「已收攤」不受這個限制，隨時可以標記）`;
          els.msg.className = "cm-msg err";
          els.submitBtn.disabled = false;
          els.submitBtn.textContent = "送出";
          return;
        }
        // 舊貼文還在版上（沒過期也沒標記收攤）時，重新發布會直接取代它——
        // 不問一聲就默默蓋掉會讓使用者的舊公告無聲消失，先確認
        const oldStillActive = !existing.closed && Date.now() - tsMs < EXPIRE_MS;
        if (oldStillActive && !confirm("你已經有一篇還在版上的擺攤公告，重新發布會直接取代它（每台裝置同時只能有一篇）。確定要發布嗎？")) {
          els.submitBtn.disabled = false;
          els.submitBtn.textContent = "送出";
          return;
        }
      }
    } catch {
      // 冷卻檢查讀取失敗不擋發文，真正的防線在 firestore.rules 的
      // isRefresh()，這裡的提前檢查只是為了給比伺服器直接回絕更友善的訊息
    }

    try {
      await db.collection("stall_posts").doc(deviceId).set({
        type, server, channel, market, charId, description,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已發布！24 小時後會自動下架，結束了也可以自己提早下架";
      els.msg.className = "cm-msg ok";
      els.type.value = ""; els.server.value = ""; els.channel.value = ""; els.market.value = ""; els.charId.value = ""; els.description.value = "";
      updateDescriptionCount();
      updateDescriptionLabel();
      allPosts = [];
      await loadStallPosts();
    } catch (e) {
      if (e && e.code === "permission-denied") {
        els.msg.textContent = "送出被資料庫拒絕，可能是冷卻時間還沒到、或設定尚未同步，請稍後再試或回報給站長";
      } else if (e && e.code === "resource-exhausted") {
        els.msg.textContent = "今天的發文額度已滿，明天會自動恢復，麻煩明天再試一次";
      } else {
        els.msg.textContent = "送出失敗，請稍後再試";
      }
      els.msg.className = "cm-msg err";
    } finally {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "送出";
    }
  }
  els.submitBtn.addEventListener("click", submitStallPost);

  // 載入世代計數，用途跟 community.js 的 loadGen 一樣：在途補抓回來時
  // 世代已變（送出成功觸發整批重載）就丟棄，避免舊批次疊進新清單
  let loadGen = 0;

  async function loadStallPosts(append = false) {
    if (!append) {
      if (allPosts.length && Date.now() - lastLoadedAt < CACHE_MS) {
        renderStallPosts();
        return;
      }
      els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
      allPosts = [];
      lastDoc = null;
      loadGen++;
    }
    const gen = loadGen;
    lastLoadFailed = false;
    try {
      let db = null;
      try {
        db = await window.MapleCommunity.ensureDb();
      } catch {
        els.list.innerHTML = '<p class="cm-empty">連線失敗，請檢查網路後重新整理頁面</p>';
        hasMoreFromServer = false;
        lastLoadFailed = true;
        return;
      }
      if (!db) {
        els.list.innerHTML = '<p class="cm-empty">社群資料庫尚未開放，敬請期待。</p>';
        hasMoreFromServer = false;
        return;
      }
      // 直接在查詢端擋掉「發文超過 24 小時」的過期文件，跟 orderBy 是
      // 同一個欄位（ts），不需要額外設定複合索引。多抓 1 筆只用來判斷
      // 「後面還有沒有資料」，做法跟 community.js 的 exp_records 一樣
      const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - EXPIRE_MS);
      let query = db.collection("stall_posts")
        .where("ts", ">=", cutoff)
        .orderBy("ts", "desc")
        .limit(PAGE_SIZE + 1);
      if (append && lastDoc) query = query.startAfter(lastDoc);
      const snap = await query.get();
      if (gen !== loadGen) return; // 世代已變，這批是舊清單的下一批，丟棄
      const hasExtra = snap.docs.length > PAGE_SIZE;
      const pageDocs = hasExtra ? snap.docs.slice(0, PAGE_SIZE) : snap.docs;
      const newPosts = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
      lastDoc = pageDocs[pageDocs.length - 1] || null;
      allPosts = append ? [...allPosts, ...newPosts] : newPosts;
      lastLoadedAt = Date.now();
      hasMoreFromServer = hasExtra;
      renderStallPosts();
    } catch (e) {
      if (gen !== loadGen) return;
      let msg = "載入失敗，請重新整理頁面";
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        msg = "目前似乎沒有網路連線，請檢查後重新整理頁面";
      } else if (e && e.code === "permission-denied") {
        msg = "資料庫拒絕了這次讀取，可能是功能暫時維護中；稍後重新整理頁面再試一次";
      } else if (e && e.code === "unavailable") {
        msg = "連不上資料庫伺服器，請稍後重新整理頁面";
      } else if (e && e.code === "resource-exhausted") {
        msg = "今天社群功能的使用量已達上限，明天會自動恢復，其他功能不受影響";
      }
      lastLoadFailed = true;
      // 補抓失敗時別把已經顯示的公告整片換成錯誤訊息，理由跟 team.js／
      // community.js 的 exp_records 一樣
      if (append && allPosts.length) {
        hasMoreFromServer = false;
        renderStallPosts();
        els.pagination.innerHTML = `<p class="cm-empty">${msg}</p>`;
        return;
      }
      els.list.innerHTML = `<p class="cm-empty">${msg}</p>`;
    }
  }

  function renderStallPosts() {
    const now = Date.now();
    const deviceId = window.MapleCommunity.getDeviceId();
    // 過期過濾已經在 Firestore 查詢端做過一次（where ts >= cutoff），這裡
    // 的 CACHE_MS 快取視窗內時間會往前走，所以還是要再篩一次，避免快取
    // 住的資料裡混進「查詢當下沒過期、現在已經過期」的邊界情況。
    // closed（已標記收攤）沒有做進 Firestore 查詢條件，前端濾掉比較省事，
    // 理由跟 team.js 的 found 欄位一樣。
    const notExpired = allPosts.filter((p) => {
      const t = p.ts && p.ts.toDate ? p.ts.toDate().getTime() : 0;
      return now - t < EXPIRE_MS && !p.closed;
    });
    // type 是 2026-07-25 才加的欄位，加之前的舊資料沒有這個欄位——篩選
    // 「賣」或「收」時，沒有 type 的舊貼文兩邊都篩不到（只會出現在「全部」），
    // 不會被誤分類，也不會直接消失不見
    const byType = activeType ? notExpired.filter((p) => p.type === activeType) : notExpired;
    const filtered = activeServer ? byType.filter((p) => p.server === activeServer) : byType;
    // 新發的排前面：越新的攤位資訊越可能還在，舊的即使還沒過期也比較
    // 可能已經收攤了
    filtered.sort((a, b) => {
      const ta = a.ts && a.ts.toDate ? a.ts.toDate() : new Date(0);
      const tb = b.ts && b.ts.toDate ? b.ts.toDate() : new Date(0);
      return tb - ta;
    });

    if (!filtered.length) {
      // 已載入的這幾批裡沒有符合條件的，不代表伺服器上真的沒有——篩選
      // 只在前端做，資料還沒抓完的情況下不能先下「沒有符合條件」的結論，
      // 做法跟 team.js／community.js 的 exp_records 一樣
      if (hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
        autoFetchRounds++;
        els.list.innerHTML = '<p class="cm-loading">在更多的公告中搜尋...</p>';
        els.pagination.innerHTML = "";
        loadStallPosts(true);
        return;
      }
      // 如果上一次讀取本來就失敗了，畫面已經顯示正確的錯誤訊息，這裡不能
      // 因為 allPosts 剛好是空的就蓋成「還沒有擺攤公告」——點篩選按鈕不會
      // 重新觸發載入，失敗狀態要維持到使用者真的重新整理頁面為止
      if (lastLoadFailed && !allPosts.length) return;
      els.list.innerHTML = !allPosts.length
        ? '<p class="cm-empty">目前還沒有公告，第一個發起看看吧！</p>'
        : hasMoreFromServer
          ? `<p class="cm-empty">最近載入的 ${allPosts.length} 筆公告中沒有符合條件的，可以換個篩選條件再試</p>`
          : '<p class="cm-empty">目前沒有符合篩選條件、還在有效期內的公告</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    // 篩選後已載入的資料不夠撐滿目前頁碼，但 Firestore 那邊還有更多，先補抓再重繪
    if (currentPage > totalPages && hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
      autoFetchRounds++;
      els.pagination.innerHTML = '<p class="cm-loading">載入更多公告中...</p>';
      loadStallPosts(true);
      return;
    }
    if (currentPage > totalPages) currentPage = totalPages;
    const pagePosts = MaplePagination.slice(filtered, currentPage, PAGE_SIZE);

    els.list.innerHTML =
      '<div class="cm-grid">' +
      pagePosts.map((p) => {
        const isMine = p.id === deviceId;
        // 舊資料（type 欄位加進來之前發的）沒有 type，不硬塞一個看起來
        // 像分類錯誤的標籤，乾脆不顯示
        const typeTag = p.type ? `【${escHtml(p.type)}】` : "";
        return `<div class="cm-card">
          <div class="cm-job">${typeTag}${escHtml(p.server)}・頻道 ${p.channel}｜${escHtml(p.market)}</div>
          <div class="cm-stat"><span>角色 ID</span><span>${escHtml(p.charId)}</span></div>
          <div class="cm-note">${escHtml(p.description)}</div>
          ${isMine ? `<div class="cm-card-footer">
            <button class="cm-helpful-btn cm-stall-closed-btn" data-id="${p.id}" type="button">✓ 已結束，下架這篇</button>
          </div>` : ""}
        </div>`;
      }).join("") +
      "</div>";

    MaplePagination.render(els.pagination, {
      total: filtered.length,
      page: currentPage,
      pageSize: PAGE_SIZE,
      // Firestore 還有更早批次沒抓完時，讓最後一頁的「›」保持可按——按下去
      // currentPage 會超過 totalPages，走上面既有的補抓路徑載入下一批
      hasMore: hasMoreFromServer,
      onChange: (p) => { currentPage = p; renderStallPosts(); },
    });
    // 篩選都只在已載入的資料內做，資料還沒抓完時如果不講，篩選結果看起來
    // 像涵蓋全部公告，其實只涵蓋最近幾批
    if (hasMoreFromServer) {
      els.pagination.insertAdjacentHTML(
        "beforeend",
        `<p class="cm-range-hint">目前涵蓋已載入的 ${allPosts.length} 筆公告，按「›」可繼續載入更早發布的公告</p>`
      );
    }
    // 成功渲染出結果 = 這一輪補抓鏈結束，下一次篩空可以重新往下搜
    autoFetchRounds = 0;
  }

  // 單一委派監聽器（在初始化時綁一次），跟 team.js 的 onFoundClick 同一套做法
  function onClosedClick(e) {
    const btn = e.target.closest(".cm-stall-closed-btn");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;

    if (!confirm("確定要標記這篇公告已經結束、下架這篇貼文嗎？這個動作沒辦法復原。")) return;

    // 離線時 Firestore 的 update 不會 reject，會永久卡在「處理中...」
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      btn.textContent = "沒有網路，稍後再試";
      setTimeout(() => { btn.textContent = "✓ 已結束，下架這篇"; }, 2000);
      return;
    }

    btn.disabled = true;
    btn.textContent = "處理中...";
    window.MapleCommunity.ensureDb().then((db) => {
      if (!db) throw new Error("no-db");
      return db.collection("stall_posts").doc(id).update({ closed: true });
    }).then(() => {
      allPosts = allPosts.filter((p) => p.id !== id);
      renderStallPosts();
    }).catch(() => {
      btn.disabled = false;
      btn.textContent = "標記失敗，再按一次試試";
    });
  }
  els.list.addEventListener("click", onClosedClick);

  // 交易類型（賣／收）篩選按鈕是靜態寫在 HTML 裡的（只有伺服器篩選那組
  // 才是動態插入），這裡直接綁一次即可
  els.typeFilterBtns.querySelectorAll(".cm-sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.typeFilterBtns.querySelectorAll(".cm-sort-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeType = btn.dataset.type;
      currentPage = 1;
      autoFetchRounds = 0;
      renderStallPosts();
    });
  });

  // 伺服器篩選按鈕是進 render() 前（伺服器清單載入時）才動態插入的，這裡直接
  // querySelectorAll 綁一次即可，不用委派監聽
  els.serverFilterBtns.querySelectorAll(".cm-sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.serverFilterBtns.querySelectorAll(".cm-sort-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeServer = btn.dataset.server;
      currentPage = 1;
      autoFetchRounds = 0;
      renderStallPosts();
    });
  });

  function render() {
    loadStallPosts();
  }

  // 頁面重新整理時「我是不是已經是攤開的分頁」這個初次載入判斷，統一
  // 交給 nav.js 做（見 nav.js 的 switchNav() 註解）——那裡是唯一保證
  // community.js／team.js／stall.js 都已經載完、也知道最終主分頁是不是
  // #pageCm 的地方。這裡以前自己土法煉鋼判斷過兩次都各自有時機漏洞
  // （第一版沒檢查 #pageCm、第二版檢查了但自己執行的當下 nav.js 根本
  // 還沒跑，#pageCm 必然還是隱藏的，一樣判斷失敗），教訓是這類「我到底
  // 會不會被看到」的判斷不該分散在各個模組自己猜，交給真正知道答案的
  // 那一個地方做。
  window.MapleStall = { render };
})();
