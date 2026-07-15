/**
 * legacySpots.js — 舊版資料參考頁渲染
 */
(function () {
  function renderEntry(e) {
    return `<div class="legacy-entry">
      ${e.level ? `<span class="legacy-entry-level">Lv.${e.level}</span>` : ""}
      <span class="legacy-entry-monster">${e.monster}</span>
      <div class="legacy-entry-locations">${e.locations}</div>
      ${e.respawn ? `<div class="legacy-entry-respawn">重生時間：${e.respawn}</div>` : ""}
    </div>`;
  }

  function renderTier(t) {
    return `<div class="legacy-spot-card">
      <div class="legacy-spot-level">Lv.${t.levelRange}</div>
      ${t.entries.map(renderEntry).join("")}
      ${t.note ? `<div class="legacy-spot-note">${t.note}</div>` : ""}
    </div>`;
  }

  // 資料檔（legacySpotsData.js）沒載入成功時，`|| []` 會渲染出整片空白、只剩
  // 免責聲明孤零零掛著。跟 jobs.js 的兜底比照辦理，明講載入失敗
  const DATA_MISSING_MSG = '<p class="cm-empty">資料載入失敗，請重新整理頁面</p>';

  const spotsList = document.getElementById("legacySpotsList");
  if (spotsList) {
    const tiers = window.MapleLegacySpots || [];
    spotsList.innerHTML = tiers.length ? tiers.map(renderTier).join("") : DATA_MISSING_MSG;
  }

  const bossList = document.getElementById("legacyBossList");
  if (bossList) {
    const bosses = window.MapleLegacyBosses || [];
    bossList.innerHTML = bosses.length
      ? `<div class="legacy-spot-card">${bosses.map(renderEntry).join("")}</div>`
      : DATA_MISSING_MSG;
  }

  function renderPrequest(p) {
    return `<div class="legacy-spot-card">
      <div class="legacy-spot-level">${p.boss}</div>
      <div class="boss-prequest-level">${p.levelReq}</div>
      <ol class="boss-prequest-steps">
        ${p.steps
          .map(
            (s) => `<li class="boss-prequest-step">
              <div class="boss-prequest-step-title">${s.title}</div>
              <div class="boss-prequest-step-desc">${s.desc}</div>
            </li>`
          )
          .join("")}
      </ol>
      ${p.note ? `<div class="legacy-spot-note">${p.note}</div>` : ""}
    </div>`;
  }

  const bossPrequestList = document.getElementById("legacyBossPrequestList");
  if (bossPrequestList) {
    const prequests = window.MapleLegacyBossPrequests || [];
    bossPrequestList.innerHTML = prequests.length ? prequests.map(renderPrequest).join("") : DATA_MISSING_MSG;
  }

  const subSpotsBtn = document.getElementById("legacySubSpots");
  const subBossesBtn = document.getElementById("legacySubBosses");
  const subBossPrequestsBtn = document.getElementById("legacySubBossPrequests");
  const spotsView = document.getElementById("legacySpotsView");
  const bossView = document.getElementById("legacyBossView");
  const bossPrequestView = document.getElementById("legacyBossPrequestView");
  if (!subSpotsBtn || !subBossesBtn || !subBossPrequestsBtn || !spotsView || !bossView || !bossPrequestView) return;

  const STORAGE_KEY = "maple_classic_legacy_subtab";

  const tabs = [
    { btn: subSpotsBtn, view: spotsView, key: "spots" },
    { btn: subBossesBtn, view: bossView, key: "bosses" },
    { btn: subBossPrequestsBtn, view: bossPrequestView, key: "bossPrequests" },
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

  const savedTab = localStorage.getItem(STORAGE_KEY);
  if (tabs.some((t) => t.key === savedTab)) showTab(savedTab, true);
})();
