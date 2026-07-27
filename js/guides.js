/**
 * guides.js — 玩法攻略頁子分頁切換
 * -----------------------------------------------------------------
 * 四個子分頁（組隊任務／BOSS攻略／忍耐任務／職業攻略）目前都還只有
 * 免責聲明＋「整理中」的預留位置，內容之後陸續補上；這裡先把子分頁
 * 切換的骨架搭好，做法跟 legacySpots.js 的子分頁切換同一套（hash 錨點
 * 優先於 localStorage 記住的上次分頁）。
 * -----------------------------------------------------------------
 */
(function () {
  const subTeamQuestBtn = document.getElementById("guidesSubTeamQuest");
  const subBossBtn = document.getElementById("guidesSubBoss");
  const subEnduranceBtn = document.getElementById("guidesSubEndurance");
  const subJobsBtn = document.getElementById("guidesSubJobs");
  const teamQuestView = document.getElementById("guidesTeamQuestView");
  const bossView = document.getElementById("guidesBossView");
  const enduranceView = document.getElementById("guidesEnduranceView");
  const jobsView = document.getElementById("guidesJobsView");
  if (!subTeamQuestBtn || !subBossBtn || !subEnduranceBtn || !subJobsBtn || !teamQuestView || !bossView || !enduranceView || !jobsView) return;

  const STORAGE_KEY = "maple_classic_guides_subtab";

  const tabs = [
    { btn: subTeamQuestBtn, view: teamQuestView, key: "teamQuest" },
    { btn: subBossBtn, view: bossView, key: "boss" },
    { btn: subEnduranceBtn, view: enduranceView, key: "endurance" },
    { btn: subJobsBtn, view: jobsView, key: "jobs" },
  ];

  function showTab(key, skipSave) {
    tabs.forEach((t) => {
      const active = t.key === key;
      t.view.hidden = !active;
      t.btn.classList.toggle("active", active);
      t.btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (!skipSave) localStorage.setItem(STORAGE_KEY, key);
  }

  tabs.forEach((t) => t.btn.addEventListener("click", () => showTab(t.key)));

  // 網址錨點 #guides-<subtab>（例如之後的攻略文連回來的 #guides-boss）
  // 比 localStorage 的舊紀錄優先，跟 nav.js 處理 #calc-*／legacySpots.js
  // 處理 #legacy-* 的規則一致
  const [hashMain, hashSub] = location.hash.slice(1).split("-");
  const hashTab = hashMain === "guides" && tabs.some((t) => t.key === hashSub) ? hashSub : null;
  const savedTab = localStorage.getItem(STORAGE_KEY);
  const initialTab = hashTab || savedTab;
  if (tabs.some((t) => t.key === initialTab)) showTab(initialTab, true);
})();
