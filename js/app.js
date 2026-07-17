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
    couponStatus: document.getElementById("couponStatus"),
    couponShort: document.getElementById("couponShort"),
    dailyDays: document.getElementById("dailyDays"),
    inputWarningHint: document.getElementById("inputWarningHint"),
    shareBtn: document.getElementById("shareBtn"),
    shareThreadsBtn: document.getElementById("shareThreadsBtn"),
    shareLineBtn: document.getElementById("shareLineBtn"),
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
    els.multBtns.forEach((b) => {
      const on = parseFloat(b.dataset.val) === mult;
      b.classList.toggle("active", on);
      // .active 只有視覺，螢幕報讀器聽不出目前選了哪個倍率，aria-pressed 要跟著同步
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // 選了預設按鈕就不算自訂值，拿掉自訂輸入框的「生效中」樣式
    els.customMult.classList.remove("mult-custom-active");
  }

  els.multBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setMult(parseFloat(btn.dataset.val));
      runCalculation();
    });
  });

  els.customMult.addEventListener("input", () => {
    const parsed = parseFloat(els.customMult.value);
    // 0 或負值直接當倍率會讓後面的時間計算變成 0 或負數，所以跟「打不出數字」
    // 一樣退回預設值 1，而不是讓 "0 || 1" 這種寫法意外放行負數
    currentMult = (!isNaN(parsed) && parsed > 0) ? parsed : 1;
    els.multBtns.forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    // 五個預設按鈕都沒被選中時，靠這個樣式告訴使用者「目前生效的是這個自訂值」
    els.customMult.classList.add("mult-custom-active");
    runCalculation();
  });

  // 還原記憶值/分享值時用：跟 setMult 一樣設定倍率，但若不是五顆預設鈕之一
  // （使用者上次填的是自訂倍率），要補上自訂輸入框的「生效中」樣式——
  // setMult 只處理「按了預設鈕」的情境，會把這個樣式拿掉
  function applyMult(mult) {
    setMult(mult);
    const isPreset = [...els.multBtns].some((b) => parseFloat(b.dataset.val) === mult);
    if (!isPreset) els.customMult.classList.add("mult-custom-active");
  }

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
      els.timeSaved.textContent = "—";
      els.couponsNeeded.textContent = "—";
      els.couponStatus.textContent = "—";
      els.couponShort.textContent = "—";
      els.dailyDays.textContent = "—";
      els.inputWarningHint.hidden = true;
      if (window.MapleSpots) window.MapleSpots.setCurrentLevel(1);
      return;
    }

    const currentLevel = parseInt(els.currentLevel.value, 10) || 1;
    let currentExp = parseInt(els.currentExp.value, 10) || 0;
    const targetLevel = parseInt(els.targetLevel.value, 10) || 1;

    // 超出範圍的等級/倍率之前是直接靜默夾在合法值內去算，使用者不會知道自己
    // 打的數字沒被採用，這裡把原因講出來，計算結果本身還是照樣算給他看
    const warnings = [];
    if (els.currentLevel.value.trim() && (currentLevel < 1 || currentLevel > 200)) {
      warnings.push("目前等級請輸入 1~200 之間的整數");
    }
    if (els.targetLevel.value.trim() && (targetLevel < 1 || targetLevel > 200)) {
      warnings.push("目標等級請輸入 1~200 之間的整數");
    }
    // 目前經驗值之前是唯一沒驗證的欄位：負值會被公式當成「還缺更多」讓結果
    // 憑空膨脹；填成累積總經驗（超過該等升級所需）則會出現「還需 0 但還要
    // 升 1 等」的矛盾畫面，使用者不會知道是欄位意義填錯了
    if (els.currentExp.value.trim()) {
      if (currentExp < 0) {
        warnings.push("目前經驗值不能是負數，已暫時以 0 計算");
        currentExp = 0;
      } else {
        const curNeed = window.MapleData.EXP_TABLE[currentLevel - 1];
        if (curNeed && currentExp >= curNeed && targetLevel > currentLevel) {
          warnings.push(`目前經驗值已達這一等升級所需（${curNeed.toLocaleString()}），這欄要填「目前等級內」的經驗，不是累積總經驗`);
        }
      }
    }
    if (els.customMult.value.trim() && parseFloat(els.customMult.value) <= 0) {
      warnings.push("自訂倍率需大於 0，已暫時以 1x 計算");
    }
    // 打錯字（例如打了看不懂的字元）跟「沒填」原本都會落到同一個「尚無效率資料」，
    // 使用者不知道自己的輸入被拒絕了；這裡跟 EXP 測速一樣明講出來
    if (els.expPer10Min.value.trim() && isNaN(MapleCalculator.parseExpVal(els.expPer10Min.value))) {
      warnings.push("看不懂「每10分鐘經驗」這個數值，請輸入數字或用 W 代表萬（例如 5W 或 50000）");
    } else if (els.expPer10Min.value.trim() && MapleCalculator.parseExpVal(els.expPer10Min.value) <= 0) {
      warnings.push("「每10分鐘經驗」需大於 0 才能估算時間");
    }
    els.inputWarningHint.hidden = warnings.length === 0;
    els.inputWarningHint.textContent = warnings.join("；");

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
      els.timeSaved.textContent = "—";
      els.couponsNeeded.textContent = "—";
      els.couponStatus.textContent = "—";
      els.couponShort.textContent = "—";
      els.dailyDays.textContent = "—";
    } else {
      const times = MapleCalculator.calcTimes(totalExpNeeded, expPerMin, currentMult);
      els.timeNo.textContent = times.displayNo;
      els.timeMult.textContent = times.displayMult;
      els.timeSaved.textContent = times.displaySaved;

      const ownedCoupons = parseInt(els.ownedCoupons.value, 10);
      const coupons = MapleCalculator.calcCoupons(times.minutesMult, currentMult, ownedCoupons);
      els.couponsNeeded.textContent = currentMult <= 1 ? "無需加倍卷" : coupons.couponsNeeded + " 張";

      if (coupons.hasOwned && currentMult > 1) {
        els.couponStatus.textContent = coupons.enough ? "足夠" : "不足";
        els.couponShort.textContent = coupons.enough ? "0 張" : coupons.shortBy + " 張";
      } else {
        els.couponStatus.textContent = "—";
        els.couponShort.textContent = "—";
      }

      const dailyHours = parseFloat(els.dailyHours.value);
      const dailyDays = MapleCalculator.calcDailyDays(times.minutesNo, times.minutesMult, dailyHours);
      els.dailyDays.textContent = dailyDays ? `${dailyDays.daysMult} 天／${dailyDays.daysNo} 天` : "—";
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

  function buildShareUrl() {
    const params = MapleCalculator.encodeShareParams({
      currentLevel: parseInt(els.currentLevel.value, 10) || 1,
      currentExp: parseInt(els.currentExp.value, 10) || 0,
      targetLevel: parseInt(els.targetLevel.value, 10) || 1,
      expPerMin: getExpPerMin() || 0,
      mult: currentMult,
      dailyHours: parseFloat(els.dailyHours.value) || 0,
      ownedCoupons: parseInt(els.ownedCoupons.value, 10) || 0,
    });
    return `${location.origin}${location.pathname}?${params}`;
  }

  els.shareBtn.addEventListener("click", async () => {
    const url = buildShareUrl();
    let copied = true;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copied = false;
    }

    if (copied) {
      // 成功複製：沿用原本「已複製連結！」，3 秒後自動收起
      els.shareHint.textContent = SHARE_HINT_DEFAULT;
      els.shareHint.hidden = false;
      setTimeout(() => {
        els.shareHint.hidden = true;
        els.shareHint.textContent = SHARE_HINT_DEFAULT;
      }, 3000);
      return;
    }

    // clipboard API 失敗時，不用原生 prompt()（跟站內其他狀態提示風格不一致），
    // 改成站內樣式的可選取文字框，並自動選取整段連結，使用者按 Ctrl/Cmd+C 就好。
    // 這種情況連結不是自動被複製的，所以不能沿用「已複製連結！」文案，也不能
    // 3 秒後自動收起，不然使用者根本還沒來得及複製就消失了。
    els.shareHint.textContent = "請手動複製下面的連結：";
    els.shareHint.hidden = false;
    const fallback = document.createElement("span");
    fallback.className = "share-url-fallback";
    fallback.textContent = url;
    els.shareHint.appendChild(fallback);

    const range = document.createRange();
    range.selectNodeContents(fallback);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  // Threads/LINE 只是打開對方的分享對話框讓使用者自己送出，
  // 不會幫使用者自動發文，降低分享阻力但不是自動代發
  els.shareThreadsBtn.addEventListener("click", () => {
    const text = `我用新楓之谷經典版練等計算機算出來的結果，一起來試算你的升級時間吧！ ${buildShareUrl()}`;
    window.open(`https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  });

  els.shareLineBtn.addEventListener("click", () => {
    window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(buildShareUrl())}`, "_blank", "noopener");
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
      applyMult(shared.mult || 2);
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
      applyMult(prefs.mult || 2);
      runCalculation();
    }
  }

  window.MapleApp = { runCalculation };
  init();
})();
