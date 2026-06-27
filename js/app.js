/**
 * app.js — UI 綁定層
 * -----------------------------------------------------------------
 * 只負責：讀畫面輸入 → 呼叫 calculator.js 的純函式 → 把結果寫回畫面。
 * 角色資料存在 localStorage，純前端不需要後端，可以直接放靜態空間部署
 * (GitHub Pages / Netlify / Cloudflare Pages 都可以，拖檔案上去就上線)。
 * -----------------------------------------------------------------
 */

(function () {
  const STORAGE_KEY = "maple_classic_characters_v2";

  const els = {
    charSelect: document.getElementById("charSelect"),
    newCharBtn: document.getElementById("newCharBtn"),
    renameCharBtn: document.getElementById("renameCharBtn"),
    deleteCharBtn: document.getElementById("deleteCharBtn"),
    currentLevel: document.getElementById("currentLevel"),
    currentExp: document.getElementById("currentExp"),
    targetLevel: document.getElementById("targetLevel"),
    expPer10Min: document.getElementById("expPer10Min"),
    multBtns: document.querySelectorAll(".mult-btn"),
    customMult: document.getElementById("customMult"),
    dailyHours: document.getElementById("dailyHours"),
    ownedCoupons: document.getElementById("ownedCoupons"),
    resultPanel: document.getElementById("resultPanel"),
    expBarFill: document.getElementById("expBarFill"),
    expBarLabel: document.getElementById("expBarLabel"),
    capLevelFrom: document.getElementById("capLevelFrom"),
    capLevelTo: document.getElementById("capLevelTo"),
    statExpNeeded: document.getElementById("statExpNeeded"),
    statLevelsToGo: document.getElementById("statLevelsToGo"),
    multLabel: document.getElementById("multLabel"),
    timeNo: document.getElementById("timeNo"),
    timeMult: document.getElementById("timeMult"),
    couponStatsBox: document.getElementById("couponStatsBox"),
    timeSaved: document.getElementById("timeSaved"),
    couponsNeeded: document.getElementById("couponsNeeded"),
    couponStatusRow: document.getElementById("couponStatusRow"),
    couponStatus: document.getElementById("couponStatus"),
    couponShortRow: document.getElementById("couponShortRow"),
    couponShort: document.getElementById("couponShort"),
    dailyDaysRow: document.getElementById("dailyDaysRow"),
    dailyDays: document.getElementById("dailyDays"),
    shareBtn: document.getElementById("shareBtn"),
    shareHint: document.getElementById("shareHint"),
  };

  let currentMult = 2;

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
    return {
      id: "char_default",
      name: "我的角色",
      currentLevel: "",
      currentExp: 0,
      targetLevel: "",
      expPer10Min: "",
      mult: 2,
      dailyHours: "",
      ownedCoupons: "",
    };
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
      opt.textContent = `${c.name} · Lv.${parseInt(c.currentLevel, 10) || 1}`;
      els.charSelect.appendChild(opt);
    });
    els.charSelect.value = activeCharId;
  }

  function setMult(mult) {
    currentMult = mult;
    els.customMult.value = mult;
    els.multBtns.forEach((b) => b.classList.toggle("active", parseFloat(b.dataset.val) === mult));
  }

  function loadCharIntoForm(charId) {
    const c = characters.find((c) => c.id === charId) || characters[0];
    els.currentLevel.value = c.currentLevel || "";
    els.currentExp.value = c.currentExp;
    els.targetLevel.value = c.targetLevel || "";
    els.expPer10Min.value = c.expPer10Min || "";
    els.dailyHours.value = c.dailyHours || "";
    els.ownedCoupons.value = c.ownedCoupons || "";
    setMult(c.mult || 2);
  }

  function persistFormToActiveChar() {
    const c = characters.find((c) => c.id === activeCharId);
    if (!c) return;
    c.currentLevel = els.currentLevel.value;
    c.currentExp = parseInt(els.currentExp.value, 10) || 0;
    c.targetLevel = els.targetLevel.value;
    c.expPer10Min = els.expPer10Min.value;
    c.mult = currentMult;
    c.dailyHours = els.dailyHours.value;
    c.ownedCoupons = els.ownedCoupons.value;
    saveCharacters(characters);
  }

  function showModal(title, defaultVal, callback) {
    const overlay = document.getElementById("modalOverlay");
    const titleEl = document.getElementById("modalTitle");
    const input = document.getElementById("modalInput");
    const confirmBtn = document.getElementById("modalConfirm");
    const cancelBtn = document.getElementById("modalCancel");
    titleEl.textContent = title;
    input.value = defaultVal || "";
    overlay.hidden = false;
    setTimeout(() => { input.focus(); input.select(); }, 50);
    function close(result) {
      overlay.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      input.removeEventListener("keydown", onKey);
      callback(result);
    }
    function onConfirm() { close(input.value.trim() || null); }
    function onCancel() { close(null); }
    function onOverlay(e) { if (e.target === overlay) close(null); }
    function onKey(e) {
      if (e.key === "Enter") close(input.value.trim() || null);
      if (e.key === "Escape") close(null);
    }
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
    input.addEventListener("keydown", onKey);
  }

  els.renameCharBtn.addEventListener("click", () => {
    const c = characters.find((c) => c.id === activeCharId);
    if (!c) return;
    showModal("角色改名", c.name, (name) => {
      if (!name) return;
      c.name = name;
      saveCharacters(characters);
      renderCharSelect();
    });
  });

  els.newCharBtn.addEventListener("click", () => {
    showModal("新角色名稱", `角色 ${characters.length + 1}`, (name) => {
      if (!name) return;
      const id = "char_" + Date.now();
      const newChar = { ...defaultCharacter(), id, name };
      characters.push(newChar);
      activeCharId = id;
      saveCharacters(characters);
      renderCharSelect();
      loadCharIntoForm(id);
    });
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

  // ---------- 加倍倍率 ----------
  els.multBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setMult(parseFloat(btn.dataset.val));
      runCalculation();
    });
  });
  els.customMult.addEventListener("input", () => {
    currentMult = parseFloat(els.customMult.value) || 1;
    els.multBtns.forEach((b) => b.classList.remove("active"));
    runCalculation();
  });

  // ---------- 計算與渲染 ----------
  function getExpPerMin() {
    return MapleCalculator.parseExpVal(els.expPer10Min.value) / 10;
  }

  function runCalculation() {
    persistFormToActiveChar();
    calcAndRender();
  }

  // 只計算畫面顯示，不寫入角色存檔（分享連結載入時用這個，避免覆蓋對方的角色資料）
  function calcAndRender() {
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
    els.multLabel.textContent = currentMult + "x";

    // EXP bar：顯示「起點到目標」全程進度
    let totalExpForRange = 0;
    for (let lv = currentLevel; lv < targetLevel; lv++) {
      totalExpForRange += window.MapleData.EXP_TABLE[lv - 1] || 0;
    }
    totalExpForRange = Math.max(totalExpForRange, 1);
    const expDone = Math.max(0, totalExpForRange - totalExpNeeded);
    const pct = targetLevel <= currentLevel ? 100 : Math.min(100, Math.round((expDone / totalExpForRange) * 100));
    els.expBarFill.style.width = pct + "%";
    els.expBarLabel.textContent = pct + "%";
    els.capLevelFrom.textContent = `Lv.${currentLevel}`;
    els.capLevelTo.textContent = `Lv.${targetLevel}`;

    els.statExpNeeded.textContent =
      targetLevel <= currentLevel ? "已達成" : totalExpNeeded.toLocaleString();
    els.statLevelsToGo.textContent =
      levelsToGo > 0 ? `${levelsToGo} 等` : "已達成";

    // 時間 / 加倍卷計算
    const expPerMin = getExpPerMin();
    const hasRate = !isNaN(expPerMin) && expPerMin > 0;

    if (!hasRate) {
      els.timeNo.textContent = "尚無效率資料";
      els.timeMult.textContent = "尚無效率資料";
      els.couponStatsBox.hidden = true;
    } else {
      const times = MapleCalculator.calcTimes(totalExpNeeded, expPerMin, currentMult);
      els.timeNo.textContent = times.displayNo;
      els.timeMult.textContent = times.displayMult;
      els.timeSaved.textContent = times.displaySaved;

      const ownedCoupons = parseInt(els.ownedCoupons.value, 10);
      const coupons = MapleCalculator.calcCoupons(times.minutesMult, currentMult, ownedCoupons);
      els.couponsNeeded.textContent = currentMult <= 1 ? "無需加倍卷" : coupons.couponsNeeded + " 張";

      els.couponStatusRow.hidden = !coupons.hasOwned || currentMult <= 1;
      els.couponShortRow.hidden = !(coupons.hasOwned && !coupons.enough && currentMult > 1);
      if (coupons.hasOwned && currentMult > 1) {
        els.couponStatus.textContent = coupons.enough ? "✅ 足夠" : "❌ 不足";
        els.couponShort.textContent = coupons.shortBy + " 張";
      }

      const dailyHours = parseFloat(els.dailyHours.value);
      const dailyDays = MapleCalculator.calcDailyDays(times.minutesNo, times.minutesMult, dailyHours);
      els.dailyDaysRow.hidden = !dailyDays;
      if (dailyDays) {
        els.dailyDays.textContent = `${dailyDays.daysMult} 天／${dailyDays.daysNo} 天`;
      }

      els.couponStatsBox.hidden = false;
    }

    if (window.MapleSpots) window.MapleSpots.setCurrentLevel(currentLevel);
    renderCharSelect();
  }

  // 打字就自動即時計算，不需要按按鈕
  [els.currentLevel, els.currentExp, els.targetLevel, els.expPer10Min, els.dailyHours, els.ownedCoupons].forEach(
    (el) => el.addEventListener("input", runCalculation)
  );

  // ---------- 分享連結 ----------
  els.shareBtn.addEventListener("click", async () => {
    const params = MapleCalculator.encodeShareParams({
      currentLevel: parseInt(els.currentLevel.value, 10) || 1,
      currentExp: parseInt(els.currentExp.value, 10) || 0,
      targetLevel: parseInt(els.targetLevel.value, 10) || 1,
      expPerMin: getExpPerMin() || 0,
      mult: currentMult,
      dailyHours: parseFloat(els.dailyHours.value) || 0,
      ownedCoupons: parseInt(els.ownedCoupons.value, 10) || 0,
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

    // 如果網址帶有分享參數，只暫時顯示，不寫入角色存檔
    const shared = MapleCalculator.decodeShareParams(location.search);
    if (shared.currentLevel && shared.targetLevel) {
      els.currentLevel.value = shared.currentLevel;
      els.currentExp.value = shared.currentExp || 0;
      els.targetLevel.value = shared.targetLevel;
      els.expPer10Min.value = shared.expPerMin ? shared.expPerMin * 10 : "";
      setMult(shared.mult || 2);
      els.dailyHours.value = shared.dailyHours || "";
      els.ownedCoupons.value = shared.ownedCoupons || "";
      calcAndRender();
    } else {
      loadCharIntoForm(activeCharId);
      runCalculation();
    }
  }

  window.MapleApp = { runCalculation };

  init();
})();
