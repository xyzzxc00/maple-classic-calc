/**
 * app.js — UI 綁定層
 */
(function () {
  const STORAGE_KEY = "maple_classic_v3";
  // 跟 index.html 裡 #shareHint 的預設文字一致，壞掉的分享連結會暫時借用
  // 這個元素顯示錯誤訊息，用完要能還原成原本「已複製連結」的文字
  const SHARE_HINT_DEFAULT = "已複製連結！貼給朋友就能看到一樣的計算結果";

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
    // 兩個等級欄位都還沒填時，直接跑計算會用預設值 1/1 算出「已達成」，
    // 讓第一次來的使用者誤以為工具壞了。這裡先顯示中性的空狀態。
    if (!els.currentLevel.value.trim() && !els.targetLevel.value.trim()) {
      els.multLabel.textContent = currentMult + "x";
      els.statExpNeeded.textContent = "—";
      els.statLevelsToGo.textContent = "—";
      els.timeNo.textContent = "尚無效率資料";
      els.timeMult.textContent = "尚無效率資料";
      els.couponStatsBox.hidden = true;
      if (window.MapleSpots) window.MapleSpots.setCurrentLevel(1);
      return;
    }

    const currentLevel = parseInt(els.currentLevel.value, 10) || 1;
    const currentExp = parseInt(els.currentExp.value, 10) || 0;
    const targetLevel = parseInt(els.targetLevel.value, 10) || 1;

    const { totalExpNeeded, levelsToGo } = MapleCalculator.calcExpNeeded(
      currentLevel, currentExp, targetLevel, window.MapleData.EXP_TABLE
    );


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
    // 清除後要重新算一次（回到空狀態），不然結果面板會停在清除前的舊數字
    runCalculation();
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
    // 記下網址列本來就有查詢參數，等一下用來判斷「這是壞掉的分享連結」
    // 還是「本來就沒帶參數」，兩者都會落到 else 分支，但只有前者該提示使用者
    const hadShareParams = location.search.length > 1;
    const shared = MapleCalculator.decodeShareParams(location.search);
    if (shared.currentLevel && shared.targetLevel) {
      els.currentLevel.value = shared.currentLevel;
      els.currentExp.value = shared.currentExp || 0;
      els.targetLevel.value = shared.targetLevel;
      els.expPer10Min.value = shared.expPerMin ? shared.expPerMin * 10 : "";
      setMult(shared.mult || 2);
      els.dailyHours.value = shared.dailyHours || "";
      els.ownedCoupons.value = shared.ownedCoupons || "";
      // 用 runCalculation（含 savePrefs）讓分享值寫進 localStorage，
      // 這樣下面把參數從網址列清掉後，重新整理也不會掉回舊資料
      runCalculation();
      // 分享參數套用完就從網址列清掉，避免使用者改完數字直接複製網址時帶到舊參數
      history.replaceState(null, "", location.pathname);
    } else {
      if (hadShareParams) {
        // 有帶參數但解不出可用的等級資料 → 分享連結壞了，不要默默改用舊資料，
        // 不然朋友傳的連結打不開卻看起來像正常運作，會看到自己一堆舊數字
        els.shareHint.textContent = "分享連結解析失敗，已顯示你上次的紀錄";
        els.shareHint.hidden = false;
        setTimeout(() => {
          els.shareHint.hidden = true;
          els.shareHint.textContent = SHARE_HINT_DEFAULT;
        }, 4000);
        history.replaceState(null, "", location.pathname);
      }
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
