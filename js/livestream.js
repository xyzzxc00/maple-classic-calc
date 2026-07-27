/**
 * livestream.js — 實況宣傳公告（Firestore livestream_posts）
 * -----------------------------------------------------------------
 * 跟 community.js／team.js／stall.js／guild.js 共用同一個 Firebase
 * app／db（透過 window.MapleCommunity.ensureDb()），不要自己
 * initializeApp 一次。
 *
 * 獨立成自己的子分頁，沒有跟公會招募合併：兩者「想找的東西」不一樣
 * （公會招募找隊友、實況宣傳找觀眾），混在同一個列表裡等於在類別層級
 * 重現了「一直重複貼擠掉別人」的問題，只是從個人洗版變成整個分類互相
 * 擠壓，所以拆成獨立的板。
 *
 * 連結是這個板特有的風險——其他三個板都是純文字資料，這裡貼的是外部
 * 網址，多了一個「有人塞惡意／釣魚連結」的攻擊面。只放行 Twitch／
 * YouTube 網域（見 ALLOWED_URL_PATTERN），不開放任意網址；真正的防線
 * 在 firestore.rules 的 isValidNew() 用同一個規則做網域比對，前端這裡
 * 的檢查只是先給使用者一個清楚的錯誤訊息。
 *
 * platform（顯示用的「Twitch」／「YouTube」標籤）不是存進 Firestore 的
 * 欄位，是每次渲染時直接從 url 判斷出來的（detectPlatform()）——這樣
 * 就不會有「使用者選了 Twitch、卻貼 YouTube 連結」這種欄位跟實際內容
 * 對不上的情況，也少一個要在規則裡驗證的欄位。篩選按鈕同理，直接對
 * 判斷出來的 platform 做篩選。
 *
 * 「一人一則＋冷卻」的設計跟 team.js／stall.js／guild.js 完全一樣：
 * 文件 ID 用 window.MapleCommunity.getDeviceId()，doc(deviceId).set()
 * 覆蓋舊文件；firestore.rules 的 isRefresh() 擋 1 小時內的重複覆蓋，
 * 不因標記過「已下架」而提早解除（不然會被拿來「標記已下架→立刻
 * 重發」無限循環繞過冷卻）。細節見那三個檔案開頭的說明，這裡不重複
 * 贅述。
 *
 * 到期規則跟公會招募一樣，發文 7 天後自動下架（前端查詢端用 where
 * ts >= cutoff 擋掉），資料本身不會被刪除，理論上集合會無限變大，量級
 * 小的時候不用管，理由跟 stall.js／guild.js 開頭註解一樣。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    filterBtns: document.getElementById("livestreamFilterBtns"),
    addBtn: document.getElementById("livestreamAddBtn"),
    form: document.getElementById("livestreamForm"),
    channelName: document.getElementById("livestreamChannelName"),
    url: document.getElementById("livestreamUrl"),
    description: document.getElementById("livestreamDescription"),
    descriptionCount: document.getElementById("livestreamDescCount"),
    submitBtn: document.getElementById("livestreamSubmitBtn"),
    cancelBtn: document.getElementById("livestreamCancelBtn"),
    msg: document.getElementById("livestreamMsg"),
    list: document.getElementById("livestreamList"),
    pagination: document.getElementById("livestreamPagination"),
  };
  if (!els.form) return;

  const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000; // 固定 7 天，跟公會招募同標準
  const PAGE_SIZE = 12;
  const MAX_AUTO_FETCH_ROUNDS = 10;
  const CACHE_MS = 60 * 1000;
  // 一人一則的冷卻時間，跟 team.js／stall.js／guild.js 同標準
  const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

  // 只接受 Twitch／YouTube 的連結，前端跟 firestore.rules 要用同一個
  // 網域白名單（規則那邊沒辦法讀這個常數，改動時兩邊要同步）。強制
  // https，不開放 http。
  const ALLOWED_URL_PATTERN = /^https:\/\/(www\.)?(twitch\.tv|youtube\.com|youtu\.be)\/.+/i;

  function detectPlatform(url) {
    if (/twitch\.tv/i.test(url)) return "Twitch";
    if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube";
    return "其他";
  }

  const escHtml = MapleCalculator.escHtml;

  const updateDescriptionCount = MapleFormGuard.attach(els.description, 100, els.descriptionCount);
  MapleFormGuard.attach(els.channelName, 20);
  MapleFormGuard.attach(els.url, 200);

  let allPosts = [];
  let lastDoc = null;
  let hasMoreFromServer = false;
  let lastLoadFailed = false;
  let lastLoadedAt = 0;
  let currentPage = 1;
  let autoFetchRounds = 0;
  let activePlatform = ""; // "" = 全部

  let formOpen = false;
  function setFormOpen(open) {
    formOpen = open;
    els.form.hidden = !open;
    els.addBtn.textContent = open ? "✕ 收起" : "＋ 我要宣傳";
  }
  els.addBtn.addEventListener("click", () => setFormOpen(!formOpen));
  els.cancelBtn.addEventListener("click", () => setFormOpen(false));

  async function submitLivestreamPost() {
    const channelName = els.channelName.value.trim();
    const url = els.url.value.trim();
    const description = els.description.value.trim();

    let fieldError = "";
    if (!channelName) fieldError = "請輸入頻道／實況主名稱";
    else if (!url) fieldError = "請輸入實況頻道連結";
    else if (!ALLOWED_URL_PATTERN.test(url)) fieldError = "連結只接受 Twitch（twitch.tv）或 YouTube（youtube.com／youtu.be）的網址";
    else if (!description) fieldError = "請輸入簡介";

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

    const deviceId = window.MapleCommunity.getDeviceId();
    try {
      const existingDoc = await db.collection("livestream_posts").doc(deviceId).get();
      if (existingDoc.exists) {
        const existing = existingDoc.data();
        const tsMs = existing.ts && existing.ts.toMillis ? existing.ts.toMillis() : 0;
        const remainMs = REFRESH_COOLDOWN_MS - (Date.now() - tsMs);
        // 冷卻不因已標記「已下架」而提早解除——理由跟 guild.js 一樣，
        // firestore.rules 的 isRefresh() 也是同一套邏輯，兩邊要一起改
        if (remainMs > 0) {
          const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
          els.msg.textContent = `這台裝置剛發過一篇實況宣傳，距離上次發布還不到 1 小時，請再等約 ${remainMin} 分鐘才能重新發布（標記「已下架」不受這個限制，隨時可以標記）`;
          els.msg.className = "cm-msg err";
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
      await db.collection("livestream_posts").doc(deviceId).set({
        channelName, url, description,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已發布！7 天後會自動下架，不再實況了也可以自己提早下架";
      els.msg.className = "cm-msg ok";
      els.channelName.value = ""; els.url.value = ""; els.description.value = "";
      updateDescriptionCount();
      allPosts = [];
      await loadLivestreamPosts();
    } catch (e) {
      if (e && e.code === "permission-denied") {
        els.msg.textContent = "送出被資料庫拒絕，可能是冷卻時間還沒到、連結不在允許的平台名單內、或設定尚未同步，請稍後再試或回報給站長";
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
  els.submitBtn.addEventListener("click", submitLivestreamPost);

  async function loadLivestreamPosts(append = false) {
    if (!append) {
      if (allPosts.length && Date.now() - lastLoadedAt < CACHE_MS) {
        renderLivestreamPosts();
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
      const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - EXPIRE_MS);
      let query = db.collection("livestream_posts")
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
      renderLivestreamPosts();
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
      if (append && allPosts.length) {
        hasMoreFromServer = false;
        renderLivestreamPosts();
        els.pagination.innerHTML = `<p class="cm-empty">${msg}</p>`;
        return;
      }
      els.list.innerHTML = `<p class="cm-empty">${msg}</p>`;
    }
  }

  function renderLivestreamPosts() {
    const now = Date.now();
    const deviceId = window.MapleCommunity.getDeviceId();
    const notExpired = allPosts.filter((p) => {
      const t = p.ts && p.ts.toDate ? p.ts.toDate().getTime() : 0;
      return now - t < EXPIRE_MS && !p.closed;
    });
    const filtered = activePlatform ? notExpired.filter((p) => detectPlatform(p.url) === activePlatform) : notExpired;
    filtered.sort((a, b) => {
      const ta = a.ts && a.ts.toDate ? a.ts.toDate() : new Date(0);
      const tb = b.ts && b.ts.toDate ? b.ts.toDate() : new Date(0);
      return tb - ta;
    });

    if (!filtered.length) {
      if (hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
        autoFetchRounds++;
        els.list.innerHTML = '<p class="cm-loading">在更多的宣傳中搜尋...</p>';
        els.pagination.innerHTML = "";
        loadLivestreamPosts(true);
        return;
      }
      if (lastLoadFailed && !allPosts.length) return;
      els.list.innerHTML = !allPosts.length
        ? '<p class="cm-empty">目前還沒有實況宣傳，第一個來宣傳看看吧！</p>'
        : hasMoreFromServer
          ? `<p class="cm-empty">最近載入的 ${allPosts.length} 筆宣傳中沒有符合條件的，可以換個篩選條件再試</p>`
          : '<p class="cm-empty">目前沒有符合篩選條件的實況宣傳</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages && hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
      autoFetchRounds++;
      els.pagination.innerHTML = '<p class="cm-loading">載入更多宣傳中...</p>';
      loadLivestreamPosts(true);
      return;
    }
    if (currentPage > totalPages) currentPage = totalPages;
    const pagePosts = MaplePagination.slice(filtered, currentPage, PAGE_SIZE);

    els.list.innerHTML =
      '<div class="cm-grid">' +
      pagePosts.map((p) => {
        const isMine = p.id === deviceId;
        const platform = detectPlatform(p.url);
        return `<div class="cm-card">
          <div class="cm-job">【${escHtml(platform)}】${escHtml(p.channelName)}</div>
          <div class="cm-note">${escHtml(p.description)}</div>
          <div class="cm-stat"><span>連結</span><span><a href="${escHtml(p.url)}" target="_blank" rel="noopener noreferrer nofollow ugc">前往頻道 →</a></span></div>
          ${isMine ? `<div class="cm-card-footer">
            <button class="cm-helpful-btn cm-livestream-closed-btn" data-id="${p.id}" type="button">✓ 已下架，停止宣傳</button>
          </div>` : ""}
        </div>`;
      }).join("") +
      "</div>";

    MaplePagination.render(els.pagination, {
      total: filtered.length,
      page: currentPage,
      pageSize: PAGE_SIZE,
      hasMore: hasMoreFromServer,
      onChange: (p) => { currentPage = p; renderLivestreamPosts(); },
    });
    if (hasMoreFromServer) {
      els.pagination.insertAdjacentHTML(
        "beforeend",
        `<p class="cm-range-hint">目前涵蓋已載入的 ${allPosts.length} 筆宣傳，按「›」可繼續載入更早發布的宣傳</p>`
      );
    }
    autoFetchRounds = 0;
  }

  function onClosedClick(e) {
    const btn = e.target.closest(".cm-livestream-closed-btn");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;

    if (!confirm("確定要下架這篇實況宣傳嗎？這個動作沒辦法復原。")) return;

    btn.disabled = true;
    btn.textContent = "處理中...";
    window.MapleCommunity.ensureDb().then((db) => {
      if (!db) throw new Error("no-db");
      return db.collection("livestream_posts").doc(id).update({ closed: true });
    }).then(() => {
      allPosts = allPosts.filter((p) => p.id !== id);
      renderLivestreamPosts();
    }).catch(() => {
      btn.disabled = false;
      btn.textContent = "標記失敗，再按一次試試";
    });
  }
  els.list.addEventListener("click", onClosedClick);

  els.filterBtns.querySelectorAll(".cm-sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.filterBtns.querySelectorAll(".cm-sort-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activePlatform = btn.dataset.platform;
      currentPage = 1;
      autoFetchRounds = 0;
      renderLivestreamPosts();
    });
  });

  function render() {
    loadLivestreamPosts();
  }

  // 頁面重新整理時的初次載入判斷統一交給 nav.js 做，理由見 nav.js 的
  // switchNav() 註解／stall.js 檔尾的同一段說明，這裡不自己土法煉鋼判斷。
  window.MapleLivestream = { render };
})();
