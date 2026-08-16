/**
 * miniwin.js — 練等迷你小視窗（子母畫面）
 * -----------------------------------------------------------------
 * 把倒數計時器＋EXP 測速＋練等試算濃縮成一個小面板，用
 * Document Picture-in-Picture 彈成永遠置頂的獨立小視窗，
 * 疊在遊戲畫面上用（遊戲要視窗化/無邊框，獨占全螢幕蓋不上去）。
 * 瀏覽器不支援 PiP（Firefox/Safari/手機）就退回頁內懸浮面板。
 *
 * 計算全部沿用 MapleCalculator/MapleData，數字跟大分頁一致。
 *
 * 兩個 PiP 特有的坑，這裡的寫法都是針對它們：
 * 1. 事件監聽用「文件層級的事件委派」，不掛在個別輸入框上——面板被
 *    收養進 PiP 文件後，掛在元素上的監聽器在真實 PiP 視窗裡不可靠
 *    （實測輸入事件不會觸發），掛在各自文件上的委派則兩邊都穩。
 * 2. 樣式不 clone <link>（PiP 文件會自己再抓一次 CSS，抓到瀏覽器快取
 *    的舊檔），改成把主頁面當下已載入的 CSSOM 規則序列化成 <style>
 *    塞進去，保證小視窗樣式跟主頁面完全一致。
 */
