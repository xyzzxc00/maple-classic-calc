/**
 * team.js — 組隊揪團公告板（Firestore team_posts）
 * -----------------------------------------------------------------
 * 跟 community.js 共用同一個 Firebase app／db（透過 window.MapleCommunity.
 * ensureDb()），不要自己 initializeApp 一次。
 *
 * 揪團貼文是短期資訊，設計上不走 exp_records 那種「無限累積、翻頁翻到底」
 * 的模式：一次抓最近 100 筆（依 ts 新到舊），過濾掉發布超過 TTL_MS 的
 * 貼文，剩下的在前端做類型篩選＋分頁。量級上揪團貼文不會像練功回報那樣
 * 一直累積（過期就不再顯示），單批 100 筆對「找得到還在有效期內的貼文」
 * 綽綽有餘，不需要 community.js 那套「篩空自動補抓下一批」的複雜邏輯。
 *
 * 到期只在前端過濾，Firestore 裡的舊資料不會被刪除，理論上集合會無限
 * 變大。目前量級太小不值得處理；真的長很大的話，可以另外用
 * `gcloud firestore fields ttls update` 幫 ts 欄位設原生 TTL policy，
 * 讓 Firestore 自動清掉過期文件，不用改這裡的程式碼。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    typeFilterBtns: document.querySelectorAll("#cmTeamView .cm-sort-btn"),
    addBtn: document.getElementById("teamAddBtn"),
    form: document.getElementById("teamForm"),
    type: document.getElementById("teamType"),
    target: document.getElementById("teamTarget"),
    server: document.getElementById("teamServer"),
    map: document.getElementById("teamMap"),
    contact: document.getElementById("teamContact"),
    job: document.getElementById("teamJob"),
    level: document.getElementById("teamLevel"),
    currentCount: document.getElementById("teamCurrentCount"),
    neededCount: document.getElementById("teamNeededCount"),
    note: document.getElementById("teamNote"),
    submitBtn: document.getElementById("teamSubmitBtn"),
    cancelBtn: document.getElementById("teamCancelBtn"),
    msg: document.getElementById("teamMsg"),
    list: document.getElementById("teamList"),
    pagination: document.getElementById("teamPagination"),
  };
  if (!els.form) return;

  const TTL_MS = 6 * 60 * 60 * 1000; // 6 小時，跟設計討論時定的一致
  const FETCH_LIMIT = 100;
  const CACHE_MS = 60 * 1000; // 跟 community.js 同標準：60 秒內重複進分頁用快取

  const escHtml = MapleCalculator.escHtml;

  // 伺服器／職業下拉選單都是資料驅動，改 teamData.js／jobsData.js 就會
  // 自動反映，不用兩邊維護
  if (window.MapleTeamServers) {
    els.server.insertAdjacentHTML(
      "beforeend",
      window.MapleTeamServers.map((s) => `<option value="${s}">${s}</option>`).join("")
    );
  }
  if (window.MapleJobOptionsHtml) {
    els.job.insertAdjacentHTML("beforeend", window.MapleJobOptionsHtml);
  }

  // 目標欄位原本規劃是依揪團類型從野王/任務清單下拉選，但遊戲還沒正式
  // 上線，實際的任務/王的名稱都還不確定，先開放自由輸入；等正式資料
  // 出來後如果想改回下拉選單，可以參考 git 紀錄裡拿掉的版本。

  let allPosts = [];
  let lastLoadedAt = 0;
  let lastLoadFailed = false;
  let loadsInFlight = 0;
  let currentPage = 1;
  let activeType = ""; // "" = 全部

  let formOpen = false;
  function setFormOpen(open) {
    formOpen = open;
    els.form.hidden = !open;
    els.addBtn.textContent = open ? "✕ 收起" : "＋ 我要揪團";
  }
  els.addBtn.addEventListener("click", () => setFormOpen(!formOpen));
  els.cancelBtn.addEventListener("click", () => setFormOpen(false));

  async function submitTeamPost() {
    const type = els.type.value;
    const target = els.target.value.trim();
    const server = els.server.value;
    const map = els.map.value.trim();
    const contact = els.contact.value.trim();
    const job = els.job.value;
    const level = parseInt(els.level.value, 10);
    const currentCount = parseInt(els.currentCount.value, 10);
    const neededCount = parseInt(els.neededCount.value, 10);
    const note = els.note.value.trim();

    // 逐欄給對應訊息，理由跟 community.js 的 submitRecord 一樣：全部欄位
    // 共用一句「請填寫所有必填欄位」會讓人猜不出到底哪一欄有問題
    let fieldError = "";
    if (!type) fieldError = "請選擇揪團類型";
    else if (!target) fieldError = "請輸入目標";
    else if (!server) fieldError = "請選擇伺服器";
    else if (!map) fieldError = "請輸入集合地點";
    else if (!contact) fieldError = "請輸入聯絡方式";
    else if (!job) fieldError = "請選擇發起人職業";
    else if (isNaN(level) || level < 1 || level > 200) fieldError = "請輸入有效的發起人等級（1~200）";
    else if (isNaN(currentCount) || currentCount < 0 || currentCount > 6) fieldError = "請輸入有效的目前人數（0~6）";
    else if (isNaN(neededCount) || neededCount < 1 || neededCount > 6) fieldError = "請輸入有效的需要人數（1~6）";
    else if (currentCount > neededCount) fieldError = "目前人數不能超過需要人數";

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
      await db.collection("team_posts").add({
        type, target, server, map, contact, job, level,
        currentCount, neededCount,
        ...(note && { note }),
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已發布！6 小時後會自動下架，找到人不用回來關閉";
      els.msg.className = "cm-msg ok";
      els.target.value = ""; els.map.value = ""; els.contact.value = "";
      els.job.value = ""; els.level.value = "";
      els.currentCount.value = ""; els.neededCount.value = ""; els.note.value = "";
      allPosts = [];
      await loadTeamPosts();
    } catch (e) {
      // 跟 community.js 一樣分開講 permission-denied／resource-exhausted，
      // 不然使用者猜不出「重試有沒有用」
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
  els.submitBtn.addEventListener("click", submitTeamPost);

  async function loadTeamPosts() {
    if (allPosts.length && Date.now() - lastLoadedAt < CACHE_MS) {
      renderTeamPosts();
      return;
    }
    els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
    lastLoadFailed = false;
    loadsInFlight++;
    try {
      let db = null;
      try {
        db = await window.MapleCommunity.ensureDb();
      } catch {
        lastLoadFailed = true;
        els.list.innerHTML = '<p class="cm-empty">連線失敗，請檢查網路後重新整理頁面</p>';
        return;
      }
      if (!db) {
        els.list.innerHTML = '<p class="cm-empty">社群資料庫尚未開放，敬請期待。</p>';
        return;
      }
      const snap = await db.collection("team_posts").orderBy("ts", "desc").limit(FETCH_LIMIT).get();
      allPosts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      lastLoadedAt = Date.now();
      renderTeamPosts();
    } catch (e) {
      lastLoadFailed = true;
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
    } finally {
      loadsInFlight--;
    }
  }

  function formatRemaining(expiresInMs) {
    const mins = Math.max(0, Math.round(expiresInMs / 60000));
    if (mins < 60) return `還剩 ${mins} 分鐘`;
    return `還剩 ${Math.floor(mins / 60)} 小時 ${mins % 60} 分鐘`;
  }

  function renderTeamPosts() {
    const now = Date.now();
    // 到期時間純前端過濾：ts 是 Firestore serverTimestamp，剛送出去、
    // 還沒從伺服器讀回來前本地看到的可能是 pending 狀態，.toDate() 仍然
    // 可用（會是送出當下的本機時間），不會噴例外
    const notExpired = allPosts.filter((p) => {
      const t = p.ts && p.ts.toDate ? p.ts.toDate().getTime() : 0;
      return now - t < TTL_MS;
    });
    const filtered = activeType ? notExpired.filter((p) => p.type === activeType) : notExpired;
    filtered.sort((a, b) => {
      const ta = a.ts && a.ts.toDate ? a.ts.toDate() : new Date(0);
      const tb = b.ts && b.ts.toDate ? b.ts.toDate() : new Date(0);
      return tb - ta;
    });

    if (!filtered.length) {
      els.list.innerHTML = loadsInFlight > 0
        ? '<p class="cm-loading">載入中...</p>'
        : !allPosts.length
          ? '<p class="cm-empty">目前還沒有揪團貼文，第一個發起看看吧！</p>'
          : '<p class="cm-empty">目前沒有符合篩選條件、還在有效期內的揪團貼文</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / MaplePagination.PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pagePosts = MaplePagination.slice(filtered, currentPage);

    els.list.innerHTML =
      '<div class="cm-grid">' +
      pagePosts.map((p) => {
        const t = p.ts && p.ts.toDate ? p.ts.toDate().getTime() : now;
        const remaining = formatRemaining(TTL_MS - (now - t));
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(p.type)}｜${escHtml(p.target)}</div>
          <div class="cm-map">${escHtml(p.server)}・${escHtml(p.map)}</div>
          <div class="cm-stat"><span>發起人</span><span>${escHtml(p.job)} Lv.${p.level}</span></div>
          <div class="cm-stat"><span>人數</span><span>${p.currentCount} / ${p.neededCount}</span></div>
          <div class="cm-stat"><span>聯絡方式</span><span>${escHtml(p.contact)}</span></div>
          ${p.note ? `<div class="cm-note">${escHtml(p.note)}</div>` : ""}
          <div class="cm-card-footer">
            <span class="cm-ts">${remaining}</span>
          </div>
        </div>`;
      }).join("") +
      "</div>";

    MaplePagination.render(els.pagination, {
      total: filtered.length,
      page: currentPage,
      onChange: (p) => { currentPage = p; renderTeamPosts(); },
    });
  }

  els.typeFilterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.typeFilterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeType = btn.dataset.type;
      currentPage = 1;
      renderTeamPosts();
    });
  });

  function render() {
    loadTeamPosts();
  }

  window.MapleTeam = { render };
})();
