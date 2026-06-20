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

  let timerTotal = 60;
  let timerLeft = 60;
  let timerElapsed = 0;
  let timerRunning = false;
  let timerInterval = null;

  function parseExpVal(val) {
    if (!val || !val.trim()) return NaN;
    const s = val.trim().toUpperCase().replace(/[,\s]/g, "");
    if (s.endsWith("W")) {
      const n = parseFloat(s.slice(0, -1));
      return isNaN(n) ? NaN : n * 10000;
    }
    return parseFloat(s);
  }

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
    els.presets.forEach((b) => b.classList.remove("active"));
    if (val && val >= 1) setTimerLength(val);
  });

  function timerTick() {
    timerLeft--;
    timerElapsed++;
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
    if (timerRunning) {
      timerRunning = false;
      clearInterval(timerInterval);
      els.startBtn.textContent = "繼續";
      els.label.textContent = "已暫停";
    } else {
      if (timerLeft <= 0) {
        timerLeft = timerTotal;
        timerElapsed = 0;
      }
      timerRunning = true;
      els.startBtn.textContent = "暫停";
      timerInterval = setInterval(timerTick, 1000);
    }
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
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
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

  if (window.Notification && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // ---------- EXP 測速 ----------
  let lastExpPerMin = 0;
  let lastExpPerHour = 0;

  function calcExpRate() {
    const before = parseExpVal(els.expBefore.value);
    const after = parseExpVal(els.expAfter.value);

    if (isNaN(before) || isNaN(after) || after <= before) {
      els.expRateBox.hidden = true;
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
    els.expRateHint.hidden = false;
  });

  els.applyExpRateBtn.addEventListener("click", () => {
    if (!lastExpPerMin) return;
    document.getElementById("expPer10Min").value = Math.round(lastExpPerMin * 10);
    window.MapleNav.switchNav("calc");
    if (window.MapleApp && window.MapleApp.runCalculation) window.MapleApp.runCalculation();
    const originalText = els.applyExpRateBtn.textContent;
    els.applyExpRateBtn.textContent = "✓ 已套用！";
    setTimeout(() => (els.applyExpRateBtn.textContent = originalText), 2000);
  });

  els.applyToCmBtn.addEventListener("click", () => {
    if (!lastExpPerMin) return;
    window.MapleNav.switchNav("cm");
    if (window.MapleCommunity) window.MapleCommunity.openFormWithExpPer10Min(Math.round(lastExpPerMin * 10));
  });

  renderTimer();
})();
