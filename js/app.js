/**
 * app.js — UI 綁定層
 * -----------------------------------------------------------------
 * 只負責：讀畫面輸入 → 呼叫 calculator.js 的純函式 → 把結果寫回畫面。
 * 角色資料存在 localStorage，純前端不需要後端，可以直接放靜態空間部署
 * (GitHub Pages / Netlify / Cloudflare Pages 都可以，拖檔案上去就上線)。
 * -----------------------------------------------------------------
 */

(function () {
  const STORAGE_KEY = "maple_classic_characters_v1";

  const els = {
    charSelect: document.getElementById("charSelect"),
    newCharBtn: document.getElementById("newCharBtn"),
    deleteCharBtn: document.getElementById("deleteCharBtn"),
    currentLevel: document.getElementById("currentLevel"),
    currentExp: document.getElementById("currentExp"),
    targetLevel: document.getElementById("targetLevel"),
    expPerHour: document.getElementById("expPerHour"),
    calcBtn: document.getElementById("calcBtn"),
    resultPanel: document.getElementById("resultPanel"),
    expBarFill: document.getElementById("expBarFill"),
    expBarLabel: document.getElementById("expBarLabel"),
    capLevelFrom: document.getElementById("capLevelFrom"),
    capLevelTo: document.getElementById("capLevelTo"),
    statExpNeeded: document.getElementById("statExpNeeded"),
    statLevelsToGo: document.getElementById("statLevelsToGo"),
    statTime: document.getElementById("statTime"),
    shareBtn: document.getElementById("shareBtn"),
    shareHint: document.getElementById("shareHint"),
    spotsBody: document.getElementById("spotsBody"),
  };

  // ---------- 角色資料 (localStorage) ----------
  function loadCharacters() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) && list.length ? list : [defaultCharacter()];
    } catch {
      return [defaultCharacter()];
    }
  }

  function defaultCharacter() {
    return { id: "char_default", name: "我的角色", currentLevel: 1, currentExp: 0, targetLevel: 10, expPerHour: 0 };
  }

  function saveCharacters(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  let characters = loadCharacters();
  let activeCharId = characters[0].id;

  function renderCharSelect() {
    els.charSelect.innerHTML = "";
    characters.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      els.charSelect.appendChild(opt);
    });
    els.charSelect.value = activeCharId;
  }

  function loadCharIntoForm(charId) {
    const c = characters.find((c) => c.id === charId) || characters[0];
    els.currentLevel.value = c.currentLevel;
    els.currentExp.value = c.currentExp;
    els.targetLevel.value = c.targetLevel;
    els.expPerHour.value = c.expPerHour || "";
  }

  function persistFormToActiveChar() {
    const c = characters.find((c) => c.id === activeCharId);
    if (!c) return;
    c.currentLevel = parseInt(els.currentLevel.value, 10) || 1;
    c.currentExp = parseInt(els.currentExp.value, 10) || 0;
    c.targetLevel = parseInt(els.targetLevel.value, 10) || 1;
    c.expPerHour = parseInt(els.expPerHour.value, 10) || 0;
    saveCharacters(characters);
  }

  els.newCharBtn.addEventListener("click", () => {
    const name = prompt("新角色名稱？", `角色 ${characters.length + 1}`);
    if (!name) return;
    const id = "char_" + Date.now();
    const newChar = { id, name, currentLevel: 1, currentExp: 0, targetLevel: 10, expPerHour: 0 };
    characters.push(newChar);
    activeCharId = id;
    saveCharacters(characters);
    renderCharSelect();
    loadCharIntoForm(id);
  });

  els.deleteCharBtn.addEventListener("click", () => {
    if (characters.length <= 1) {
      alert("至少要保留一個角色");
      return;
    }
    if (!confirm("確定要刪除這個角色的紀錄嗎？")) return;
    characters = characters.filter((c) => c.id !== activeCharId);
    activeCharId = characters[0].id;
    saveCharacters(characters);
    renderCharSelect();
    loadCharIntoForm(activeCharId);
  });

  els.charSelect.addEventListener("change", (e) => {
    activeCharId = e.target.value;
    loadCharIntoForm(activeCharId);
  });

  // ---------- 計算與渲染 ----------
  function runCalculation() {
    persistFormToActiveChar();

    const currentLevel = parseInt(els.currentLevel.value, 10) || 1;
    const currentExp = parseInt(els.currentExp.value, 10) || 0;
    const targetLevel = parseInt(els.targetLevel.value, 10) || 1;

    const { totalExpNeeded, levelsToGo } = MapleCalculator.calcExpNeeded(
      currentLevel,
      currentExp,
      targetLevel,
      window.MapleData.EXP_TABLE
    );

    els.resultPanel.hidden = false;

    // EXP bar：用「目前等級內進度」當作視覺示意（佔位數值下僅供示意）
    const currentLevelNeed = window.MapleData.EXP_TABLE[currentLevel - 1] || 1;
    const pct = Math.min(100, Math.round((currentExp / currentLevelNeed) * 100));
    els.expBarFill.style.width = pct + "%";
    els.expBarLabel.textContent = pct + "%";
    els.capLevelFrom.textContent = `Lv.${currentLevel}`;
    els.capLevelTo.textContent = `Lv.${targetLevel}`;

    els.statExpNeeded.textContent =
      targetLevel <= currentLevel ? "已達成" : totalExpNeeded.toLocaleString();
    els.statLevelsToGo.textContent =
      levelsToGo > 0 ? `${levelsToGo} 等` : "已達成";

    // 預估時間：優先用使用者自填的每小時經驗，沒填才 fallback 用練功地點資料
    const manualExpPerHour = parseInt(els.expPerHour.value, 10) || 0;
    let effectiveExpPerHour = manualExpPerHour;
    if (!effectiveExpPerHour) {
      const spots = MapleCalculator.findSuitableSpots(currentLevel, window.MapleData.GRINDING_SPOTS);
      const spotWithRate = spots.find((s) => s.expPerHour);
      effectiveExpPerHour = spotWithRate ? spotWithRate.expPerHour : 0;
    }
    const time = MapleCalculator.estimateTime(totalExpNeeded, effectiveExpPerHour);
    els.statTime.textContent = time.displayText;

    renderSpotsTable(currentLevel);
  }

  function renderSpotsTable(currentLevel) {
    const spots = window.MapleData.GRINDING_SPOTS;
    els.spotsBody.innerHTML = "";
    spots.forEach((s) => {
      const tr = document.createElement("tr");
      const inRange = currentLevel >= s.levelRange[0] && currentLevel <= s.levelRange[1];
      tr.innerHTML = `
        <td>${s.name}${inRange ? " ⭐" : ""}</td>
        <td>Lv.${s.levelRange[0]} - ${s.levelRange[1]}</td>
        <td>${s.expPerHour ? s.expPerHour.toLocaleString() : "待補"}</td>
        <td>${s.note}</td>
      `;
      els.spotsBody.appendChild(tr);
    });
  }

  els.calcBtn.addEventListener("click", runCalculation);

  // ---------- 分享連結 ----------
  els.shareBtn.addEventListener("click", async () => {
    const params = MapleCalculator.encodeShareParams({
      currentLevel: parseInt(els.currentLevel.value, 10) || 1,
      currentExp: parseInt(els.currentExp.value, 10) || 0,
      targetLevel: parseInt(els.targetLevel.value, 10) || 1,
      expPerHour: parseInt(els.expPerHour.value, 10) || 0,
    });
    const url = `${location.origin}${location.pathname}?${params}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 後備方案：選取文字讓使用者自己複製
      prompt("複製這個連結分享給朋友：", url);
    }
    els.shareHint.hidden = false;
    setTimeout(() => (els.shareHint.hidden = true), 3000);
  });

  // ---------- 初始化 ----------
  function init() {
    renderCharSelect();

    // 如果網址帶有分享參數，優先套用
    const shared = MapleCalculator.decodeShareParams(location.search);
    if (shared.currentLevel && shared.targetLevel) {
      els.currentLevel.value = shared.currentLevel;
      els.currentExp.value = shared.currentExp || 0;
      els.targetLevel.value = shared.targetLevel;
      els.expPerHour.value = shared.expPerHour || "";
    } else {
      loadCharIntoForm(activeCharId);
    }

    runCalculation();
  }

  window.MapleApp = { runCalculation };

  init();
})();
