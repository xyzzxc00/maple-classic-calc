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
 *
 * 2026-07-27 起改成「一人一則＋冷卻」：文件 ID 直接用
 * window.MapleCommunity.getDeviceId()（裝置層級識別碼，存在
 * localStorage，跟 stall.js／guild.js／livestream.js 共用同一個值），
 * 用 doc(deviceId).set() 而不是 add()——同一台裝置在這個板永遠只有一篇
 * 揪團公告，重新發布是覆蓋舊的那篇，不是疊加新的一筆。firestore.rules
 * 用 isRefresh() 擋住太頻繁的覆蓋（1 小時內不能刷新，不因標記過「已找到
 * 團」而提早解除——不然會被拿來「標記已找到團→立刻重發」無限循環繞過
 * 冷卻），這裡在送出前先讀一次自己的舊文件、算冷卻剩餘
 * 時間，給比伺服器直接回絕更友善的錯誤訊息；真正的防線還是規則那邊，
 * 前端這層檢查只是體驗優化，讀取失敗也不擋發文。「這是我的貼文」
 * （isMine，決定要不要顯示「已找到團」按鈕）現在直接比對文件 ID 是不是
 * 自己的 deviceId，不用再像以前那樣維護一份 localStorage 貼文 ID 清單。
 * 這一樣不是真正的身分驗證——清 localStorage 或換瀏覽器就是新裝置，是
 * 刻意的取捨（防洗版用的軟性機制，不是防駭客）。
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

  // 字數硬上限＋IME 安全裁切（formGuard.js，四板共用）；欄位都短，不掛計數
  MapleFormGuard.attach(els.target, 40);
  MapleFormGuard.attach(els.map, 40);
  MapleFormGuard.attach(els.contact, 40);
  MapleFormGuard.attach(els.note, 60);

  const GRACE_MS = 6 * 60 * 60 * 1000; // 集合時間過後多久還算有效，跟原本 6 小時的設計一致
  const MAX_ADVANCE_MS = 7 * 24 * 60 * 60 * 1000; // 最多能提前 7 天發布
  const MIN_PAST_MS = 60 * 60 * 1000; // 集合時間最多容許比現在早 1 小時（給「現在就要揪」一點緩衝，不用卡到秒）
  // 顯示的一頁筆數，跟每次跟 Firestore 要資料的批次大小共用同一個數字，
  // 「按下一頁」＝「剛好去問伺服器要下一批」，邏輯最單純；跟 exp_records
  // 那種「一批抓 50 筆、畫面一頁 15 筆」的比例式設計不同，是刻意選的——
  // 這個公告板量級小很多，不需要那麼細的顆粒度
  const PAGE_SIZE = 30;
  // 篩選（揪團類型）在前端做，篩空時會自動往伺服器補抓下一批；不設上限
  // 的話，選到一個當下完全沒人發的類型就等於把整個 collection 抓完。
  // 上限 10 批 = 最多自動搜 300 筆，超過就停下來明講搜了多少，跟
  // community.js 的 exp_records 同一套安全機制
  const MAX_AUTO_FETCH_ROUNDS = 10;
  const CACHE_MS = 60 * 1000; // 跟 community.js 同標準：60 秒內重複進分頁用快取
  // 一人一則的冷卻時間，跟 stall.js／guild.js／livestream.js 同標準
  const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

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
  let lastDoc = null;
  let hasMoreFromServer = false; // Firestore 端是否還有下一批（PAGE_SIZE 筆一批）還沒抓進 allPosts
  // renderTeamPosts() 靠這個分辨「讀取真的失敗」跟「單純還沒有資料」，
  // 理由跟 community.js 的 exp_records 一樣：不然點篩選按鈕會把已經顯示
  // 的正確錯誤訊息，悄悄蓋成「還沒有揪團貼文」
  let lastLoadFailed = false;
  let lastLoadedAt = 0;
  let currentPage = 1;
  let autoFetchRounds = 0;
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

    const deviceId = window.MapleCommunity.getDeviceId();
    try {
      const existingDoc = await db.collection("team_posts").doc(deviceId).get();
      if (existingDoc.exists) {
        const existing = existingDoc.data();
        const tsMs = existing.ts && existing.ts.toMillis ? existing.ts.toMillis() : 0;
        const remainMs = REFRESH_COOLDOWN_MS - (Date.now() - tsMs);
        // 冷卻不因已標記「已找到團」而提早解除——理由跟 guild.js 一樣，
        // firestore.rules 的 isRefresh() 也是同一套邏輯，兩邊要一起改
        if (remainMs > 0) {
          const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
          els.msg.textContent = `這台裝置剛發過一篇揪團貼文，距離上次發布還不到 1 小時，請再等約 ${remainMin} 分鐘才能重新發布（標記「已找到團」不受這個限制，隨時可以標記）`;
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
      await db.collection("team_posts").doc(deviceId).set({
        type, target, server, map, contact, job, level,
        currentCount, neededCount,
        scheduledAt: firebase.firestore.Timestamp.fromDate(scheduledAtDate),
        ...(note && { note }),
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已發布！集合時間過後 6 小時會自動下架，找到團也可以自己提早標記完成";
      els.msg.className = "cm-msg ok";
      els.type.value = ""; els.target.value = ""; els.server.value = ""; els.map.value = ""; els.contact.value = "";
      els.job.value = ""; els.level.value = "";
      els.currentCount.value = ""; els.neededCount.value = ""; els.note.value = "";
      els.scheduledAt.value = "";
      allPosts = [];
      await loadTeamPosts();
    } catch (e) {
      // 跟 community.js 一樣分開講 permission-denied／resource-exhausted，
      // 不然使用者猜不出「重試有沒有用」
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
  els.submitBtn.addEventListener("click", submitTeamPost);

  async function loadTeamPosts(append = false) {
    if (!append) {
      if (allPosts.length && Date.now() - lastLoadedAt < CACHE_MS) {
        renderTeamPosts();
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
      // 直接在查詢端擋掉「集合時間 + 6 小時 < 現在」的過期文件，不用抓一大批
      // 回來前端才過濾——range 條件跟 orderBy 是同一個欄位（scheduledAt），
      // 不需要額外設定複合索引。多抓 1 筆只用來判斷「後面還有沒有資料」，
      // 做法跟 community.js 的 exp_records 一樣
      const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - GRACE_MS);
      let query = db.collection("team_posts")
        .where("scheduledAt", ">=", cutoff)
        .orderBy("scheduledAt", "asc")
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
      renderTeamPosts();
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
      // 補抓失敗時別把已經顯示的貼文整片換成錯誤訊息——保留清單、把錯誤
      // 放在分頁區；同時關掉 hasMoreFromServer 避免又觸發補抓、失敗、
      // 再補抓的迴圈，做法跟 community.js 的 exp_records 一樣
      if (append && allPosts.length) {
        hasMoreFromServer = false;
        renderTeamPosts();
        els.pagination.innerHTML = `<p class="cm-empty">${msg}</p>`;
        return;
      }
      els.list.innerHTML = `<p class="cm-empty">${msg}</p>`;
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
    const deviceId = window.MapleCommunity.getDeviceId();
    // 過期過濾已經在 Firestore 查詢端做過一次（where scheduledAt >= cutoff），
    // 這裡的 CACHE_MS 快取視窗內時間會往前走，所以還是要再篩一次，避免
    // 快取住的資料裡混進「查詢當下沒過期、現在已經過期」的邊界情況。
    // found（已標記找到團）沒有做進 Firestore 查詢條件——多加一個欄位的
    // range/equality 條件會需要複合索引，這個公告板量級小，直接在前端
    // 濾掉比較省事。
    const notExpired = allPosts.filter((p) => {
      const t = p.scheduledAt && p.scheduledAt.toDate ? p.scheduledAt.toDate().getTime() : 0;
      return now - t < GRACE_MS && !p.found;
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
      // 已載入的這幾批裡沒有符合條件的，不代表伺服器上真的沒有——篩選
      // 只在前端做，資料還沒抓完的情況下不能先下「沒有符合條件」的結論，
      // 做法跟 community.js 的 exp_records 一樣
      if (hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
        autoFetchRounds++;
        els.list.innerHTML = '<p class="cm-loading">在更多的揪團貼文中搜尋...</p>';
        els.pagination.innerHTML = "";
        loadTeamPosts(true);
        return;
      }
      // 如果上一次讀取本來就失敗了，畫面已經顯示正確的錯誤訊息，這裡不能
      // 因為 allPosts 剛好是空的就蓋成「還沒有揪團貼文」——點篩選按鈕不會
      // 重新觸發載入，失敗狀態要維持到使用者真的重新整理頁面為止
      if (lastLoadFailed && !allPosts.length) return;
      els.list.innerHTML = !allPosts.length
        ? '<p class="cm-empty">目前還沒有揪團貼文，第一個發起看看吧！</p>'
        : hasMoreFromServer
          ? `<p class="cm-empty">最近載入的 ${allPosts.length} 筆貼文中沒有符合條件的，可以放寬篩選條件再試</p>`
          : '<p class="cm-empty">目前沒有符合篩選條件、還在有效期內的揪團貼文</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    // 篩選後已載入的資料不夠撐滿目前頁碼，但 Firestore 那邊還有更多，先補抓再重繪
    if (currentPage > totalPages && hasMoreFromServer && autoFetchRounds < MAX_AUTO_FETCH_ROUNDS) {
      autoFetchRounds++;
      els.pagination.innerHTML = '<p class="cm-loading">載入更多貼文中...</p>';
      loadTeamPosts(true);
      return;
    }
    if (currentPage > totalPages) currentPage = totalPages;
    const pagePosts = MaplePagination.slice(filtered, currentPage, PAGE_SIZE);

    els.list.innerHTML =
      '<div class="cm-grid">' +
      pagePosts.map((p) => {
        const t = p.scheduledAt && p.scheduledAt.toDate ? p.scheduledAt.toDate() : new Date(now);
        const started = t.getTime() <= now;
        const scheduledLabel = formatScheduled(t) + (started ? "（進行中／已開始）" : "");
        const isMine = p.id === deviceId;
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(p.type)}｜${escHtml(p.target)}</div>
          <div class="cm-map">${escHtml(p.server)}・${escHtml(p.map)}</div>
          <div class="cm-stat"><span>集合時間</span><span>${scheduledLabel}</span></div>
          <div class="cm-stat"><span>發起人</span><span>${escHtml(p.job)} Lv.${p.level}</span></div>
          <div class="cm-stat"><span>人數</span><span>${p.currentCount} / ${p.neededCount}</span></div>
          <div class="cm-stat"><span>聯絡方式</span><span>${escHtml(p.contact)}</span></div>
          ${p.note ? `<div class="cm-note">${escHtml(p.note)}</div>` : ""}
          ${isMine ? `<div class="cm-card-footer">
            <button class="cm-helpful-btn cm-found-btn" data-id="${p.id}" type="button">✓ 已找到團，下架這篇</button>
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
      onChange: (p) => { currentPage = p; renderTeamPosts(); },
    });
    // 篩選都只在已載入的資料內做，資料還沒抓完時如果不講，篩選結果看起來
    // 像涵蓋全部貼文，其實只涵蓋最近幾批
    if (hasMoreFromServer) {
      els.pagination.insertAdjacentHTML(
        "beforeend",
        `<p class="cm-range-hint">目前涵蓋已載入的 ${allPosts.length} 筆貼文，按「›」可繼續載入更晚時段的揪團貼文</p>`
      );
    }
    // 成功渲染出結果 = 這一輪補抓鏈結束，下一次篩空可以重新往下搜
    autoFetchRounds = 0;
  }

  // 單一委派監聽器（在初始化時綁一次，避免每次 render 疊加），跟
  // community.js 的 onHelpfulClick 同一套做法
  function onFoundClick(e) {
    const btn = e.target.closest(".cm-found-btn");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;

    // 這個動作沒辦法復原（規則不開放把 found 改回 false），怕手滑誤點
    // 直接把自己的貼文下架，按下去前先跳確認
    if (!confirm("確定要標記這篇揪團已經找到團、下架這篇貼文嗎？這個動作沒辦法復原。")) return;

    btn.disabled = true;
    btn.textContent = "處理中...";
    window.MapleCommunity.ensureDb().then((db) => {
      if (!db) throw new Error("no-db");
      return db.collection("team_posts").doc(id).update({ found: true });
    }).then(() => {
      // 標記成功就直接從畫面上拿掉，不用等下次重新載入
      allPosts = allPosts.filter((p) => p.id !== id);
      renderTeamPosts();
    }).catch(() => {
      // 失敗機率不高（自己發的文、規則本來就允許這個更新），失敗了讓
      // 使用者知道可以再按一次，不要靜默失敗
      btn.disabled = false;
      btn.textContent = "標記失敗，再按一次試試";
    });
  }
  els.list.addEventListener("click", onFoundClick);

  els.typeFilterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.typeFilterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeType = btn.dataset.type;
      currentPage = 1;
      autoFetchRounds = 0;
      renderTeamPosts();
    });
  });

  function render() {
    loadTeamPosts();
  }

  // 頁面重新整理時「我是不是已經是攤開的分頁」這個初次載入判斷，統一
  // 交給 nav.js 做（見 nav.js 的 switchNav() 註解）——那裡是唯一保證
  // community.js／team.js／stall.js 都已經載完、也知道最終主分頁是不是
  // #pageCm 的地方。這裡以前自己土法煉鋼判斷過兩次都各自有時機漏洞
  // （第一版沒檢查 #pageCm、第二版檢查了但自己執行的當下 nav.js 根本
  // 還沒跑，#pageCm 必然還是隱藏的，一樣判斷失敗），教訓是這類「我到底
  // 會不會被看到」的判斷不該分散在各個模組自己猜，交給真正知道答案的
  // 那一個地方做。
  window.MapleTeam = { render };
})();
