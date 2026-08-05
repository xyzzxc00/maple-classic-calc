/**
 * nav.js — 分頁切換（練等計算 / 玩法攻略 / 社群資料庫 / 過往資料參考）
 */
(function () {
  const STORAGE_KEY = "maple_classic_nav_v1";

  const pages = {
    home: document.getElementById("pageHome"),
    calc: document.getElementById("pageCalc"),
    guides: document.getElementById("pageGuides"),
    cm: document.getElementById("pageCm"),
    legacy: document.getElementById("pageLegacy"),
    faq: document.getElementById("pageFaq"),
  };
  const tabs = {
    home: document.getElementById("navHome"),
    calc: document.getElementById("navCalc"),
    guides: document.getElementById("navGuides"),
    cm: document.getElementById("navCm"),
    legacy: document.getElementById("navLegacy"),
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
  const initialPage =
    hashMain && pages[hashMain] && !tabs[hashMain].hidden
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
  // community.js／legacySpots.js 的 script tag 都排在 nav.js 前面，載入時
  // 已經讀完了。search 要保留：app.js 處理分享連結的參數時有自己的清法
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }

  // 「練等計算」/「攻擊力計算」/「卷軸強化模擬」子分頁切換
  // （攻擊力計算資料還在核對，先隱藏，見 index.html 上的 hidden 屬性）
  const CALC_SUBTAB_KEY = "maple_classic_calc_subtab";
  const calcSubtabs = [
    { key: "exp", btn: document.getElementById("calcSubExp"), view: document.getElementById("calcExpView") },
    { key: "attack", btn: document.getElementById("calcSubAttack"), view: document.getElementById("calcAttackView") },
    { key: "scroll", btn: document.getElementById("calcSubScroll"), view: document.getElementById("calcScrollView") },
    { key: "gacha", btn: document.getElementById("calcSubGacha"), view: document.getElementById("calcGachaView") },
  ];

  function showCalcSubtab(key, skipSave) {
    calcSubtabs.forEach((tab) => {
      const isActive = tab.key === key;
      tab.view.hidden = !isActive;
      tab.btn.classList.toggle("active", isActive);
      tab.btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    if (!skipSave) localStorage.setItem(CALC_SUBTAB_KEY, key);
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
