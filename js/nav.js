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
      // 組隊揪團／擺攤資訊的初次載入觸發，統一放在這裡做，不要各自在
      // team.js／stall.js 的檔案尾端自己猜「我是不是已經是攤開的分頁」。
      // <script defer> 是照 index.html 順序執行：community.js（還原上次
      // cm 子分頁、把 cmTeamView 的 hidden 拿掉）排在 team.js／stall.js
      // 前面，但 nav.js（還原上次主分頁、把 #pageCm 的 hidden 拿掉）排在
      // 最後——team.js／stall.js 原本各自檢查「#pageCm 沒隱藏」的寫法，
      // 在它們自己執行的當下 nav.js 根本還沒跑，#pageCm 一定還是隱藏的，
      // 檢查永遠失敗，重新整理停在組隊揪團／擺攤資訊會卡在「載入中...」
      // 動不了，要手動切分頁再切回來才會觸發。nav.js 排在所有子模組後面
      // 執行，這裡才是唯一保證「所有模組都載完、也知道最終要不要顯示
      // #pageCm」的地方，直接讀 community.js 存的子分頁 key 來決定要不要
      // 補觸發 render()
      // 錨點 #cm-<subtab> 優先（community.js 切視圖時用同一套規則），
      // 沒有錨點才讀 localStorage；鍵名以 community.js 匯出的為準（單一
      // 定義處）。MapleCommunity 不在的話社群頁本身就壞了，補觸發也沒有意義
      const cmSubtab =
        hashMain === "cm" && hashSub
          ? hashSub
          : window.MapleCommunity
          ? localStorage.getItem(window.MapleCommunity.cmSubtabKey)
          : null;
      if (cmSubtab === "team" && window.MapleTeam) window.MapleTeam.render();
      if (cmSubtab === "stall" && window.MapleStall) window.MapleStall.render();
      if (cmSubtab === "guild" && window.MapleGuild) window.MapleGuild.render();
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
  // 網址錨點（例如 guides/ 文章連回來的 index.html#jobs，或 #calc-scroll
  // 這種「主分頁-子分頁」格式）優先於 localStorage 的舊紀錄，這樣外部連結
  // 才能準確跳到指定分頁，而不是停在使用者上次逛到的地方
  const [hashMain, hashSub] = location.hash.slice(1).split("-");
  const initialPage =
    hashMain && pages[hashMain] && !tabs[hashMain].hidden
      ? hashMain
      : saved && pages[saved] && !tabs[saved].hidden
      ? saved
      : "calc";
  switchNav(initialPage);

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
