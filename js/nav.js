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

  // 「練等計算」/「攻擊力計算」子分頁切換（攻擊力計算資料還在核對，先隱藏）
  const CALC_SUBTAB_KEY = "maple_classic_calc_subtab";
  const subExpBtn = document.getElementById("calcSubExp");
  const subAttackBtn = document.getElementById("calcSubAttack");
  const expView = document.getElementById("calcExpView");
  const attackView = document.getElementById("calcAttackView");

  function showExpSubtab(skipSave) {
    expView.hidden = false;
    attackView.hidden = true;
    subExpBtn.classList.add("active");
    subAttackBtn.classList.remove("active");
    subExpBtn.setAttribute("aria-selected", "true");
    subAttackBtn.setAttribute("aria-selected", "false");
    if (!skipSave) localStorage.setItem(CALC_SUBTAB_KEY, "exp");
  }

  function showAttackSubtab(skipSave) {
    expView.hidden = true;
    attackView.hidden = false;
    subExpBtn.classList.remove("active");
    subAttackBtn.classList.add("active");
    subExpBtn.setAttribute("aria-selected", "false");
    subAttackBtn.setAttribute("aria-selected", "true");
    if (!skipSave) localStorage.setItem(CALC_SUBTAB_KEY, "attack");
  }

  subExpBtn.addEventListener("click", () => showExpSubtab());
  subAttackBtn.addEventListener("click", () => showAttackSubtab());

  if (localStorage.getItem(CALC_SUBTAB_KEY) === "attack" && !subAttackBtn.hidden) {
    showAttackSubtab(true);
  }
})();