(function () {
  const openBtn = document.getElementById("miniwinOpenBtn");
  if (!openBtn) return;

  const PIP_OK = "documentPictureInPicture" in window;
  const STORE_KEY = "maple_classic_miniwin";
  const calc = window.MapleCalculator;

  let panel = null; // 建一次重複用；關窗後留著（保留輸入與倒數狀態）
  let pipWin = null;
  let floatWrap = null;
  let els = null;

  // ---------- 倒數計時（時間戳回推＋Worker tick，同 timer.js 的理由：
  // 背景分頁的 setInterval 會被節流，置頂小視窗的本體其實是背景分頁） ----------
  let total = 5 * 60;
  let left = total;
  let running = false;
  let endAt = 0;
  let elapsed = 0;
  let worker = null;
  let tickFallback = null;
  let audioCtx = null;

  function startTicker() {
    stopTicker();
    try {
      const blob = new Blob(["setInterval(function(){postMessage(0)},500)"], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = tick;
    } catch {
      worker = null;
      tickFallback = setInterval(tick, 500);
    }
  }
  function stopTicker() {
    if (worker) { worker.terminate(); worker = null; }
    clearInterval(tickFallback);
  }

  function beep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const play = () => {
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
      };
      if (ctx.state === "suspended") ctx.resume().then(play);
      else play();
    } catch {}
  }

  function fmtClock(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function fmtExp(n) {
    if (n >= 1e8) return (n / 1e8).toFixed(2) + " 億";
    if (n >= 1e4) return (n / 1e4).toFixed(2) + " 萬";
    return Math.round(n).toLocaleString();
  }

  function tick() {
    const nowLeft = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (nowLeft === left) return;
    left = nowLeft;
    elapsed = total - left;
    renderClock();
    renderRate();
    if (left <= 0) {
      running = false;
      stopTicker();
      els.startBtn.textContent = "重新開始";
      els.min.disabled = false;
      els.clock.classList.add("miniwin-clock-done");
      beep();
      try {
        if (window.Notification && Notification.permission === "granted") {
          new Notification("楓錄練等小視窗", { body: "倒數結束！" });
        }
      } catch {}
    }
  }

  function renderClock() {
    if (!els) return;
    els.clock.textContent = fmtClock(left);
    if (left > 0) els.clock.classList.remove("miniwin-clock-done");
  }

  // ---------- 狀態存取 ----------
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        cur: els.cur.value, target: els.target.value, per10: els.per10.value,
        mult: els.mult.value, min: els.min.value,
      }));
    } catch {}
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }

  // ---------- 計算 ----------
  function renderResult() {
    if (!els) return;
    const cur = parseInt(els.cur.value, 10);
    const target = parseInt(els.target.value, 10);
    const per10 = calc.parseExpVal(els.per10.value);
    const mult = parseFloat(els.mult.value) || 1;
    const table = window.MapleData && window.MapleData.EXP_TABLE;

    if (!table || isNaN(cur) || isNaN(target) || cur < 1 || target < 1 || cur > 200 || target > 200) {
      els.resNeed.textContent = "—";
      els.resNo.textContent = "—";
      els.resMult.textContent = "—";
      return;
    }
    const { totalExpNeeded } = calc.calcExpNeeded(cur, 0, target, table);
    els.resNeed.textContent = target <= cur ? "已達成" : fmtExp(totalExpNeeded);
    if (isNaN(per10) || per10 <= 0 || target <= cur) {
      els.resNo.textContent = target <= cur ? "已達成" : "—";
      els.resMult.textContent = target <= cur ? "已達成" : "—";
      return;
    }
    const t = calc.calcTimes(totalExpNeeded, per10 / 10, mult);
    els.resNo.textContent = t.displayNo;
    els.resMult.textContent = "x" + mult + "　" + t.displayMult;
  }

  // ---------- EXP 測速 ----------
  // 跟網頁版 timer.js 同一套規則：計時器跑過就用實際經過的時間，
  // 沒跑過就用設定的分鐘數估（並標註是估的）
  function renderRate() {
    if (!els) return;
    const before = calc.parseExpVal(els.before.value);
    const after = calc.parseExpVal(els.after.value);
    if (isNaN(before) || isNaN(after) || after <= before) {
      els.rateRow.hidden = true;
      delete els.rateVal.dataset.raw;
      els.applyBtn.disabled = true;
      return;
    }
    const usedFallback = !(elapsed > 0);
    const secs = usedFallback ? total : elapsed;
    const per10 = ((after - before) / (secs / 60)) * 10;
    els.rateVal.textContent = fmtExp(per10) + " / 10分";
    els.rateVal.dataset.raw = String(Math.round(per10));
    els.rateBasis.textContent = usedFallback ? `（沒開計時器，依設定的 ${Math.round(total / 60)} 分估）` : "";
    els.rateRow.hidden = false;
    els.applyBtn.disabled = false;
  }

  // ---------- 控制動作 ----------
  function startPause() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {}
    if (window.Notification && Notification.permission === "default") Notification.requestPermission();
    if (running) {
      running = false;
      stopTicker();
      left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      elapsed = total - left;
      els.startBtn.textContent = "繼續";
      els.min.disabled = false;
    } else {
      if (left <= 0) { left = total; elapsed = 0; }
      running = true;
      endAt = Date.now() + left * 1000;
      els.startBtn.textContent = "暫停";
      els.min.disabled = true;
      startTicker();
    }
  }

  function resetTimer() {
    running = false;
    stopTicker();
    left = total;
    elapsed = 0;
    els.startBtn.textContent = "開始";
    els.min.disabled = false;
    renderClock();
    renderRate();
  }

  function applyRate() {
    const raw = els.rateVal.dataset.raw;
    if (!raw) return;
    els.per10.value = raw;
    saveState();
    renderResult();
    els.applyBtn.textContent = "✓";
    setTimeout(() => { els.applyBtn.textContent = "套用"; }, 1200);
  }

  // ---------- 事件委派（文件層級） ----------
  // 主文件掛一份、PiP 文件開窗時掛一份；同一顆事件只會存在其中一個文件，
  // 不會重複觸發。面板搬到哪個視窗都一定接得到事件。
  function handleInput(e) {
    if (!panel || !els) return;
    const t = e.target && e.target.closest && e.target.closest("[data-mw]");
    if (!t || !panel.contains(t)) return;
    switch (t.dataset.mw) {
      case "cur":
      case "target":
      case "per10":
      case "mult":
        saveState();
        renderResult();
        break;
      case "min": {
        const v = parseInt(els.min.value, 10);
        if (running || !v || v < 1) break;
        total = v * 60;
        left = total;
        elapsed = 0;
        saveState();
        renderClock();
        renderRate(); // 估算用的分鐘數變了，測速結果要跟著重算
        break;
      }
      case "before":
      case "after":
        renderRate();
        break;
    }
  }

  function handleClick(e) {
    if (!panel || !els) return;
    const closeBtn = e.target && e.target.closest && e.target.closest(".miniwin-close");
    if (closeBtn && panel.contains(closeBtn)) {
      closeAll();
      return;
    }
    const t = e.target && e.target.closest && e.target.closest("[data-mw]");
    if (!t || !panel.contains(t)) return;
    if (t.dataset.mw === "startBtn") startPause();
    else if (t.dataset.mw === "resetBtn") resetTimer();
    else if (t.dataset.mw === "applyBtn") applyRate();
  }

  document.addEventListener("input", handleInput);
  document.addEventListener("click", handleClick);

  // ---------- 建面板 ----------
  function buildPanel() {
    panel = document.createElement("div");
    panel.className = "miniwin";
    panel.innerHTML = `
      <div class="miniwin-head" id="miniwinDragBar">
        <span class="miniwin-title">練等小視窗</span>
        <button class="miniwin-close" type="button" title="關閉" aria-label="關閉小視窗">✕</button>
      </div>
      <div class="miniwin-grid">
        <label>目前等級<input type="number" data-mw="cur" min="1" max="200" inputmode="numeric"></label>
        <label>目標等級<input type="number" data-mw="target" min="1" max="200" inputmode="numeric"></label>
        <label>每10分經驗<input type="text" data-mw="per10" placeholder="5W／3.5萬" inputmode="decimal"></label>
        <label>經驗倍率<input type="number" data-mw="mult" min="1" max="10" step="0.1" inputmode="decimal"></label>
      </div>
      <div class="miniwin-timerrow">
        <span class="miniwin-clock" data-mw="clock">05:00</span>
        <label class="miniwin-minfield"><input type="number" data-mw="min" min="1" max="999" inputmode="numeric">分</label>
        <button class="btn btn-primary miniwin-btn" data-mw="startBtn" type="button">開始</button>
        <button class="btn btn-ghost miniwin-btn" data-mw="resetBtn" type="button">重置</button>
      </div>
      <div class="miniwin-grid miniwin-trackgrid">
        <label>測試前經驗<input type="text" data-mw="before" placeholder="185W" inputmode="decimal"></label>
        <label>測試後經驗<input type="text" data-mw="after" placeholder="200W" inputmode="decimal"></label>
        <button class="btn btn-ghost miniwin-apply" data-mw="applyBtn" type="button" disabled
          title="把實測速率套用到上面的每10分經驗">套用</button>
      </div>
      <div class="miniwin-raterow" data-mw="rateRow" hidden>
        <span>實測 <b data-mw="rateVal">—</b><span class="miniwin-rate-basis" data-mw="rateBasis"></span></span>
      </div>
      <div class="miniwin-results">
        <div class="miniwin-res-row"><span>還需經驗</span><b data-mw="resNeed">—</b></div>
        <div class="miniwin-res-row"><span>不加倍</span><b data-mw="resNo">—</b></div>
        <div class="miniwin-res-row hl"><span>加倍後</span><b data-mw="resMult">—</b></div>
      </div>`;

    els = {};
    panel.querySelectorAll("[data-mw]").forEach((el) => (els[el.dataset.mw] = el));

    // 開啟時帶入：大分頁填過的值優先，其次上次存的
    const saved = loadState();
    const mainCur = document.getElementById("currentLevel");
    const mainTarget = document.getElementById("targetLevel");
    const mainPer10 = document.getElementById("expPer10Min");
    els.cur.value = (mainCur && mainCur.value) || saved.cur || "";
    els.target.value = (mainTarget && mainTarget.value) || saved.target || "";
    els.per10.value = (mainPer10 && mainPer10.value) || saved.per10 || "";
    els.mult.value = saved.mult || "2";
    els.min.value = saved.min || "5";
    total = Math.max(1, parseInt(els.min.value, 10) || 5) * 60;
    left = total;

    renderClock();
    renderResult();
  }

  // ---------- 開關 ----------
  function isOpen() {
    return !!(pipWin || floatWrap);
  }

  function closeAll() {
    if (pipWin) {
      const w = pipWin;
      pipWin = null;
      try { w.close(); } catch {}
      document.adoptNode(panel);
    }
    if (floatWrap) {
      floatWrap.remove();
      floatWrap = null;
    }
    openBtn.textContent = "⧉ 彈出小視窗";
  }

  // 主頁切深淺色時，同步到已開啟的 PiP 視窗（樣式規則跟著 body.dark 走）
  new MutationObserver(() => {
    if (pipWin) pipWin.document.body.className = document.body.className + " miniwin-body";
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // 把主頁面「當下已生效」的樣式規則整包序列化過去。不 clone <link>：
  // PiP 文件會自己重抓 CSS，抓到瀏覽器快取的舊版時，小視窗樣式就跟主頁
  // 對不上（本機測試時實際發生過：主頁強制重新整理了，小視窗還是舊樣式）
  function copyStylesInto(doc) {
    for (const sheet of document.styleSheets) {
      try {
        const css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
        const style = doc.createElement("style");
        style.textContent = css;
        doc.head.appendChild(style);
      } catch {
        // 跨網域樣式表讀不到 cssRules（本站沒有，保險起見留著 fallback）
        if (sheet.href) {
          const link = doc.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          doc.head.appendChild(link);
        }
      }
    }
  }

  async function openPip() {
    pipWin = await window.documentPictureInPicture.requestWindow({ width: 316, height: 468 });
    copyStylesInto(pipWin.document);
    pipWin.document.documentElement.lang = "zh-Hant";
    pipWin.document.body.className = document.body.className + " miniwin-body";
    pipWin.document.body.appendChild(panel);
    // 委派監聽掛在 PiP 自己的文件上——這是小視窗裡的輸入唯一可靠的觸發路徑
    pipWin.document.addEventListener("input", handleInput);
    pipWin.document.addEventListener("click", handleClick);
    // 面板剛搬進新文件，重畫一次目前狀態
    renderClock();
    renderResult();
    renderRate();
    // 使用者按視窗自己的關閉鈕時也要把狀態收乾淨；面板要先收養回主文件，
    // 不然它會留在已關閉的文件裡，下次重開的 appendChild 行為沒有保障
    pipWin.addEventListener("pagehide", () => {
      if (pipWin) {
        pipWin = null;
        document.adoptNode(panel);
        openBtn.textContent = "⧉ 彈出小視窗";
      }
    });
  }

  function openFloat() {
    floatWrap = document.createElement("div");
    floatWrap.className = "miniwin-float";
    floatWrap.appendChild(panel);
    document.body.appendChild(floatWrap);

    // 標題列拖曳（頁內懸浮模式才需要；PiP 是真視窗、本來就能拖）
    const bar = panel.querySelector("#miniwinDragBar");
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".miniwin-close")) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = floatWrap.getBoundingClientRect();
      ox = r.left; oy = r.top;
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const x = Math.min(Math.max(0, ox + e.clientX - sx), window.innerWidth - 80);
      const y = Math.min(Math.max(0, oy + e.clientY - sy), window.innerHeight - 40);
      floatWrap.style.left = x + "px";
      floatWrap.style.top = y + "px";
      floatWrap.style.right = "auto";
      floatWrap.style.bottom = "auto";
    });
    bar.addEventListener("pointerup", () => (dragging = false));
  }

  openBtn.addEventListener("click", async () => {
    if (isOpen()) {
      closeAll();
      return;
    }
    if (!panel) buildPanel();
    else { renderResult(); renderRate(); }
    if (PIP_OK) {
      try {
        await openPip();
      } catch {
        openFloat(); // 權限被擋或其他失敗：退回頁內懸浮
      }
    } else {
      openFloat();
    }
    openBtn.textContent = "⧉ 收回小視窗";
  });
})();
