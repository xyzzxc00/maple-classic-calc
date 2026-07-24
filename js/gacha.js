/**
 * gacha.js — 轉蛋模擬 UI 綁定與抽取邏輯（骨架階段）
 * -----------------------------------------------------------------
 * 純前端狀態，不寫 Firestore、不用等 App Check，跟卷軸強化模擬同一種
 * 「client-side only」設計。道具池資料來自 js/gachaData.js（GACHA_ITEMS），
 * 目前是骨架階段的示意假資料，等正式機率公告後只要換那個檔案的內容，
 * 這裡的抽取邏輯完全不用改。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    resetBtn: document.getElementById("gachaResetBtn"),
    poolBox: document.getElementById("gachaPoolBox"),
    pullOnceBtn: document.getElementById("gachaPullOnceBtn"),
    pullTenBtn: document.getElementById("gachaPullTenBtn"),
    resultGrid: document.getElementById("gachaResultGrid"),
    totalPulls: document.getElementById("gachaTotalPulls"),
    dist: document.getElementById("gachaDist"),
  };
  if (!els.poolBox) return;

  const ITEMS = window.MapleGachaItems || [];
  const TOTAL_WEIGHT = ITEMS.reduce((sum, it) => sum + it.weight, 0);

  // 稀有度對應的顯示樣式（跟現有的 --accent/--warning/--danger 三個色階
  // 對應，不另外引入新顏色）：普通用預設灰、稀有用主題色、珍稀用警示黃、
  // 傳說用強調紅，越稀有顏色越搶眼
  const RARITY_CLASS = {
    "普通": "",
    "稀有": "gacha-rarity-uncommon",
    "珍稀": "gacha-rarity-rare",
    "傳說": "gacha-rarity-legendary",
  };

  function formatChance(weight) {
    return ((weight / TOTAL_WEIGHT) * 100).toFixed(1) + "%";
  }

  function renderPool() {
    els.poolBox.innerHTML = ITEMS.map(
      (it) => `<div class="exp-rate-row">
        <span>${it.name}<span class="gacha-rarity-tag ${RARITY_CLASS[it.rarity] || ""}">${it.rarity}</span></span>
        <span>${formatChance(it.weight)}</span>
      </div>`
    ).join("");
  }
  renderPool();

  // 依權重隨機抽一個道具
  function pullOne() {
    let roll = Math.random() * TOTAL_WEIGHT;
    for (const it of ITEMS) {
      roll -= it.weight;
      if (roll <= 0) return it;
    }
    return ITEMS[ITEMS.length - 1]; // 浮點數誤差保底，理論上不會走到這裡
  }

  // dist：{ 道具名稱: 抽到次數 }，累計統計用
  let totalPulls = 0;
  const dist = {};

  function renderResults(results) {
    els.resultGrid.innerHTML = results
      .map(
        (it) => `<div class="gacha-result-item ${RARITY_CLASS[it.rarity] || ""}">
          <div class="gacha-result-name">${it.name}</div>
          <div class="gacha-result-rarity">${it.rarity}</div>
        </div>`
      )
      .join("");
  }

  function renderStats() {
    els.totalPulls.textContent = totalPulls.toLocaleString();
    if (!totalPulls) {
      els.dist.innerHTML = "";
      return;
    }
    els.dist.innerHTML = ITEMS.map((it) => {
      const count = dist[it.name] || 0;
      const pct = totalPulls ? (count / totalPulls) * 100 : 0;
      return `<div class="scroll-sim-dist-row">
        <span class="scroll-sim-dist-label">${it.name}</span>
        <span class="scroll-sim-dist-bar-track"><span class="scroll-sim-dist-bar-fill" style="width:${pct}%"></span></span>
        <span class="scroll-sim-dist-count">${count.toLocaleString()}（${pct.toFixed(1)}%）</span>
      </div>`;
    }).join("");
  }

  function doPulls(n) {
    const results = [];
    for (let i = 0; i < n; i++) {
      const it = pullOne();
      results.push(it);
      dist[it.name] = (dist[it.name] || 0) + 1;
      totalPulls++;
    }
    renderResults(results);
    renderStats();
  }

  els.pullOnceBtn.addEventListener("click", () => doPulls(1));
  els.pullTenBtn.addEventListener("click", () => doPulls(10));

  els.resetBtn.addEventListener("click", () => {
    totalPulls = 0;
    for (const key in dist) delete dist[key];
    els.resultGrid.innerHTML = "";
    renderStats();
  });

  renderStats();
})();
