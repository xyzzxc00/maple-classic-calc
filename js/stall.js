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
 * Firestore 裡過期後的舊文件不會被刪除，理論上集合會無限變大。目前
 * 量級太小不值得處理；真的長很大的話，可以用 `gcloud firestore fields
 * ttls update` 幫 ts 欄位設原生 TTL policy，讓 Firestore 自動清掉。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    serverFilterBtns: document.getElementById("stallServerFilterBtns"),
    addBtn: document.getElementById("stallAddBtn"),
    form: document.getElementById("stallForm"),
    server: document.getElementById("stallServer"),
    channel: document.getElementById("stallChannel"),
    market: document.getElementById("stallMarket"),
    charId: document.getElementById("stallCharId"),
    description: document.getElementById("stallDescription"),
    submitBtn: document.getElementById("stallSubmitBtn"),
    cancelBtn: document.getElementById("stallCancelBtn"),
    msg: document.getElementById("stallMsg"),
    list: document.getElementById("stallList"),
    pagination: document.getElementById("stallPagination"),
  };
  if (!els.form) return;

  const EXPIRE_MS = 24 * 60 * 60 * 1000; // 固定 24 小時，發文時系統自動套用，不用玩家選
  // 顯示的一頁筆數，跟每次跟 Firestore 要資料的批次大小共用同一個數字，
  // 做法跟 team.js 一樣，「按下一頁」＝「剛好去問伺服器要下一批」
  const PAGE_SIZE = 30;
  // 篩選（伺服器）在前端做，篩空時會自動往伺服器補抓下一批；上限 10 批 =
  // 最多自動搜 300 筆，做法跟 team.js／exp_records 一樣
  const MAX_AUTO_FETCH_ROUNDS = 10;
  const CACHE_MS = 60 * 1000; // 跟 community.js／team.js 同標準
  const MY_POSTS_KEY = "maple_classic_my_stall_posts";

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

  // 沒有帳號系統，用跟 team.js 一樣的做法：發文成功後把文件 ID 記在
  // localStorage，只有這個瀏覽器自己看得到「已收攤」按鈕。這是 UI 層的
  // 軟性限制，不是真的安全機制。
  function getMyPostIds() {
    try { return new Set(JSON.parse(localStorage.getItem(MY_POSTS_KEY)) || []); } catch { return new Set(); }
  }
  function saveMyPostId(id) {
    const s = getMyPostIds();
    s.add(id);
    localStorage.setItem(MY_POSTS_KEY, JSON.stringify([...s]));
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
  let activeServer = ""; // "" = 全部

  let formOpen = false;
  function setFormOpen(open) {
    formOpen = open;
    els.form.hidden = !open;
    els.addBtn.textContent = open ? "✕ 收起" : "＋ 我要公告擺攤";
  }
  els.addBtn.addEventListener("click", () => setFormOpen(!formOpen));
  els.cancelBtn.addEventListener("click", () => setFormOpen(false));

  async function submitStallPost() {
    const server = els.server.value;
    const channel = parseInt(els.channel.value, 10);
    const market = els.market.value.trim();
    const charId = els.charId.value.trim();
    const description = els.description.value.trim();

    let fieldError = "";
    if (!server) fieldError = "請選擇伺服器";
    else if (isNaN(channel) || channel < 1 || channel > 50) fieldError = "請輸入有效的頻道（1~50）";
    else if (!market) fieldError = "請輸入自由市場地點";
    else if (!charId) fieldError = "請輸入角色 ID";
    else if (!description) fieldError = "請輸入販售內容";

    if (fieldError) {
      els.msg.textContent = fieldError;
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

    try {
      const docRef = await db.collection("stall_posts").add({
        server, channel, market, charId, description,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      saveMyPostId(docRef.id);
      els.msg.textContent = "✓ 已發布！24 小時後會自動下架，收攤了也可以自己提早下架";
      els.msg.className = "cm-msg ok";
      els.server.value = ""; els.channel.value = ""; els.market.value = ""; els.charId.value = ""; els.description.value = "";
      allPosts = [];
      await loadStallPosts();
    } catch (e) {
      if (e && e.code === "permission-denied") {
        els.msg.textContent = "送出被資料庫拒絕，可能是設定尚未同步，請稍後再試或回報給站長";
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

  async function loadStallPosts(append = false) {
    if (!append) {
      if (allPosts.length && Date.now() - lastLoadedAt < CACHE_MS) {
        renderStallPosts();
        return;
      }
      els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
      allPosts = [];
      lastDoc = null;
    }
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
      const hasExtra = snap.docs.length > PAGE_SIZE;
      const pageDocs = hasExtra ? snap.docs.slice(0, PAGE_SIZE) : snap.docs;
      const newPosts = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
      lastDoc = pageDocs[pageDocs.length - 1] || null;
      allPosts = append ? [...allPosts, ...newPosts] : newPosts;
      lastLoadedAt = Date.now();
      hasMoreFromServer = hasExtra;
      renderStallPosts();
    } catch (e) {
      let msg = "載入失敗，請重新整理頁面";
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        msg = "目前似乎沒有網路連線，請檢查後重新整理頁面";
      } else if (e && e.code === "permission-denied") {
        msg = "資料庫拒絕了這次讀取，請重新整理頁面再試一次";
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
    const myPostIds = getMyPostIds();
    // 過期過濾已經在 Firestore 查詢端做過一次（where ts >= cutoff），這裡
    // 的 CACHE_MS 快取視窗內時間會往前走，所以還是要再篩一次，避免快取
    // 住的資料裡混進「查詢當下沒過期、現在已經過期」的邊界情況。
    // closed（已標記收攤）沒有做進 Firestore 查詢條件，前端濾掉比較省事，
    // 理由跟 team.js 的 found 欄位一樣。
    const notExpired = allPosts.filter((p) => {
      const t = p.ts && p.ts.toDate ? p.ts.toDate().getTime() : 0;
      return now - t < EXPIRE_MS && !p.closed;
    });
    const filtered = activeServer ? notExpired.filter((p) => p.server === activeServer) : notExpired;
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
        els.list.innerHTML = '<p class="cm-loading">在更多的擺攤公告中搜尋...</p>';
        els.pagination.innerHTML = "";
        loadStallPosts(true);
        return;
      }
      // 如果上一次讀取本來就失敗了，畫面已經顯示正確的錯誤訊息，這裡不能
      // 因為 allPosts 剛好是空的就蓋成「還沒有擺攤公告」——點篩選按鈕不會
      // 重新觸發載入，失敗狀態要維持到使用者真的重新整理頁面為止
      if (lastLoadFailed && !allPosts.length) return;
      els.list.innerHTML = !allPosts.length
        ? '<p class="cm-empty">目前還沒有擺攤公告，第一個發起看看吧！</p>'
        : hasMoreFromServer
          ? `<p class="cm-empty">最近載入的 ${allPosts.length} 筆公告中沒有符合條件的，可以換個伺服器篩選再試</p>`
          : '<p class="cm-empty">目前沒有符合篩選條件、還在有效期內的擺攤公告</p>';
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
        const isMine = myPostIds.has(p.id);
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(p.server)}・頻道 ${p.channel}｜${escHtml(p.market)}</div>
          <div class="cm-stat"><span>角色 ID</span><span>${escHtml(p.charId)}</span></div>
          <div class="cm-note">${escHtml(p.description)}</div>
          ${isMine ? `<div class="cm-card-footer">
            <button class="cm-helpful-btn cm-stall-closed-btn" data-id="${p.id}" type="button">✓ 已收攤，下架這篇</button>
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
        `<p class="cm-range-hint">目前涵蓋已載入的 ${allPosts.length} 筆公告，按「›」可繼續載入更早發布的擺攤公告</p>`
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

    if (!confirm("確定要標記這篇擺攤公告已經收攤、下架這篇貼文嗎？這個動作沒辦法復原。")) return;

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

  // 篩選按鈕是進 render() 前（伺服器清單載入時）才動態插入的，這裡直接
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

  window.MapleStall = { render };

  // 跟 team.js 同一個修法：<script defer> 是照 index.html 裡的順序依序
  // 執行，community.js 排在這支前面。使用者上次停在「擺攤資訊」分頁時，
  // 重新整理頁面會先跑 community.js 的「還原上次分頁」邏輯，那個當下
  // window.MapleStall 還不存在，只能把畫面切成可見、沒辦法真的觸發載入。
  // 這裡載完的當下自己檢查一次「我是不是已經是攤開的分頁」，是的話自己
  // 補一次 render()，不依賴兩支檔案誰先載完。
  //
  // 這裡要同時檢查 #pageCm 本身有沒有隱藏——只看 cmStallView 自己的話，
  // 使用者停在「計算工具」分頁、但上次瀏覽社群資料庫時最後停在擺攤資訊，
  // community.js 的「還原上次子分頁」邏輯還是會把 cmStallView 的 hidden
  // 拿掉（即使外層 #pageCm 整個是隱藏的），這裡會誤判成「已經是攤開的
  // 分頁」而載入 Firebase SDK 打 Firestore，違背「只有切到社群資料庫才
  // 載入」的設計（spots.js 的 render() 就是兩個都檢查，這裡要跟它一致）
  if (!document.getElementById("pageCm").hidden && !document.getElementById("cmStallView").hidden) {
    render();
  }
})();
