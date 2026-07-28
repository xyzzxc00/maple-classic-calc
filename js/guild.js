/**
 * guild.js — 公會招募公告（Firestore guild_posts）
 * -----------------------------------------------------------------
 * 跟 community.js／team.js／stall.js 共用同一個 Firebase app／db（透過
 * window.MapleCommunity.ensureDb()），不要自己 initializeApp 一次。
 *
 * 跟 stall.js 一樣有 ts + 固定時數的自動下架邏輯，只是時效拉長成 7 天
 * （招募是長期性的公告，不像擺攤 24 小時就該換一批）；中途招滿的話，
 * 發文者也可以自己標記「已招滿」提早手動下架（isMarkClosed，寫法跟
 * stall.js 一樣）。也沒有 type 篩選——這個板只有一種公告類型，篩選
 * 只需要伺服器。
 *
 * 2026-07-27 起改成「一人一則＋冷卻」：文件 ID 直接用
 * window.MapleCommunity.getDeviceId()（裝置層級識別碼，存在
 * localStorage，跟 team.js／stall.js／livestream.js 共用同一個值），
 * 用 doc(deviceId).set() 而不是 add()——同一台裝置永遠只有一篇公告，
 * 重新發布是覆蓋舊的那篇，不是疊加新的一筆。firestore.rules 用
 * isRefresh() 擋住太頻繁的覆蓋（1 小時內不能刷新，不因標記過「已招滿」
 * 而提早解除——不然會被拿來「標記已招滿→立刻重發」無限循環繞過冷卻），
 * 這裡在送出前先讀一次自己的舊文件、算冷卻剩餘時間，
 * 給比伺服器直接回絕更友善的錯誤訊息；真正的防線還是規則那邊，前端
 * 這層檢查只是體驗優化，讀取失敗也不擋發文。「這是我的貼文」（isMine，
 * 決定要不要顯示「已招滿」按鈕）現在直接比對文件 ID 是不是自己的
 * deviceId，不用再像以前那樣維護一份 localStorage 貼文 ID 清單。這一樣
 * 不是真正的身分驗證——清 localStorage 或換瀏覽器就是新裝置，是刻意的
 * 取捨（防洗版用的軟性機制，不是防駭客）。
 *
 * 卡片刻意做得比其他板大（.cm-card-lg），一頁預期抓 9 筆（3x3 排版），
 * 這個數字是先抓一個試試看，之後可能會依實際卡片高度調整。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    serverFilterBtns: document.getElementById("guildServerFilterBtns"),
    addBtn: document.getElementById("guildAddBtn"),
    form: document.getElementById("guildForm"),
    guildName: document.getElementById("guildName"),
    server: document.getElementById("guildServer"),
    memberCount: document.getElementById("guildMemberCount"),
    description: document.getElementById("guildDescription"),
    descriptionCount: document.getElementById("guildDescCount"),
    contact: document.getElementById("guildContact"),
    submitBtn: document.getElementById("guildSubmitBtn"),
    cancelBtn: document.getElementById("guildCancelBtn"),
    msg: document.getElementById("guildMsg"),
    list: document.getElementById("guildList"),
    pagination: document.getElementById("guildPagination"),
  };
  if (!els.form) return;

  const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000; // 固定 7 天，發文時系統自動套用，不用玩家選
  // 顯示的一頁筆數，跟每次跟 Firestore 要資料的批次大小共用同一個數字，
  // 做法跟 team.js／stall.js 一樣。卡片比較大，一頁抓少一點（9 筆＝3x3）
  const PAGE_SIZE = 9;
  // 篩選（伺服器）在前端做，篩空時會自動往伺服器補抓下一批；上限 10 批，
  // 做法跟 team.js／stall.js 一樣
  const MAX_AUTO_FETCH_ROUNDS = 10;
  const CACHE_MS = 60 * 1000; // 跟 community.js／team.js／stall.js 同標準
  // 一人一則的冷卻時間，跟 stall.js／team.js／livestream.js 同標準，
  // 之後想個別調整（例如招募內容變動比擺攤慢，拉長也合理）再分開改
  const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

  const escHtml = MapleCalculator.escHtml;

  // 簡介是多行 textarea，比其他板的單行欄位更容易讓人打到超過上限卻
  // 不知道為什麼字打不進去。IME 安全的裁切邏輯抽到 formGuard.js 跟
  // 揪團／擺攤／回報共用，這裡多掛即時字數計數
  const DESCRIPTION_MAX = 200;
  const updateDescriptionCount = MapleFormGuard.attach(els.description, DESCRIPTION_MAX, els.descriptionCount);
  MapleFormGuard.attach(els.guildName, 20);
  MapleFormGuard.attach(els.contact, 40);

  // 伺服器清單跟揪團／擺攤板共用同一份資料來源（teamData.js），不用另外維護一份
  if (window.MapleTeamServers) {
    els.server.insertAdjacentHTML(
      "beforeend",
      window.MapleTeamServers.map((s) => `<option value="${s}">${s}</option>`).join("")
    );
    els.serverFilterBtns.insertAdjacentHTML(
      "beforeend",
      window.MapleTeamServers.map((s) => `<button class="cm-sort-btn" data-server="${s}" type="button">${s}</button>`).join("")
    );
  }

  let allPosts = [];
  let lastDoc = null;
  let hasMoreFromServer = false; // Firestore 端是否還有下一批（PAGE_SIZE 筆一批）還沒抓進 allPosts
  let lastLoadFailed = false;
  let lastLoadedAt = 0;
  let currentPage = 1;
  let autoFetchRounds = 0;
  let activeServer = ""; // "" = 全部

  let formOpen = false;
  function setFormOpen(open) {
    formOpen = open;
    els.form.hidden = !open;
    els.addBtn.textContent = open ? "✕ 收起" : "＋ 我要招募";
  }
  els.addBtn.addEventListener("click", () => setFormOpen(!formOpen));
  els.cancelBtn.addEventListener("click", () => setFormOpen(false));

  // 板別開關（開關本體在 community.js 的 BOARDS_OPEN，跟 firestore.rules
  // 的 allow create 要一起改）
  const BOARD_OPEN = !window.MapleCommunity || window.MapleCommunity.isBoardOpen("guild");
  if (!BOARD_OPEN) {
    els.addBtn.disabled = true;
    els.addBtn.textContent = "暫時關閉維護中";
    els.addBtn.title = window.MapleCommunity.boardClosedMsg;
  }

  async function submitGuildPost() {
    if (!BOARD_OPEN) {
      els.msg.textContent = window.MapleCommunity.boardClosedMsg;
      els.msg.className = "cm-msg err";
      return;
    }
    const guildName = els.guildName.value.trim();
    const server = els.server.value;
    const memberCount = parseInt(els.memberCount.value, 10);
    const description = els.description.value.trim();
    const contact = els.contact.value.trim();

    let fieldError = "";
    let errEl = null;
    if (!guildName) { fieldError = "請輸入公會名稱"; errEl = els.guildName; }
    else if (!server) { fieldError = "請選擇伺服器"; errEl = els.server; }
    else if (isNaN(memberCount) || memberCount < 1 || memberCount > 500) { fieldError = "請輸入有效的目前人數（1~500）"; errEl = els.memberCount; }
    else if (!description) { fieldError = "請輸入公會簡介"; errEl = els.description; }
    else if (!contact) { fieldError = "請輸入聯絡方式"; errEl = els.contact; }

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
      const existingDoc = await db.collection("guild_posts").doc(deviceId).get();
      if (existingDoc.exists) {
        const existing = existingDoc.data();
        const tsMs = existing.ts && existing.ts.toMillis ? existing.ts.toMillis() : 0;
        const remainMs = REFRESH_COOLDOWN_MS - (Date.now() - tsMs);
        // 冷卻不因已標記「已招滿」而提早解除——不然會被拿來「標記已招滿→
        // 立刻重發」無限循環繞過冷卻，firestore.rules 的 isRefresh() 也是
        // 同一套邏輯，兩邊要一起改
        if (remainMs > 0) {
          const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
          els.msg.textContent = `這台裝置剛發過一篇招募公告，距離上次發布還不到 1 小時，請再等約 ${remainMin} 分鐘才能重新發布（標記「已招滿」不受這個限制，隨時可以標記）`;
          els.msg.className = "cm-msg err";
          els.submitBtn.disabled = false;
          els.submitBtn.textContent = "送出";
          return;
        }
        // 舊貼文還在版上（沒過期也沒標記招滿）時，重新發布會直接取代它——
        // 不問一聲就默默蓋掉會讓使用者的舊公告無聲消失，先確認
        const oldStillActive = !existing.closed && Date.now() - tsMs < EXPIRE_MS;
        if (oldStillActive && !confirm("你已經有一篇還在版上的招募公告，重新發布會直接取代它（每台裝置同時只能有一篇）。確定要發布嗎？")) {
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
      await db.collection("guild_posts").doc(deviceId).set({
        guildName, server, memberCount, description, contact,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已發布！7 天後會自動下架，招滿了也可以自己提早下架";
      els.msg.className = "cm-msg ok";
      els.guildName.value = ""; els.server.value = ""; els.memberCount.value = ""; els.description.value = ""; els.contact.value = "";
      updateDescriptionCount();
      allPosts = [];
      await loadGuildPosts();
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
  els.submitBtn.addEventListener("click", submitGuildPost);

  // 載入世代計數，用途跟 community.js 的 loadGen 一樣：在途補抓回來時
  // 世代已變（送出成功觸發整批重載）就丟棄，避免舊批次疊進新清單
  let loadGen = 0;

  async function loadGuildPosts(append = false) {
    if (!append) {
      if (allPosts.length && Date.now() - lastLoadedAt < CACHE_MS) {
        renderGuildPosts();
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
      // 直接在查詢端擋掉「發文超過 7 天」的過期文件，跟 orderBy 是同一個
      // 欄位（ts），不需要額外設定複合索引。多抓 1 筆只用來判斷「後面還
      // 有沒有資料」，做法跟 team.js／stall.js 一樣
      const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - EXPIRE_MS);
      let query = db.collection("guild_posts")
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
      renderGuildPosts();
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
      if (append && allPosts.length) {
        hasMoreFromServer = false;
        renderGuildPosts();
        els.pagination.innerHTML = `<p class="cm-empty">${msg}</p>`;
        return;
      }
      els.list.innerHTML = `<p class="cm-empty">${msg}</p>`;
    }
  }

  function renderGuildPosts() {
    const now = Date.now();
    const deviceId = window.MapleCommunity.getDeviceId();
    // 過期過濾已經在 Firestore 查詢端做過一次（where ts >= cutoff），這裡
    // 的 CACHE_MS 快取視窗內時間會往前走，所以還是要再篩一次，避免快取
    // 住的資料裡混進「查詢當下沒過期、現在已經過期」的邊界情況，理由跟
    // stall.js 一樣。closed（已標記招滿）沒有做進 Firestore 查詢條件，
    // 前端濾掉比較省事，理由跟 team.js 的 found／stall.js 的 closed 一樣
    const notExpired = allPosts.filter((p) => {
      const t = p.ts && p.ts.toDate ? p.ts.toDate().getTime() : 0;
      return now - t < EXPIRE_MS && !p.closed;
    });
    const filtered = activeServer ? notExpired.filter((p) => p.server === activeServer) : notExpired;
    filtered.sort((a, b) => {
      const ta = a.ts && a.ts.toDate ? a.ts.toDate() : new Date(0);
      const tb = b.ts && b.ts.toDate ? b.ts.toDate() : new Date(0);
      return tb - ta;
    });

    if (!filtered.length) {
      if (hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
        autoFetchRounds++;
        els.list.innerHTML = '<p class="cm-loading">在更多的公告中搜尋...</p>';
        els.pagination.innerHTML = "";
        loadGuildPosts(true);
        return;
      }
      if (lastLoadFailed && !allPosts.length) return;
      els.list.innerHTML = !allPosts.length
        ? '<p class="cm-empty">目前還沒有公會招募，第一個發起看看吧！</p>'
        : hasMoreFromServer
          ? `<p class="cm-empty">最近載入的 ${allPosts.length} 筆公告中沒有符合條件的，可以換個篩選條件再試</p>`
          : '<p class="cm-empty">目前沒有符合篩選條件的招募公告</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages && hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
      autoFetchRounds++;
      els.pagination.innerHTML = '<p class="cm-loading">載入更多公告中...</p>';
      loadGuildPosts(true);
      return;
    }
    if (currentPage > totalPages) currentPage = totalPages;
    const pagePosts = MaplePagination.slice(filtered, currentPage, PAGE_SIZE);

    els.list.innerHTML =
      '<div class="cm-grid">' +
      pagePosts.map((p) => {
        const isMine = p.id === deviceId;
        return `<div class="cm-card cm-card-lg">
          <div class="cm-job">${escHtml(p.guildName)}</div>
          <div class="cm-stat"><span>伺服器</span><span>${escHtml(p.server)}</span></div>
          <div class="cm-stat"><span>目前人數</span><span>${p.memberCount} 人</span></div>
          <div class="cm-note">${escHtml(p.description)}</div>
          <div class="cm-stat cm-stat-divider"><span>聯絡方式</span><span>${escHtml(p.contact)}</span></div>
          ${isMine ? `<div class="cm-card-footer">
            <button class="cm-helpful-btn cm-guild-closed-btn" data-id="${p.id}" type="button">✓ 已招滿，下架這篇</button>
          </div>` : ""}
        </div>`;
      }).join("") +
      "</div>";

    MaplePagination.render(els.pagination, {
      total: filtered.length,
      page: currentPage,
      pageSize: PAGE_SIZE,
      hasMore: hasMoreFromServer,
      onChange: (p) => { currentPage = p; renderGuildPosts(); },
    });
    if (hasMoreFromServer) {
      els.pagination.insertAdjacentHTML(
        "beforeend",
        `<p class="cm-range-hint">目前涵蓋已載入的 ${allPosts.length} 筆公告，按「›」可繼續載入更早發布的公告</p>`
      );
    }
    autoFetchRounds = 0;
  }

  // 單一委派監聽器（在初始化時綁一次），跟 team.js／stall.js 的做法一樣
  function onClosedClick(e) {
    const btn = e.target.closest(".cm-guild-closed-btn");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;

    if (!confirm("確定要標記這篇公會招募已經招滿、下架這篇貼文嗎？這個動作沒辦法復原。")) return;

    // 離線時 Firestore 的 update 不會 reject，會永久卡在「處理中...」
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      btn.textContent = "沒有網路，稍後再試";
      setTimeout(() => { btn.textContent = "✓ 已招滿，下架這篇"; }, 2000);
      return;
    }

    btn.disabled = true;
    btn.textContent = "處理中...";
    window.MapleCommunity.ensureDb().then((db) => {
      if (!db) throw new Error("no-db");
      return db.collection("guild_posts").doc(id).update({ closed: true });
    }).then(() => {
      allPosts = allPosts.filter((p) => p.id !== id);
      renderGuildPosts();
    }).catch(() => {
      btn.disabled = false;
      btn.textContent = "標記失敗，再按一次試試";
    });
  }
  els.list.addEventListener("click", onClosedClick);

  // 伺服器篩選按鈕是進 render() 前（伺服器清單載入時）才動態插入的，這裡直接
  // querySelectorAll 綁一次即可，不用委派監聽
  els.serverFilterBtns.querySelectorAll(".cm-sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.serverFilterBtns.querySelectorAll(".cm-sort-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeServer = btn.dataset.server;
      currentPage = 1;
      autoFetchRounds = 0;
      renderGuildPosts();
    });
  });

  function render() {
    loadGuildPosts();
  }

  // 頁面重新整理時的初次載入判斷統一交給 nav.js 做，理由見 nav.js 的
  // switchNav() 註解／stall.js 檔尾的同一段說明，這裡不自己土法煉鋼判斷。
  window.MapleGuild = { render };
})();
