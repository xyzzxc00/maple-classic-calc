/**
 * nav.js — 分頁切換（首頁 / 計算工具 / 資料庫 / 玩法攻略 / 社群資料 / FAQ）
 */
(function () {
  const STORAGE_KEY = "maple_classic_nav_v1";

  // 全站規則：圖載不到就整個藏起來，乾淨留白，不留破圖圖示（沒有正確的
  // 圖寧可空白也不要誤導——站長 2026-08-22 定的）。放在 nav.js 是因為
  // 這支每一頁都會載（含 guides 與怪物靜態頁），db.js 那些各自的處理
  // 照舊，這裡是兜底。error 事件不會冒泡，要用捕獲階段
  document.addEventListener(
    "error",
    (e) => {
      const t = e.target;
      if (t && t.tagName === "IMG") t.style.visibility = "hidden";
    },
    true
  );

  const pages = {
    home: document.getElementById("pageHome"),
    calc: document.getElementById("pageCalc"),
    db: document.getElementById("pageDb"),
    guides: document.getElementById("pageGuides"),
    cm: document.getElementById("pageCm"),
    faq: document.getElementById("pageFaq"),
  };
  const tabs = {
    home: document.getElementById("navHome"),
    calc: document.getElementById("navCalc"),
    db: document.getElementById("navDb"),
    guides: document.getElementById("navGuides"),
    cm: document.getElementById("navCm"),
    faq: document.getElementById("navFaqLink"),
  };

  function switchNav(page) {
    Object.keys(pages).forEach((key) => {
      const isActive = key === page;
      pages[key].hidden = !isActive;
      tabs[key].classList.toggle("active", isActive);
      tabs[key].setAttribute("aria-selected", isActive ? "true" : "false");
    });
    localStorage.setItem(STORAGE_KEY, page);
    if (page === "cm" && window.MapleCommunity) {
      window.MapleCommunity.loadRecords().then(() => {
        if (window.MapleSpots) window.MapleSpots.render();
      });
    }
    // 資料庫的資料檔切到這一頁才抓（第一次抓完就留著）。跟社群資料一樣，
    // 初次渲染由這裡觸發，不要讓 db.js 自己判斷「現在是不是在資料庫頁」——
    // 那種自檢寫法踩過兩次 script 載入順序的race
    if (page === "db" && window.MapleDb) window.MapleDb.load();
    // 進練等計算頁時，若目前停在攻擊力計算/卷軸模擬子分頁，補觸發資料載入
    // （側邊欄點子分頁時 nav.js 的子分頁監聽先跑、那時主分頁還沒切過來）
    if (page === "calc") ensureCalcData(activeCalcSubtab);
    // 讓側邊欄（sidebar.js）知道現在在哪一頁，不管是誰觸發的切換
    // （側邊欄點擊、app.js 的「去哪練」跨頁連結、timer.js 的跨頁連結都算）
    document.dispatchEvent(new CustomEvent("maplenav:pagechange", { detail: { page } }));
    // 換頁一律回到頁面最上方——不這麼做的話，捲到底部時點別的分頁，
    // 瀏覽器會保留原本的捲動高度，新頁面直接從中段/底部開始顯示。
    // 需要捲到特定區塊的流程（例如「設好計時器」）會在呼叫 switchNav
    // 之後自己再 scrollIntoView，不受影響
    window.scrollTo(0, 0);
  }

  // 四大群組的標題按鈕（navCalc 等）不在這裡掛切頁監聽——點群組標題
  // 只展開／收合側邊欄選單（sidebar.js 負責），要點群組底下的子分頁
  // 才會真的切換頁面（子分頁的切頁監聽也在 sidebar.js 的 SUBTAB_LINKS）
  tabs.home.addEventListener("click", () => switchNav("home"));

  window.MapleNav = { switchNav, showCalcSubtab };

  // tabs[saved] 可能因為分頁暫時關閉而點不到，這種情況下不要照 localStorage
  // 的舊紀錄切過去，不然畫面會停在一個使用者找不到分頁按鈕能切走的地方
  const saved = localStorage.getItem(STORAGE_KEY);
  // 網址錨點（例如 guides/ 文章連回來的 index.html#guides，或 #calc-scroll
  // 這種「主分頁-子分頁」格式）優先於 localStorage 的舊紀錄，這樣外部連結
  // 才能準確跳到指定分頁，而不是停在使用者上次逛到的地方
  const [hashMain, hashSub] = location.hash.slice(1).split("-");
  // 資料庫的單筆詳情用查詢參數當網址（?db=monster&id=…），因為它跟錨點不同：
  // 錨點是「開哪個分頁」的一次性指令、用完就抹掉，詳情網址則是要能分享、
  // 能重新整理、能加書籤的，得留在網址列上。這裡只負責認出「要開資料庫頁」，
  // 實際開哪一筆由 db.js 自己讀參數處理
  const hasDbRoute = new URLSearchParams(location.search).has("db");
  const initialPage =
    hasDbRoute && pages.db
      ? "db"
      : hashMain && pages[hashMain] && !tabs[hashMain].hidden
      ? hashMain
      : saved && pages[saved] && !tabs[saved].hidden
      ? saved
      : "home";
  switchNav(initialPage);

  // 錨點的任務到這裡就結束了：它是「忽略上次的記憶、開這一頁」的一次性
  // 指令（guides/ 與 privacy/ 的站名、麵包屑、「用練等計算機試算」都靠它），
  // 套用完就從網址列抹掉。
  // 留著的話網址會跟畫面分岔——站內切分頁不換頁、也就沒有人更新網址，於是
  // 人在轉蛋模擬、網址卻還寫著 #calc-exp；這時按重整，舊錨點的優先權高於
  // localStorage，使用者就被丟回練等計算。抹掉之後重整改由 localStorage 接手，
  // 跟畫面永遠一致。
  // 這段必須放在所有讀 location.hash 的模組之後——app.js／guides.js／
  // community.js 的 script tag 都排在 nav.js 前面，載入時
  // 已經讀完了。search 要保留：app.js 處理分享連結的參數時有自己的清法
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }

  // 「練等計算」/「攻擊力計算」/「卷軸強化模擬」子分頁切換
  const CALC_SUBTAB_KEY = "maple_classic_calc_subtab";
  const calcSubtabs = [
    { key: "exp", btn: document.getElementById("calcSubExp"), view: document.getElementById("calcExpView") },
    { key: "attack", btn: document.getElementById("calcSubAttack"), view: document.getElementById("calcAttackView") },
    { key: "scroll", btn: document.getElementById("calcSubScroll"), view: document.getElementById("calcScrollView") },
    { key: "gacha", btn: document.getElementById("calcSubGacha"), view: document.getElementById("calcGachaView") },
    { key: "hit", btn: document.getElementById("calcSubHit"), view: document.getElementById("calcHitView") },
  ];

  // 攻擊力計算／卷軸模擬的資料檔各約 1MB（gzip 前），切到那個子分頁才抓。
  // 跟資料庫頁同一套規矩：初次載入由 nav.js 觸發，模組自己不判斷「現在
  // 是不是在這一頁」——那種自檢寫法踩過兩次 script 載入順序的 race。
  // 只在練等計算主分頁真的可見時才抓：載入時 showCalcSubtab 會為了還原
  // 上次的子分頁而執行，那時人可能根本在首頁
  function ensureCalcData(key) {
    if (pages.calc.hidden) return;
    if (key === "attack" && window.MapleAttackCalc) window.MapleAttackCalc.load();
    if (key === "scroll" && window.MapleScrollSim) window.MapleScrollSim.load();
  }

  // var 不是筆誤：switchNav(initialPage) 在這行執行前就會跑，let 會踩 TDZ；
  // var 提升後初始 switchNav 拿到 undefined，ensureCalcData 安全略過
  var activeCalcSubtab = "exp";

  function showCalcSubtab(key, skipSave) {
    activeCalcSubtab = key;
    calcSubtabs.forEach((tab) => {
      const isActive = tab.key === key;
      tab.view.hidden = !isActive;
      tab.btn.classList.toggle("active", isActive);
      tab.btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    if (!skipSave) localStorage.setItem(CALC_SUBTAB_KEY, key);
    ensureCalcData(key);
  }

  calcSubtabs.forEach((tab) => tab.btn.addEventListener("click", () => showCalcSubtab(tab.key)));

  // 存下來的子分頁如果暫時關閉（例如攻擊力計算還隱藏），就不要照舊紀錄切過去
  const savedCalcSubtab = calcSubtabs.find((t) => t.key === localStorage.getItem(CALC_SUBTAB_KEY));
  if (savedCalcSubtab && !savedCalcSubtab.btn.hidden) showCalcSubtab(savedCalcSubtab.key, true);

  // 網址錨點指定子分頁（例如 guides/ 文章連的 #calc-scroll）比 localStorage
  // 的舊紀錄優先，確保外部連結精準跳到指定子分頁
  if (hashMain === "calc" && hashSub) {
    const hashCalcSubtab = calcSubtabs.find((t) => t.key === hashSub && !t.btn.hidden);
    if (hashCalcSubtab) showCalcSubtab(hashCalcSubtab.key, true);
  }
})();
