/**
 * team.js — 組隊揪團公告板（Firestore team_posts）
 * -----------------------------------------------------------------
 * 跟 community.js 共用同一個 Firebase app／db（透過 window.MapleCommunity.
 * ensureDb()），不要自己 initializeApp 一次。
 *
 * 兩個時間欄位不要搞混：
 *   - ts：發文時間（伺服器蓋章，serverTimestamp，使用者不能填）
 *   - scheduledAt：使用者填的「預計集合時間」，可以是未來時間（例如禮拜三
 *     先發禮拜六早上要揪團），列表排序、篩選、到期都是看這個欄位，不是 ts。
 *
 * 到期規則＝集合時間之後 GRACE_MS（6 小時）還沒被篩掉，就代表這場應該
 * 已經結束了，過濾掉。查詢直接在 Firestore 端用 where scheduledAt >=
 * (現在 - GRACE_MS) 擋掉，不用像 exp_records 那樣抓一大批回來前端過濾——
 * 這個 range 查詢跟 orderBy 是同一個欄位，Firestore 不需要額外的複合索引。
 *
 * Firestore 裡過期後的舊文件不會被刪除，理論上集合會無限變大。目前量級
 * 太小不值得處理；真的長很大的話，可以用 `gcloud firestore fields ttls
 * update` 幫 scheduledAt 設原生 TTL policy，讓 Firestore 自動清掉。
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
    scheduledAt: document.getElementById("teamScheduledAt"),
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

  const GRACE_MS = 6 * 60 * 60 * 1000; // 集合時間過後多久還算有效，跟原本 6 小時的設計一致
  const MAX_ADVANCE_MS = 7 * 24 * 60 * 60 * 1000; // 最多能提前 7 天發布
  const MIN_PAST_MS = 60 * 60 * 1000; // 集合時間最多容許比現在早 1 小時（給「現在就要揪」一點緩衝，不用卡到秒）
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

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  // <input type="datetime-local"> 要吃「本機時間」格式的字串（YYYY-MM-DDTHH:mm），
  // 用 toISOString() 會被轉成 UTC、時間對不上使用者看到的時區，要自己組
  function toDatetimeLocalValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  // min/max 是動態的（跟著「現在」走），每次打開表單才重新算，不要寫死在 HTML 裡
  function refreshScheduledAtBounds() {
    const now = Date.now();
    els.scheduledAt.min = toDatetimeLocalValue(new Date(now - MIN_PAST_MS));
    els.scheduledAt.max = toDatetimeLocalValue(new Date(now + MAX_ADVANCE_MS));
    if (!els.scheduledAt.value) els.scheduledAt.value = toDatetimeLocalValue(new Date(now));
  }

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
    if (open) refreshScheduledAtBounds();
  }
  els.addBtn.addEventListener("click", () => setFormOpen(!formOpen));
  els.cancelBtn.addEventListener("click", () => setFormOpen(false));

  async function submitTeamPost() {
    const type = els.type.value;
    const target = els.target.value.trim();
    const server = els.server.value;
    const map = els.map.value.trim();
    const scheduledAtRaw = els.scheduledAt.value;
    const scheduledAtDate = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
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
    else if (!scheduledAtDate || isNaN(scheduledAtDate.getTime())) fieldError = "請選擇集合時間";
    else if (scheduledAtDate.getTime() < Date.now() - MIN_PAST_MS) fieldError = "集合時間不能是過去的時間";
    else if (scheduledAtDate.getTime() > Date.now() + MAX_ADVANCE_MS) fieldError = "集合時間最多只能提前 7 天發布";
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
        scheduledAt: firebase.firestore.Timestamp.fromDate(scheduledAtDate),
        ...(note && { note }),
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已發布！集合時間過後 6 小時會自動下架，找到人不用回來關閉";
      els.msg.className = "cm-msg ok";
      els.target.value = ""; els.map.value = ""; els.contact.value = "";
      els.job.value = ""; els.level.value = "";
      els.currentCount.value = ""; els.neededCount.value = ""; els.note.value = "";
      els.scheduledAt.value = "";
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
      // 直接在查詢端擋掉「集合時間 + 6 小時 < 現在」的過期文件，不用抓一大批
      // 回來前端才過濾——range 條件跟 orderBy 是同一個欄位（scheduledAt），
      // 不需要額外設定複合索引
      const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - GRACE_MS);
      const snap = await db.collection("team_posts")
        .where("scheduledAt", ">=", cutoff)
        .orderBy("scheduledAt", "asc")
        .limit(FETCH_LIMIT)
        .get();
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

  // 把集合時間格式化成「7/26（六）11:00」，還沒到的加「（尚未開始）」語感留給
  // 卡片本身呈現就好，這裡只負責日期文字
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  function formatScheduled(date) {
    return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderTeamPosts() {
    const now = Date.now();
    // 過期過濾已經在 Firestore 查詢端做過一次（where scheduledAt >= cutoff），
    // 這裡的 CACHE_MS 快取視窗內時間會往前走，所以還是要再篩一次，避免
    // 快取住的資料裡混進「查詢當下沒過期、現在已經過期」的邊界情況
    const notExpired = allPosts.filter((p) => {
      const t = p.scheduledAt && p.scheduledAt.toDate ? p.scheduledAt.toDate().getTime() : 0;
      return now - t < GRACE_MS;
    });
    const filtered = activeType ? notExpired.filter((p) => p.type === activeType) : notExpired;
    // 依集合時間由近到遠排序：最快要開始的排最前面，對「找還來得及參加的
    // 揪團」比依發文時間排序更有用
    filtered.sort((a, b) => {
      const ta = a.scheduledAt && a.scheduledAt.toDate ? a.scheduledAt.toDate() : new Date(0);
      const tb = b.scheduledAt && b.scheduledAt.toDate ? b.scheduledAt.toDate() : new Date(0);
      return ta - tb;
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
        const t = p.scheduledAt && p.scheduledAt.toDate ? p.scheduledAt.toDate() : new Date(now);
        const started = t.getTime() <= now;
        const scheduledLabel = formatScheduled(t) + (started ? "（進行中／已開始）" : "");
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(p.type)}｜${escHtml(p.target)}</div>
          <div class="cm-map">${escHtml(p.server)}・${escHtml(p.map)}</div>
          <div class="cm-stat"><span>集合時間</span><span>${scheduledLabel}</span></div>
          <div class="cm-stat"><span>發起人</span><span>${escHtml(p.job)} Lv.${p.level}</span></div>
          <div class="cm-stat"><span>人數</span><span>${p.currentCount} / ${p.neededCount}</span></div>
          <div class="cm-stat"><span>聯絡方式</span><span>${escHtml(p.contact)}</span></div>
          ${p.note ? `<div class="cm-note">${escHtml(p.note)}</div>` : ""}
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
