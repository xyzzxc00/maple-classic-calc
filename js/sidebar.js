/**
 * sidebar.js — 側邊欄排版的行為（跟 nav.js／guides.js／community.js／
 * legacySpots.js 的分頁切換邏輯完全無關，純粹是外殼行為）：
 * 1. 側邊欄群組收合／展開
 * 2. 手機版漢堡選單開關
 * 3. 監聽 nav.js switchNav() 發出的 maplenav:pagechange 事件，自動展開
 *    對應的群組（不管切換是側邊欄點擊、app.js「去哪練」、還是 timer.js
 *    的跨頁連結觸發的都會收到）
 * 4. 首頁儀表板卡片／CTA／最新更新清單的 [data-nav-page] 通用跳轉
 * -----------------------------------------------------------------
 */
(function () {
  const groups = [...document.querySelectorAll(".nav-group")];

  // 手風琴：點群組標題「只」展開／收合選單本身，不切換頁面——切頁
  // 要點群組底下的子分頁才會發生（見下方 SUBTAB_LINKS；nav.js 也已經
  // 不在群組標題上掛切頁監聽）。點收合中的群組：展開它、其他三個自動
  // 收起來；點已展開的群組：收合它。
  function setGroupOpen(group, open) {
    const links = group.querySelector(".nav-group-links");
    group.classList.toggle("collapsed", !open);
    if (!links) return;
    links.style.maxHeight = open ? links.scrollHeight + "px" : "0px";
  }

  function collapseAllExcept(navBtnId) {
    groups.forEach((group) => {
      const header = group.querySelector(".nav-group-btn");
      const isMatch = header && header.id === navBtnId;
      setGroupOpen(group, isMatch);
    });
  }

  document.addEventListener("maplenav:pagechange", (e) => {
    const page = e.detail && e.detail.page;
    const navBtnId = page ? "nav" + page.charAt(0).toUpperCase() + page.slice(1) : null;
    collapseAllExcept(navBtnId);
  });

  groups.forEach((group) => {
    const header = group.querySelector(".nav-group-btn");
    if (!header) return;
    header.addEventListener("click", () => {
      const wasOpen = !group.classList.contains("collapsed");
      if (wasOpen) setGroupOpen(group, false);
      else collapseAllExcept(header.id);
    });
  });

  // 頁面載入時，nav.js 已經先跑完 switchNav(initialPage) 並發出過一次
  // pagechange 事件——但 sidebar.js 的 <script> 排在 nav.js 之後，事件
  // 發生當下這裡還沒掛監聽器，收不到那一次，所以載入時要自己補判斷一次
  // （落在首頁時四個群組都不是目前分頁，activeHeader 會是 undefined，
  // 四個群組全部收合，這是預期行為）。這裡不能直接呼叫 setGroupOpen／
  // collapseAllExcept——那組函式是設計給「使用者互動後」的動畫轉場用，
  // 收合分支會用 rAF 讓 max-height 先撐開一瞬間再收回去，如果頁面一
  // 載入就這樣跑，會看到本來該收合的三個群組閃一下展開又收回去。載入時
  // 只需要直接把最終狀態設好，不要動畫
  const activeHeader = document.querySelector(".nav-group-btn.active");
  groups.forEach((group) => {
    const header = group.querySelector(".nav-group-btn");
    const links = group.querySelector(".nav-group-links");
    const isMatch = header === activeHeader;
    group.classList.toggle("collapsed", !isMatch);
    if (!links) return;
    links.style.transition = "none";
    links.style.maxHeight = isMatch ? links.scrollHeight + "px" : "0px";
    void links.offsetHeight;
    links.style.transition = "";
  });

  // ---------- 手機版漢堡選單 ----------
  const sidebar = document.getElementById("sidebar");
  const menuBtn = document.getElementById("sidebarMenuBtn");
  const menuCloseBtn = document.getElementById("sidebarCloseBtn");
  const menuBackdrop = document.getElementById("sidebarBackdrop");
  if (sidebar && menuBtn) {
    // body.menu-open 負責鎖住背景捲動（見 style.css 的 880px 區塊）
    const setMenuOpen = (open) => {
      sidebar.classList.toggle("open", open);
      document.body.classList.toggle("menu-open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menuBtn.addEventListener("click", () => setMenuOpen(!sidebar.classList.contains("open")));
    if (menuCloseBtn) menuCloseBtn.addEventListener("click", () => setMenuOpen(false));
    if (menuBackdrop) menuBackdrop.addEventListener("click", () => setMenuOpen(false));
    // 點側邊欄裡任何連結後，手機版自動收起選單，不用使用者自己點掉。
    // 群組標題（.nav-group-btn）除外——它只是展開選單、不是導去某頁，
    // 收起側邊欄會讓使用者根本點不到剛展開的子分頁
    sidebar.addEventListener("click", (e) => {
      const clicked = e.target.closest("a, button");
      if (clicked && !clicked.classList.contains("nav-group-btn") && sidebar.classList.contains("open")) {
        setMenuOpen(false);
      }
    });
  }

  // ---------- 側邊欄子分頁連結：點擊時順便切到對應的主分頁 ----------
  // guides.js／community.js／legacySpots.js／nav.js 原本各自的監聽器
  // 還在（負責顯示正確的子分頁內容），這裡另外掛一個監聽器只負責讓
  // MapleNav 把外層主分頁也切過去——兩者互不影響，誰先執行都沒差
  // （switchNav 只動 pages[key].hidden，不會動任何子分頁自己的狀態）
  const SUBTAB_LINKS = [
    { id: "calcSubExp", page: "calc" },
    { id: "calcSubAttack", page: "calc" },
    { id: "calcSubScroll", page: "calc" },
    { id: "calcSubGacha", page: "calc" },
    { id: "calcSubHit", page: "calc" },
    { id: "dbSubMonsters", page: "db" },
    { id: "dbSubMaps", page: "db" },
    { id: "dbSubWorld", page: "db" },
    { id: "dbSubItems", page: "db" },
    { id: "dbSubNpcs", page: "db" },
    { id: "dbSubQuests", page: "db" },
    { id: "dbSubSkills", page: "db" },
    { id: "guidesSubQuests", page: "guides" },
    { id: "guidesSubJobs", page: "guides" },
    { id: "guidesSubTeamQuest", page: "guides" },
    { id: "guidesSubBoss", page: "guides" },
    { id: "cmSubSuggest", page: "cm" },
    { id: "cmSubPicks", page: "cm" },
    { id: "cmSubRecords", page: "cm" },
    { id: "legacySubSpots", page: "legacy" },
    { id: "legacySubJobBuilds", page: "legacy" },
    { id: "legacySubBosses", page: "legacy" },
    { id: "legacySubBossPrequests", page: "legacy" },
  ];
  SUBTAB_LINKS.forEach(({ id, page }) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => window.MapleNav && window.MapleNav.switchNav(page));
  });

  // ---------- 頂欄站名：點了回首頁 ----------
  // 手機版側邊欄收合時，畫面上要有一個隨時可點的回首頁入口；桌機版
  // 點站名回首頁也是常見慣例，行為跟側邊欄品牌區一致
  const bannerHomeBtn = document.getElementById("topBannerHomeBtn");
  if (bannerHomeBtn) {
    bannerHomeBtn.addEventListener("click", () => window.MapleNav && window.MapleNav.switchNav("home"));
  }

  // ---------- 首頁儀表板：卡片／CTA／最新更新清單的跳轉 ----------
  const SUBTAB_SETTERS = {
    calc: (key) => window.MapleNav && window.MapleNav.showCalcSubtab(key),
    guides: (key) => window.MapleGuides && window.MapleGuides.showTab(key),
    cm: (key) => window.MapleCommunity && window.MapleCommunity.showCmSubtab(key),
    db: (key) => window.MapleDb && window.MapleDb.showTab(key),
    legacy: (key) => window.MapleLegacy && window.MapleLegacy.showTab(key),
  };

  document.querySelectorAll("[data-nav-page]").forEach((el) => {
    el.addEventListener("click", () => {
      const page = el.dataset.navPage;
      const subtab = el.dataset.navSubtab;
      if (!window.MapleNav) return;
      // switchNav 自己會捲回頁面最上方，這裡不用再捲一次
      window.MapleNav.switchNav(page);
      if (subtab && SUBTAB_SETTERS[page]) SUBTAB_SETTERS[page](subtab);
    });
  });
})();
