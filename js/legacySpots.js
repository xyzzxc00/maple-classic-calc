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

  const spotsList = document.getElementById("legacySpotsList");
  if (spotsList) {
    spotsList.innerHTML = (window.MapleLegacySpots || []).map(renderTier).join("");
  }

  const bossList = document.getElementById("legacyBossList");
  if (bossList) {
    bossList.innerHTML = `<div class="legacy-spot-card">${(window.MapleLegacyBosses || []).map(renderEntry).join("")}</div>`;
  }

  const subSpotsBtn = document.getElementById("legacySubSpots");
  const subBossesBtn = document.getElementById("legacySubBosses");
  const spotsView = document.getElementById("legacySpotsView");
  const bossView = document.getElementById("legacyBossView");
  if (!subSpotsBtn || !subBossesBtn || !spotsView || !bossView) return;

  const STORAGE_KEY = "maple_classic_legacy_subtab";

  function showSpots(skipSave) {
    spotsView.hidden = false;
    bossView.hidden = true;
    subSpotsBtn.classList.add("active");
    subBossesBtn.classList.remove("active");
    subSpotsBtn.setAttribute("aria-selected", "true");
    subBossesBtn.setAttribute("aria-selected", "false");
    if (!skipSave) localStorage.setItem(STORAGE_KEY, "spots");
  }

  function showBosses(skipSave) {
    spotsView.hidden = true;
    bossView.hidden = false;
    subSpotsBtn.classList.remove("active");
    subBossesBtn.classList.add("active");
    subSpotsBtn.setAttribute("aria-selected", "false");
    subBossesBtn.setAttribute("aria-selected", "true");
    if (!skipSave) localStorage.setItem(STORAGE_KEY, "bosses");
  }

  subSpotsBtn.addEventListener("click", () => showSpots());
  subBossesBtn.addEventListener("click", () => showBosses());

  if (localStorage.getItem(STORAGE_KEY) === "bosses") showBosses(true);
})();
