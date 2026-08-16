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
      </div>
      <button class="btn btn-primary miniwin-ocr-upload" data-ow="uploadBtn" type="button" disabled>＋ 上傳到社群回報</button>
      <details class="miniwin-ocr-note">
        <summary>這個功能是怎麼算的？</summary>
        <p>
          這是實驗性功能：自動讀取畫面上的數字來算速率，偶爾會讀錯，已經有做交叉比對過濾。
          「5/10分鐘經驗」在還沒真的滿 5／10 分鐘時，是用目前的平均速率往前推算（會標「推算」），
          時間到了才會換成那段時間真正量到的數字，數字剛開始跳動比較大是正常的，會自己收斂。
          上傳按鈕要滿 5 分鐘實測才會亮，按下去只會帶入等級跟每10分經驗到回報表單，
          地圖與職業還是要你自己填、確認沒問題再送出。
        </p>
      </details>`;
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
    if (!s.samples) {
      // 重置／還沒收到任何樣本：上傳鈕鎖住，不然重開一輪會沿用上次殘留的
      // per10 值，讓人誤按到舊數據
      els.uploadBtn.disabled = true;
      return;
    }
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
    // 距離升等：優先用最近 10 分鐘的實測速率、其次 5 分鐘，都還沒滿才退回
    // 從頭到現在的整體平均。整體平均有個陷阱——如果一開始追蹤沒多久就
    // 剛好升級（那筆會把「這級剩餘＋新一級已賺的」一次算進獲得量），這種
    // 一次性爆量會永久卡在平均值的分子裡，不會隨時間自動修正，只會被
    // 稀釋得越來越慢，等更久也很難自己變準；優先用短視窗速率就不會有這個問題
    let levelRate = null;
    if (s.exp10Actual !== null) levelRate = s.exp10Actual / 10;
    else if (s.exp5Actual !== null) levelRate = s.exp5Actual / 5;
    else if (s.expPerMin > 0) levelRate = s.expPerMin;
    if (need && s.exp !== null && levelRate > 0) {
      const minutes = (need - s.exp) / levelRate;
      const fmt = window.MapleCalculator && window.MapleCalculator.formatDuration;
      els.toLevel.textContent = minutes <= 0 ? "快了！" : (fmt ? fmt(minutes) : Math.ceil(minutes) + " 分");
    } else {
      els.toLevel.textContent = "累積中…";
    }
    els.elapsed.textContent = fmtDuration(s.elapsedMs) + "・" + s.samples + " 筆";

    // 上傳到社群回報：至少要滿 5 分鐘實測才給按，優先帶最準的 10 分鐘數字
    const bestPer10 = s.exp10Actual !== null ? s.exp10Actual : s.exp5Actual !== null ? s.exp5Actual * 2 : null;
    els.uploadBtn.disabled = bestPer10 === null;
    els.uploadBtn.dataset.per10 = bestPer10 !== null ? Math.round(bestPer10) : "";
    els.uploadBtn.dataset.level = s.level;
  }

  engine.onUpdate(render);

  // 上傳到社群回報：只帶等級跟每10分經驗過去，地圖／職業／練功方式
  // 還是要玩家自己填——這是「幫忙把量到的數字帶進表單」，不是自動送出，
  // 跟 timer.js 手動測速那顆「＋新增到社群資料庫」按鈕是同一套接口
  function uploadToCommunity(btn) {
    const per10 = parseInt(btn.dataset.per10, 10);
    if (!Number.isFinite(per10) || per10 <= 0) return;
    if (!window.MapleNav || !window.MapleCommunity) return;
    window.MapleNav.switchNav("cm");
    // 社群分頁可能停在其他子分頁，表單在隱藏的「回報紀錄」裡；不先切過去
    // openForm 的 scrollIntoView/focus 都對隱藏元素無效
    window.MapleCommunity.showRecordsTab();
    if (!window.MapleCommunity.isSubmissionsOpen()) {
      const addBtn = document.getElementById("cmAddBtn");
      if (addBtn) addBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const level = parseInt(btn.dataset.level, 10);
    window.MapleCommunity.openFormWithExpPer10Min(per10, Number.isFinite(level) ? level : null);
    const original = btn.textContent;
    btn.textContent = "✓ 已帶入回報表單";
    setTimeout(() => { btn.textContent = original; }, 1500);
  }

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
    } else if (t.dataset.ow === "uploadBtn") {
      uploadToCommunity(t);
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
