/**
 * nav.js — 分頁切換（練等計算 / 建議練功地點 / 社群資料庫）
 */
(function () {
  const STORAGE_KEY = "maple_classic_nav_v1";

  const pages = {
    calc: document.getElementById("pageCalc"),
    spots: document.getElementById("pageSpots"),
    jobs: document.getElementById("pageJobs"),
    cm: document.getElementById("pageCm"),
    legacy: document.getElementById("pageLegacy"),
  };
  const tabs = {
    calc: document.getElementById("navCalc"),
    spots: document.getElementById("navSpots"),
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
      window.MapleCommunity.loadRecords();
    }
    if (page === "spots" && window.MapleCommunity) {
      window.MapleCommunity.loadRecords().then(() => {
        if (window.MapleSpots) window.MapleSpots.render();
      });
    }
  }

  tabs.calc.addEventListener("click", () => switchNav("calc"));
  tabs.spots.addEventListener("click", () => switchNav("spots"));
  tabs.jobs.addEventListener("click", () => switchNav("jobs"));
  tabs.cm.addEventListener("click", () => switchNav("cm"));
  tabs.legacy.addEventListener("click", () => switchNav("legacy"));

  window.MapleNav = { switchNav };

  const saved = localStorage.getItem(STORAGE_KEY);
  switchNav(saved && pages[saved] ? saved : "calc");
})();
