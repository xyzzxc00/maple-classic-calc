/**
 * nav.js — 分頁切換（練等計算 / 職業介紹 / 社群資料庫 / 過往資料參考）
 */
(function () {
  const STORAGE_KEY = "maple_classic_nav_v1";

  const pages = {
    calc: document.getElementById("pageCalc"),
    attack: document.getElementById("pageAttack"),
    jobs: document.getElementById("pageJobs"),
    cm: document.getElementById("pageCm"),
    legacy: document.getElementById("pageLegacy"),
  };
  const tabs = {
    calc: document.getElementById("navCalc"),
    attack: document.getElementById("navAttack"),
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
  tabs.attack.addEventListener("click", () => switchNav("attack"));
  tabs.jobs.addEventListener("click", () => switchNav("jobs"));
  tabs.cm.addEventListener("click", () => switchNav("cm"));
  tabs.legacy.addEventListener("click", () => switchNav("legacy"));

  window.MapleNav = { switchNav };

  // tabs[saved] 可能因為分頁暫時關閉（例如攻擊力計算加了 hidden）而點不到，
  // 這種情況下不要照 localStorage 的舊紀錄切過去，不然畫面會停在一個
  // 使用者找不到分頁按鈕能切走的地方
  const saved = localStorage.getItem(STORAGE_KEY);
  switchNav(saved && pages[saved] && !tabs[saved].hidden ? saved : "calc");
})();
