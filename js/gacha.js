/**
 * gacha.js — 轉蛋模擬 UI 綁定與抽取邏輯
 * -----------------------------------------------------------------
 * 純前端狀態，不寫 Firestore、不用等 App Check，跟卷軸強化模擬同一種
 * 「client-side only」設計。道具池資料來自 js/gachaData.js
 * （window.MapleGachaBoxes，一個 box 對應一台轉蛋機），每個 box 各自
 * 累計抽數與命中分布，切換 box 不會清掉另一個 box 的紀錄。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    boxSelect: document.getElementById("gachaBoxSelect"),
    boxPeriod: document.getElementById("gachaBoxPeriod"),
    resetBtn: document.getElementById("gachaResetBtn"),
    poolBox: document.getElementById("gachaPoolBox"),
    pullOnceBtn: document.getElementById("gachaPullOnceBtn"),
    pullTenBtn: document.getElementById("gachaPullTenBtn"),
    resultGrid: document.getElementById("gachaResultGrid"),
    totalPulls: document.getElementById("gachaTotalPulls"),
    dist: document.getElementById("gachaDist"),
  };
  if (!els.poolBox) return;

  const BOXES = window.MapleGachaBoxes || [];
  if (!BOXES.length) {
    // 資料檔（gachaData.js）沒載入成功時不要整頁靜默死掉——下拉選單全空、
    // 按鈕沒反應會讓使用者以為功能壞了。跟 legacySpots.js 的兜底比照辦理
    els.poolBox.innerHTML = '<p class="cm-empty cm-empty--error">資料載入失敗，請重新整理頁面</p>';
    return;
  }

  // 稀有度對應的顯示樣式（跟現有的 --accent/--warning/--danger 三個色階
  // 對應，不另外引入新顏色）：C 用預設灰、B 用主題色、A 用警示黃、
  // S 用強調紅，越稀有顏色越搶眼
  const RARITY_CLASS = {
    C: "",
    B: "gacha-rarity-uncommon",
    A: "gacha-rarity-rare",
    S: "gacha-rarity-legendary",
  };

  // 每個 box 各自的累計統計，key 是 box.id
  const stateByBox = {};
  function getState(boxId) {
    if (!stateByBox[boxId]) stateByBox[boxId] = { totalPulls: 0, dist: {} };
    return stateByBox[boxId];
  }

  let currentBox = BOXES[0];
  let totalWeight = 0;

  function formatChance(weight) {
    // 畫面要忠實顯示官方公告的原始機率；總和因官方四捨五入可能不是
    // 100%，只有抽取時才按總權重等比例處理該微小誤差。
    return Number(weight).toFixed(2) + "%";
  }

  function renderBoxOptions() {
    if (!els.boxSelect) return;
    els.boxSelect.innerHTML = BOXES.map(
      (box) => `<option value="${box.id}">${box.name}</option>`
    ).join("");
  }

  function renderPool() {
    els.poolBox.innerHTML = currentBox.items
      .map(
        (it) => `<div class="exp-rate-row">
        <span>${it.name}${it.rarity ? `<span class="gacha-rarity-tag ${RARITY_CLASS[it.rarity] || ""}">${it.rarity}</span>` : ""}</span>
        <span>${formatChance(it.weight)}</span>
      </div>`
      )
      .join("");
    if (els.boxPeriod) els.boxPeriod.textContent = currentBox.period ? `活動時間：${currentBox.period}` : "";
  }

  // 依權重隨機抽一個道具
  function pullOne() {
    let roll = Math.random() * totalWeight;
    for (const it of currentBox.items) {
      roll -= it.weight;
      if (roll <= 0) return it;
    }
    return currentBox.items[currentBox.items.length - 1]; // 浮點數誤差保底，理論上不會走到這裡
  }

  function renderResults(results) {
    els.resultGrid.innerHTML = results
      .map(
        (it) => `<div class="gacha-result-item ${RARITY_CLASS[it.rarity] || ""}">
          <div class="gacha-result-name">${it.name}</div>
          ${it.rarity ? `<div class="gacha-result-rarity">${it.rarity}</div>` : ""}
        </div>`
      )
      .join("");
  }

  function renderStats() {
    const state = getState(currentBox.id);
    els.totalPulls.textContent = state.totalPulls.toLocaleString();
    if (!state.totalPulls) {
      els.dist.innerHTML = "";
      return;
    }
    els.dist.innerHTML = currentBox.items
      .map((it) => {
        const count = state.dist[it.name] || 0;
        const pct = state.totalPulls ? (count / state.totalPulls) * 100 : 0;
        return `<div class="scroll-sim-dist-row">
        <span class="scroll-sim-dist-label">${it.name}</span>
        <span class="scroll-sim-dist-bar-track"><span class="scroll-sim-dist-bar-fill" style="width:${pct}%"></span></span>
        <span class="scroll-sim-dist-count">${count.toLocaleString()}（${pct.toFixed(1)}%）</span>
      </div>`;
      })
      .join("");
  }

  function doPulls(n) {
    const state = getState(currentBox.id);
    const results = [];
    for (let i = 0; i < n; i++) {
      const it = pullOne();
      results.push(it);
      state.dist[it.name] = (state.dist[it.name] || 0) + 1;
      state.totalPulls++;
    }
    renderResults(results);
    renderStats();
  }

  // 還沒抽過（初次進入、剛重置、或剛切換 box）時結果區不能是純空白，會看起來像壞掉
  const EMPTY_RESULT_HTML = '<p class="cm-empty">還沒抽過，按「抽一次」或「抽十連」試試手氣</p>';

  function selectBox(boxId) {
    currentBox = BOXES.find((b) => b.id === boxId) || BOXES[0];
    totalWeight = currentBox.items.reduce((sum, it) => sum + it.weight, 0);
    renderPool();
    els.resultGrid.innerHTML = EMPTY_RESULT_HTML;
    renderStats();
  }

  renderBoxOptions();
  if (els.boxSelect) {
    els.boxSelect.addEventListener("change", () => selectBox(els.boxSelect.value));
  }
  selectBox(currentBox.id);

  els.pullOnceBtn.addEventListener("click", () => doPulls(1));
  els.pullTenBtn.addEventListener("click", () => doPulls(10));

  els.resetBtn.addEventListener("click", () => {
    const state = getState(currentBox.id);
    state.totalPulls = 0;
    for (const key in state.dist) delete state.dist[key];
    els.resultGrid.innerHTML = EMPTY_RESULT_HTML;
    renderStats();
  });
})();
