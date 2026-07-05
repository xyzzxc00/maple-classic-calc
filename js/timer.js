/**
 * timer.js — 倒數計時器 + EXP 測速
 * -----------------------------------------------------------------
 * 跟資料層完全無關，遊戲沒上線也能用：純粹算「測試這段時間賺了多少經驗」。
 * -----------------------------------------------------------------
 */
(function () {
  const CIRC = 2 * Math.PI * 80; // 502.65

  const els = {
    presets: document.querySelectorAll(".timer-preset"),
    customMin: document.getElementById("timerCustomMin"),
    ring: document.getElementById("timerRing"),
    display: document.getElementById("timerDisplay"),
    label: document.getElementById("timerLabel"),
    startBtn: document.getElementById("timerStartBtn"),
    resetBtn: document.getElementById("timerResetBtn"),
    expBefore: document.getElementById("expBefore"),
    expAfter: document.getElementById("expAfter"),
    expRateBox: document.getElementById("expRateBox"),
    expRateHint: document.getElementById("expRateHint"),
    expGained: document.getElementById("expGained"),
    expDuration: document.getElementById("expDuration"),
    expPerMinResult: document.getElementById("expPerMinResult"),
    expPerHourResult: document.getElementById("expPerHourResult"),
    applyExpRateBtn: document.getElementById("applyExpRateBtn"),
    applyToCmBtn: document.getElementById("applyToCmBtn"),
    clearTrackerBtn: document.getElementById("clearTrackerBtn"),
  };

  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  let timerTotal = 60;
  let timerLeft = 60;
  let timerElapsed = 0;
  let timerRunning = false;
  let timerInterval = null;
  let timerEndAt = 0; // 執行中的預計結束時間戳（ms）

  const parseExpVal = MapleCalculator.parseExpVal;

  function formatExp(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(2) + " 兆";
    if (n >= 1e8) return (n / 1e8).toFixed(2) + " 億";
    if (n >= 1e4) return (n / 1e4).toFixed(2) + " 萬";
    return Math.round(n).toLocaleString();
  }

  function formatDuration(mins) {
    if (mins < 1) return Math.ceil(mins * 60) + " 秒";
    if (mins < 60) return mins.toFixed(1) + " 分鐘";
    return (mins / 60).toFixed(1) + " 小時";
  }

  // ---------- 倒數計時器 ----------
  function renderTimer() {
    const m = Math.floor(timerLeft / 60);
    const s = timerLeft % 60;
    els.display.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    els.display.classList.remove("timer-done-flash");

    const ratio = timerTotal > 0 ? timerLeft / timerTotal : 1;
    els.ring.style.strokeDashoffset = CIRC * (1 - ratio);

    const pct = ratio * 100;
    els.display.className = "timer-time" + (pct <= 10 ? " danger" : pct <= 25 ? " warning" : "");
    els.ring.className = "timer-ring-prog" + (pct <= 10 ? " danger" : pct <= 25 ? " warning" : "");

    if (timerLeft > 0 && !timerRunning) els.label.textContent = "準備開始";
    else if (timerRunning) els.label.textContent = "計時中";
  }

  function setTimerLength(minutes) {
    if (timerRunning) return;
    timerTotal = minutes * 60;
    timerLeft = timerTotal;
    timerElapsed = 0;
    renderTimer();
  }

  els.presets.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.presets.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      els.customMin.value = "";
      setTimerLength(parseInt(btn.dataset.min, 10));
    });
  });

  els.customMin.addEventListener("input", () => {
    const val = parseInt(els.customMin.value, 10);
    // 打 0、負數或清空之前是直接把所有 preset 按鈕的 active 拿掉、但不改變計時長度，
    // 使用者會看到全部按鈕都沒選取、卻不知道目前實際是幾分鐘。無效值時保持原本
    // 的選取狀態不變，只有真的輸入有效分鐘數才切換掉 preset 的 active
    if (val && val >= 1) {
      els.presets.forEach((b) => b.classList.remove("active"));
      setTimerLength(val);
    }
  });

  // 剩餘秒數用「結束時間戳 - 現在」回推，而不是每秒 -1：
  // 背景分頁的 setInterval 會被瀏覽器節流（最慢一分鐘才跑一次），
  // 用計數的話掛在背景打怪時會越走越慢，測速的經過時間也會跟著錯。
  function timerTick() {
    const left = Math.max(0, Math.round((timerEndAt - Date.now()) / 1000));
    if (left === timerLeft) return;
    timerLeft = left;
    timerElapsed = timerTotal - timerLeft;
    renderTimer();
    calcExpRate();
    if (timerLeft <= 0) {
      timerRunning = false;
      clearInterval(timerInterval);
      els.startBtn.textContent = "重新開始";
      els.label.textContent = "時間到！";
      els.display.classList.add("timer-done-flash");
      timerBeep();
      if (window.Notification && Notification.permission === "granted") {
        new Notification("經典版練等計算機", { body: "倒數結束！" });
      }
    }
  }

  els.startBtn.addEventListener("click", () => {
    getAudioCtx(); // 在使用者點擊時初始化，iOS 需要這樣才能播聲音
    // 通知權限也在使用者手勢中請求（避免一進站就跳權限、被瀏覽器懲罰）
    if (window.Notification && Notification.permission === "default") {
      Notification.requestPermission();
    }
    if (timerRunning) {
      timerRunning = false;
      clearInterval(timerInterval);
      // 暫停時先跟時間戳對齊一次，避免顯示停在半秒前的狀態
      timerLeft = Math.max(0, Math.round((timerEndAt - Date.now()) / 1000));
      timerElapsed = timerTotal - timerLeft;
      els.startBtn.textContent = "繼續";
      els.label.textContent = "已暫停";
    } else {
      if (timerLeft <= 0) {
        timerLeft = timerTotal;
        timerElapsed = 0;
      }
      timerRunning = true;
      timerEndAt = Date.now() + timerLeft * 1000;
      els.startBtn.textContent = "暫停";
      timerInterval = setInterval(timerTick, 500);
    }
  });

  // 從背景分頁切回來時立刻對時，不用等下一次被節流的 tick
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && timerRunning) timerTick();
  });

  els.resetBtn.addEventListener("click", () => {
    timerRunning = false;
    clearInterval(timerInterval);
    timerLeft = timerTotal;
    timerElapsed = 0;
    els.startBtn.textContent = "開始";
    els.display.classList.remove("timer-done-flash");
    renderTimer();
  });

  function timerBeep() {
    try {
      const ctx = getAudioCtx();
      [0, 0.3, 0.6].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.4, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.25);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.25);
      });
    } catch {}
  }

  // ---------- EXP 測速 ----------
  let lastExpPerMin = 0;
  let lastExpPerHour = 0;
  // 跟 index.html 裡 #expRateHint 的預設文字一致，輸入有問題時會暫時借用
  // 這個位置顯示原因，講完要能還原成原本的說明文字
  const EXP_RATE_HINT_DEFAULT = "輸入前後經驗值後自動計算速率（測試時長以倒數計時器經過的時間為準，沒開計時器則用上面設定的分鐘數）";

  function calcExpRate() {
    const beforeRaw = els.expBefore.value.trim();
    const afterRaw = els.expAfter.value.trim();

    // 三種「還沒有結果」的情況給不同訊息，不然使用者打錯字或前後填反了，
    // 只看到跟「完全沒填」一樣的說明文字，不知道自己的輸入被拒絕了
    if (!beforeRaw || !afterRaw) {
      els.expRateBox.hidden = true;
      els.expRateHint.textContent = EXP_RATE_HINT_DEFAULT;
      els.expRateHint.hidden = false;
      return;
    }

    const before = parseExpVal(beforeRaw);
    const after = parseExpVal(afterRaw);

    if (isNaN(before) || isNaN(after)) {
      els.expRateBox.hidden = true;
      els.expRateHint.textContent = "看不懂這個數值，請輸入數字或用 W 代表萬（例如 5W 或 50000）";
      els.expRateHint.hidden = false;
      return;
    }
    if (after <= before) {
      els.expRateBox.hidden = true;
      els.expRateHint.textContent = "測試後經驗值要比測試前大，才能算出速率";
      els.expRateHint.hidden = false;
      return;
    }

    const gained = after - before;
    const secs = timerElapsed > 0 ? timerElapsed : timerTotal;
    const mins = secs / 60;
    lastExpPerMin = gained / mins;
    lastExpPerHour = Math.round(lastExpPerMin * 60);

    els.expGained.textContent = formatExp(gained);
    els.expDuration.textContent = formatDuration(mins);
    els.expPerMinResult.textContent = formatExp(lastExpPerMin);
    els.expPerHourResult.textContent = formatExp(lastExpPerHour);

    els.expRateBox.hidden = false;
    els.expRateHint.hidden = true;
  }

  [els.expBefore, els.expAfter].forEach((el) => el.addEventListener("input", calcExpRate));

  els.clearTrackerBtn.addEventListener("click", () => {
    els.expBefore.value = "";
    els.expAfter.value = "";
    els.expRateBox.hidden = true;
    els.expRateHint.textContent = EXP_RATE_HINT_DEFAULT;
    els.expRateHint.hidden = false;
  });

  els.applyExpRateBtn.addEventListener("click", () => {
    if (!lastExpPerMin) return;
    const expInput = document.getElementById("expPer10Min");
    expInput.value = Math.round(lastExpPerMin * 10);
    if (window.MapleApp && window.MapleApp.runCalculation) window.MapleApp.runCalculation();
    expInput.scrollIntoView({ behavior: "smooth", block: "center" });
    expInput.focus();
    const originalText = els.applyExpRateBtn.textContent;
    els.applyExpRateBtn.textContent = "✓ 已套用！";
    setTimeout(() => {
      els.applyExpRateBtn.textContent = originalText;
    }, 1200);
  });

  els.applyToCmBtn.addEventListener("click", () => {
    if (!lastExpPerMin) return;
    // 回報還沒開放時，表單不會打開，這裡先給訊息再切分頁，
    // 不然使用者點了按鈕、切過去卻什麼事都沒發生，會以為壞了
    if (window.MapleCommunity && !window.MapleCommunity.isSubmissionsOpen()) {
      window.MapleNav.switchNav("cm");
      const msgEl = document.getElementById("cmMsg");
      if (msgEl) {
        msgEl.textContent = window.MapleCommunity.submissionsClosedMsg;
        msgEl.className = "cm-msg err";
      }
      return;
    }
    window.MapleNav.switchNav("cm");
    if (window.MapleCommunity) window.MapleCommunity.openFormWithExpPer10Min(Math.round(lastExpPerMin * 10));
  });

  renderTimer();
})();
