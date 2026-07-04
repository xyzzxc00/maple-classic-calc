/**
 * legacySpots.js — 舊版練功地點參考頁渲染
 */
(function () {
  const list = document.getElementById("legacySpotsList");
  if (!list) return;

  function renderEntry(e) {
    return `<div class="legacy-entry">
      <span class="legacy-entry-level">Lv.${e.level}</span>
      <span class="legacy-entry-monster">${e.monster}</span>
      <div class="legacy-entry-locations">${e.locations}</div>
    </div>`;
  }

  function renderTier(t) {
    return `<div class="legacy-spot-card">
      <div class="legacy-spot-level">Lv.${t.levelRange}</div>
      ${t.entries.map(renderEntry).join("")}
      ${t.note ? `<div class="legacy-spot-note">${t.note}</div>` : ""}
    </div>`;
  }

  list.innerHTML = (window.MapleLegacySpots || []).map(renderTier).join("");
})();
