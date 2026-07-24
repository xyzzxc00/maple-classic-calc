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
  const FETCH_LIMIT = 100;
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
  let lastLoadedAt = 0;
  let currentPage = 1;
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

  async function loadStallPosts() {
    if (allPosts.length && Date.now() - lastLoadedAt < CACHE_MS) {
      renderStallPosts();
      return;
    }
    els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
    try {
      let db = null;
      try {
        db = await window.MapleCommunity.ensureDb();
      } catch {
        els.list.innerHTML = '<p class="cm-empty">連線失敗，請檢查網路後重新整理頁面</p>';
        return;
      }
      if (!db) {
        els.list.innerHTML = '<p class="cm-empty">社群資料庫尚未開放，敬請期待。</p>';
        return;
      }
      // 直接在查詢端擋掉「發文超過 24 小時」的過期文件，跟 orderBy 是
      // 同一個欄位（ts），不需要額外設定複合索引
      const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - EXPIRE_MS);
      const snap = await db.collection("stall_posts")
        .where("ts", ">=", cutoff)
        .orderBy("ts", "desc")
        .limit(FETCH_LIMIT)
        .get();
      allPosts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      lastLoadedAt = Date.now();
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
      els.list.innerHTML = !allPosts.length
        ? '<p class="cm-empty">目前還沒有擺攤公告，第一個發起看看吧！</p>'
        : '<p class="cm-empty">目前沒有符合篩選條件、還在有效期內的擺攤公告</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / MaplePagination.PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pagePosts = MaplePagination.slice(filtered, currentPage);

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
      onChange: (p) => { currentPage = p; renderStallPosts(); },
    });
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
  if (!document.getElementById("cmStallView").hidden) {
    render();
  }
})();
