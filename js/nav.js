/**
 * nav.js — 分頁切換（練等計算 / 職業介紹 / 社群資料庫 / 過往資料參考）
 */
(function () {
  const STORAGE_KEY = "maple_classic_nav_v1";

  const pages = {
    calc: document.getElementById("pageCalc"),
    jobs: document.getElementById("pageJobs"),
    cm: document.getElementById("pageCm"),
    legacy: document.getElementById("pageLegacy"),
  };
  const tabs = {
    calc: document.getElementById("navCalc"),
    jobs: document.getElementById("navJobs"),
    cm: document.getElementById("navCm"),
    legacy: document.getElementById("navLegacy"),
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
  }

  tabs.calc.addEventListener("click", () => switchNav("calc"));
  tabs.jobs.addEventListener("click", () => switchNav("jobs"));
  tabs.cm.addEventListener("click", () => switchNav("cm"));
  tabs.legacy.addEventListener("click", () => switchNav("legacy"));

  window.MapleNav = { switchNav };

  // tabs[saved] 可能因為分頁暫時關閉而點不到，這種情況下不要照 localStorage
  // 的舊紀錄切過去，不然畫面會停在一個使用者找不到分頁按鈕能切走的地方
  const saved = localStorage.getItem(STORAGE_KEY);
  switchNav(saved && pages[saved] && !tabs[saved].hidden ? saved : "calc");

  // 「練等計算」/「攻擊力計算」/「卷軸強化模擬」子分頁切換
  // （攻擊力計算資料還在核對，先隱藏，見 index.html 上的 hidden 屬性）
  const CALC_SUBTAB_KEY = "maple_classic_calc_subtab";
  const calcSubtabs = [
    { key: "exp", btn: document.getElementById("calcSubExp"), view: document.getElementById("calcExpView") },
    { key: "attack", btn: document.getElementById("calcSubAttack"), view: document.getElementById("calcAttackView") },
    { key: "scroll", btn: document.getElementById("calcSubScroll"), view: document.getElementById("calcScrollView") },
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
})();
