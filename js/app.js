/**
 * app.js — UI 綁定層
 */
(function () {
  const STORAGE_KEY = "maple_classic_v3";

  const els = {
    currentLevel: document.getElementById("currentLevel"),
    currentExp: document.getElementById("currentExp"),
    targetLevel: document.getElementById("targetLevel"),
    expPer10Min: document.getElementById("expPer10Min"),
    multBtns: document.querySelectorAll(".mult-btn"),
    customMult: document.getElementById("customMult"),
    dailyHours: document.getElementById("dailyHours"),
    ownedCoupons: document.getElementById("ownedCoupons"),
    resultPanel: document.getElementById("resultPanel"),
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

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  }

  function savePrefs() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentLevel: els.currentLevel.value,
      currentExp: els.currentExp.value,
      targetLevel: els.targetLevel.value,
      expPer10Min: els.expPer10Min.value,
      mult: currentMult,
      dailyHours: els.dailyHours.value,
      ownedCoupons: els.ownedCoupons.value,
    }));
  }

  function setMult(mult) {
    currentMult = mult;
    els.customMult.value = mult;
    els.multBtns.forEach((b) => b.classList.toggle("active", parseFloat(b.dataset.val) === mult));
  }

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

  function getExpPerMin() {
    return MapleCalculator.parseExpVal(els.expPer10Min.value) / 10;
  }

  function runCalculation() {
    savePrefs();
    calcAndRender();
  }

  function calcAndRender() {
    const currentLevel = parseInt(els.currentLevel.value, 10) || 1;
    const currentExp = parseInt(els.currentExp.value, 10) || 0;
    const targetLevel = parseInt(els.targetLevel.value, 10) || 1;

    const { totalExpNeeded, levelsToGo } = MapleCalculator.calcExpNeeded(
      currentLevel, currentExp, targetLevel, window.MapleData.EXP_TABLE
    );

    els.resultPanel.hidden = false;
    els.multLabel.textContent = currentMult + "x";

    els.statExpNeeded.textContent = targetLevel <= currentLevel ? "已達成" : totalExpNeeded.toLocaleString();
    els.statLevelsToGo.textContent = levelsToGo > 0 ? `${levelsToGo} 等` : "已達成";

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
  }

  [els.currentLevel, els.currentExp, els.targetLevel, els.expPer10Min, els.dailyHours, els.ownedCoupons].forEach(
    (el) => el.addEventListener("input", runCalculation)
  );

  document.getElementById("clearInputBtn").addEventListener("click", () => {
    els.currentLevel.value = "";
    els.currentExp.value = 0;
    els.targetLevel.value = "";
    els.expPer10Min.value = "";
    els.dailyHours.value = "";
    els.ownedCoupons.value = "";
    setMult(2);
    savePrefs();
    els.resultPanel.hidden = true;
    if (window.MapleSpots) window.MapleSpots.setCurrentLevel(1);
  });

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
      prompt("複製這個連結分享給朋友：", url);
    }
    els.shareHint.hidden = false;
    setTimeout(() => (els.shareHint.hidden = true), 3000);
  });

  function init() {
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
      const prefs = loadPrefs();
      els.currentLevel.value = prefs.currentLevel || "";
      els.currentExp.value = prefs.currentExp || 0;
      els.targetLevel.value = prefs.targetLevel || "";
      els.expPer10Min.value = prefs.expPer10Min || "";
      els.dailyHours.value = prefs.dailyHours || "";
      els.ownedCoupons.value = prefs.ownedCoupons || "";
      setMult(prefs.mult || 2);
      runCalculation();
    }
  }

  window.MapleApp = { runCalculation };
  init();
})();
