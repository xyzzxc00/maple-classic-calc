/**
 * guides.js — 玩法攻略頁子分頁切換
 * -----------------------------------------------------------------
 * 四個子分頁（組隊任務／BOSS攻略／職業攻略／任務攻略）共用這裡的
 * 切換邏輯；網址 hash 優先於 localStorage 記住的上次分頁。
 * -----------------------------------------------------------------
 */
(function () {
  const subTeamQuestBtn = document.getElementById("guidesSubTeamQuest");
  const subBossBtn = document.getElementById("guidesSubBoss");
  const subJobsBtn = document.getElementById("guidesSubJobs");
  const subQuestsBtn = document.getElementById("guidesSubQuests");
  const teamQuestView = document.getElementById("guidesTeamQuestView");
  const bossView = document.getElementById("guidesBossView");
  const jobsView = document.getElementById("guidesJobsView");
  const questsView = document.getElementById("guidesQuestsView");
  if (!subTeamQuestBtn || !subBossBtn || !subJobsBtn || !subQuestsBtn || !teamQuestView || !bossView || !jobsView || !questsView) return;

  const STORAGE_KEY = "maple_classic_guides_subtab";

  const tabs = [
    { btn: subTeamQuestBtn, view: teamQuestView, key: "teamQuest" },
    { btn: subBossBtn, view: bossView, key: "boss" },
    { btn: subJobsBtn, view: jobsView, key: "jobs" },
    { btn: subQuestsBtn, view: questsView, key: "quests" },
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

  window.MapleGuides = { showTab };

  // 網址錨點 #guides-<subtab>（例如之後的攻略文連回來的 #guides-boss）
  // 比 localStorage 的舊紀錄優先，跟 nav.js 處理 #calc-* 的規則一致
  const [hashMain, hashSub] = location.hash.slice(1).split("-");
  const hashTab = hashMain === "guides" && tabs.some((t) => t.key === hashSub) ? hashSub : null;
  const savedTab = localStorage.getItem(STORAGE_KEY);
  const initialTab = hashTab || savedTab;
  if (tabs.some((t) => t.key === initialTab)) showTab(initialTab, true);
})();
