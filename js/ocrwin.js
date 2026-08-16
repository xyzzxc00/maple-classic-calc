/**
 * ocrwin.js — 自動測速小視窗
 * -----------------------------------------------------------------
 * 跟練等小視窗（miniwin.js）分開的另一個彈出視窗，專門放
 * expocr.js 的螢幕自動讀取：分享遊戲視窗後自動讀 EXP／楓幣，
 * 顯示每分／每10分／每30分／每小時速率。同樣用 Document
 * Picture-in-Picture 彈成置頂視窗、不支援就退回頁內懸浮。
 *
 * 注意：瀏覽器同時只允許一個 PiP 視窗——跟練等小視窗同時開的話，
 * 後開的會把先開的擠回來（先開的自動關閉），這是瀏覽器限制。
 */
(function () {
  const openBtn = document.getElementById("ocrwinOpenBtn");
  if (!openBtn) return;

  // 依賴 expocr 引擎；不支援畫面分享的環境（手機等）直接把按鈕藏掉
  if (!window.MapleExpOcr || !window.MapleExpOcr.isSupported()) {
    openBtn.hidden = true;
    return;
  }
  const engine = window.MapleExpOcr;

  const PIP_OK = "documentPictureInPicture" in window;
  let panel = null;
  let pipWin = null;
  let floatWrap = null;
  let els = null;

  function fmtExp(n) {
    if (n >= 1e8) return (n / 1e8).toFixed(2) + " 億";
    if (n >= 1e4) return (n / 1e4).toFixed(2) + " 萬";
    return Math.round(n).toLocaleString();
  }

  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    if (m < 60) return m + " 分 " + (s % 60) + " 秒";
    return Math.floor(m / 60) + " 小時 " + (m % 60) + " 分";
  }

  function buildPanel() {
    panel = document.createElement("div");
    panel.className = "miniwin";
    panel.innerHTML = `
      <div class="miniwin-head" id="ocrwinDragBar">
        <span class="miniwin-title">自動測速</span>
        <button class="miniwin-close" type="button" title="關閉" aria-label="關閉自動測速視窗">✕</button>
      </div>
      <div class="miniwin-ocr">
        <div class="miniwin-ocr-head">
          <button class="miniwin-ocr-fold" data-ow="foldBtn" type="button" aria-expanded="true"
            title="收合／展開讀取狀態"><span class="miniwin-ocr-chevron" data-ow="chevron">▾</span>畫面讀取<span class="miniwin-ocr-tag">實驗性 v5</span></button>
          <button class="btn btn-ghost miniwin-btn" data-ow="startBtn" type="button">▶ 開始</button>
        </div>
        <div data-ow="foldBody">
          <p class="miniwin-ocr-status" data-ow="status">分享遊戲視窗後自動讀等級與 EXP</p>
          <button class="btn btn-ghost miniwin-btn miniwin-ocr-debugbtn" data-ow="debugBtn" type="button"
            title="讀不到時按這個，把畫面診斷資料開在新分頁，截圖回報用">匯出除錯資料</button>
          <div class="miniwin-ocr-debug" data-ow="debug" hidden>
            <div class="miniwin-ocr-crop"><span>等級</span><img data-ow="cropLv" alt="等級區塊預覽"></div>
            <div class="miniwin-ocr-crop"><span>EXP</span><img data-ow="cropExp" alt="EXP 區塊預覽"></div>
          </div>
        </div>
      </div>
      <div class="miniwin-results">
        <div class="miniwin-res-row"><span>目前等級</span><b data-ow="lv">—</b></div>
        <div class="miniwin-res-row"><span>目前經驗</span><b data-ow="exp">—</b></div>
        <div class="miniwin-res-row"><span>5分鐘經驗</span><b data-ow="exp5">—</b></div>
        <div class="miniwin-res-row"><span>10分鐘經驗</span><b data-ow="exp10">—</b></div>
        <div class="miniwin-res-row hl"><span>距離升等還要</span><b data-ow="toLevel">—</b></div>
        <div class="miniwin-res-row"><span>已讀取時間</span><b data-ow="elapsed">—</b></div>
      </div>`;
    els = {};
    panel.querySelectorAll("[data-ow]").forEach((el) => (els[el.dataset.ow] = el));
    render(engine.getState());
  }

  function render(s) {
    if (!els) return;
    els.startBtn.textContent = s.running ? "■ 停止" : "▶ 開始";
    els.status.textContent = s.status || "分享遊戲視窗後自動讀等級與 EXP";
    if (s.crops) {
      els.debug.hidden = false;
      els.cropLv.src = s.crops.lv;
      els.cropExp.src = s.crops.exp;
    } else if (!s.running) {
      els.debug.hidden = true;
    }
    if (!s.samples) return;
    els.lv.textContent = "Lv." + s.level;
    // 百分比用「驗證過的經驗值 ÷ 升級需求」現算，比 OCR 直讀的百分比準
    // （直讀的偶爾會有一位數字誤讀，經驗值本身有交叉驗證把關）
    const table = window.MapleData && window.MapleData.EXP_TABLE;
    const need = table && s.level >= 1 && s.level <= table.length ? table[s.level - 1] : null;
    const pct = need && s.exp !== null ? ((s.exp / need) * 100).toFixed(2) : null;
    els.exp.textContent = (s.exp !== null ? s.exp.toLocaleString() : "—") +
      (pct !== null ? "（" + pct + "%）" : "");
    // 5/10 分鐘：讀滿該時長前用平均速率推算（標註），滿了改用該時段實測值
    const showWindow = (el, actual, mins) => {
      if (actual !== null) el.textContent = fmtExp(actual);
      else if (s.expPerMin > 0) el.textContent = fmtExp(s.expPerMin * mins) + "（推算）";
      else el.textContent = "累積中…";
    };
    showWindow(els.exp5, s.exp5Actual, 5);
    showWindow(els.exp10, s.exp10Actual, 10);
    // 距離升等：用本站經驗值表算還缺多少，除以實測速率（need 沿用上面的）
    if (need && s.exp !== null && s.expPerMin > 0) {
      const minutes = (need - s.exp) / s.expPerMin;
      const fmt = window.MapleCalculator && window.MapleCalculator.formatDuration;
      els.toLevel.textContent = minutes <= 0 ? "快了！" : (fmt ? fmt(minutes) : Math.ceil(minutes) + " 分");
    } else {
      els.toLevel.textContent = "累積中…";
    }
    els.elapsed.textContent = fmtDuration(s.elapsedMs) + "・" + s.samples + " 筆";
  }

  engine.onUpdate(render);

  // ---------- 事件委派（同 miniwin：主文件＋PiP 文件各掛一份） ----------
  function handleClick(e) {
    if (!panel || !els) return;
    const closeBtn = e.target && e.target.closest && e.target.closest(".miniwin-close");
    if (closeBtn && panel.contains(closeBtn)) {
      closeAll();
      return;
    }
    const t = e.target && e.target.closest && e.target.closest("[data-ow]");
    if (!t || !panel.contains(t)) return;
    if (t.dataset.ow === "startBtn") {
      if (engine.running()) engine.stop();
      // 把「點擊發生的視窗」傳給 start：在 PiP 裡按時，使用者授權在
      // PiP 視窗上，要用它的 navigator 請求畫面分享才會成功
      else engine.start(t.ownerDocument.defaultView || window);
    } else if (t.dataset.ow === "debugBtn") {
      engine.debugDump();
    } else if (t.dataset.ow === "foldBtn") {
      const open = els.foldBody.hidden;
      els.foldBody.hidden = !open;
      els.chevron.textContent = open ? "▾" : "▸";
      t.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }
  document.addEventListener("click", handleClick);

  // ---------- 開關（同 miniwin 的殼，狀態各自獨立） ----------
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
    openBtn.textContent = "⧉ 自動測速視窗";
  }

  new MutationObserver(() => {
    if (pipWin) pipWin.document.body.className = document.body.className + " miniwin-body";
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  function copyStylesInto(doc) {
    for (const sheet of document.styleSheets) {
      try {
        const css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
        const style = doc.createElement("style");
        style.textContent = css;
        doc.head.appendChild(style);
      } catch {
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
    pipWin = await window.documentPictureInPicture.requestWindow({ width: 316, height: 470 });
    copyStylesInto(pipWin.document);
    pipWin.document.documentElement.lang = "zh-Hant";
    pipWin.document.body.className = document.body.className + " miniwin-body";
    pipWin.document.body.appendChild(panel);
    pipWin.document.addEventListener("click", handleClick);
    render(engine.getState());
    pipWin.addEventListener("pagehide", () => {
      if (pipWin) {
        pipWin = null;
        document.adoptNode(panel);
        openBtn.textContent = "⧉ 自動測速視窗";
      }
    });
  }

  function openFloat() {
    floatWrap = document.createElement("div");
    floatWrap.className = "miniwin-float miniwin-float--ocr";
    floatWrap.appendChild(panel);
    document.body.appendChild(floatWrap);
    const bar = panel.querySelector("#ocrwinDragBar");
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
    else render(engine.getState());
    if (PIP_OK) {
      try {
        await openPip();
      } catch {
        openFloat();
      }
    } else {
      openFloat();
    }
    openBtn.textContent = "⧉ 收回測速視窗";
  });
})();
