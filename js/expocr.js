/**
 * expocr.js — 螢幕讀取 EXP（實驗性）
 * -----------------------------------------------------------------
 * 用瀏覽器的 getDisplayMedia 請玩家分享遊戲視窗，每秒截一格畫面，
 * 讀出等級與 EXP，自動累計獲得經驗、換算速率。
 *
 * 辨識架構：
 * - 定位：優先重用已驗證位置，再嘗試新版底部 HUD 與舊版型；仍讀不到時，
 *   以綠色 EXP 括號和橘色等級徽章定位，通過數值交叉驗證才鎖定；最後
 *   再把整條狀態列丟給 Tesseract OCR（只在這一步用），
 *   利用它會回報「每個詞的座標」，找到「數字[百分比%]」樣式的詞
 *   （＝EXP）鎖定位置；等級用同一行左段，可涵蓋未預先收錄的解析度。
 * - 讀值：不用 OCR——遊戲數字是固定點陣字形（EXP 5×7、等級徽章 7×7），
 *   直接用實機點陣字模比對。每次必須以等級需求驗證 EXP 與百分比，
 *   不能只因為連續讀到相同數字就接受；百分比取數字末兩位當小數。
 *
 * 防誤判：
 * 1. EXP 數字與百分比交叉驗證（用本站經驗值表），對不上就丟棄
 * 2. EXP 讀值倒退（同等級）視為誤讀丟棄
 * 3. 等級跳動超過 +1 或倒退丟棄
 * 4. 圖樣比對分數太差的字直接不算（維持「寧可跳過不收錯」）
 *
 * 只在桌面瀏覽器可用（getDisplayMedia 手機不支援）；顯示端在
 * ocrwin.js（自動測速小視窗）。
 */
(function () {
  const INTERVAL_MS = 1000; // 圖樣比對是純像素運算，毫秒級，真的可以每秒讀
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const OCR_PADDING = 16;
  const CALIBRATION_TIMEOUT_MS = 15000;
  const HUD_SEARCH_LIMITS = Object.freeze({ pairs: 512, expReads: 48, levelReads: 16, opensPerBadge: 64 });

  // 校準失敗時的最後退路：常見全螢幕解析度下，等級/EXP 佔畫面的比例位置
  const PRESETS = {
    "1366x768": {
      lv: { x: 0.211973, y: 0.96, width: 0.051542, height: 0.038541 },
      exp: { x: 0.528913, y: 0.955321, width: 0.090558, height: 0.017685 },
    },
    "1920x1080": {
      lv: { x: 0.295238, y: 0.96875, width: 0.036366, height: 0.03125 },
      exp: { x: 0.519505, y: 0.968093, width: 0.064862, height: 0.013179 },
    },
    "2560x1440": {
      lv: { x: 0.210742, y: 0.96, width: 0.052362, height: 0.034895 },
      exp: { x: 0.529064, y: 0.959139, width: 0.090317, height: 0.015446 },
    },
    "2732x1440": {
      lv: { x: 0.227149, y: 0.959786, width: 0.052363, height: 0.039222 },
      exp: { x: 0.526452, y: 0.958579, width: 0.086042, height: 0.015653 },
    },
    "2732x1536": {
      lv: { x: 0.227149, y: 0.959786, width: 0.052363, height: 0.039222 },
      exp: { x: 0.526452, y: 0.958579, width: 0.086042, height: 0.015653 },
    },
    "3840x2160": {
      lv: { x: 0.304671, y: 0.970209, width: 0.038418, height: 0.029791 },
      exp: { x: 0.518695, y: 0.971186, width: 0.060811, height: 0.011738 },
    },
  };

  // ---------- 點陣字模（實機字形；EXP 白色數字 5×7、等級徽章白色數字 7×7）----------
  const EXP_TPL = {
    "0": [{ w: 5, h: 7, bits: "01110100011000110001100011000101110" }],
    "1": [
      { w: 2, h: 7, bits: "11111101010101" },
      { w: 1, h: 7, bits: "1111111" },
    ],
    "2": [{ w: 5, h: 7, bits: "01110100010000100010001000100011111" }],
    "3": [{ w: 5, h: 7, bits: "01110100010000100110000011000101110" }],
    "4": [{ w: 5, h: 7, bits: "00010001100101010010111110001000010" }],
    "5": [{ w: 5, h: 7, bits: "11111100001000001110000011000101110" }],
    "6": [{ w: 5, h: 7, bits: "01110100011000011110100011000101110" }],
    "7": [{ w: 5, h: 7, bits: "11111000010000100001000100010000100" }],
    "8": [{ w: 5, h: 7, bits: "01110100011000101110100011000101110" }],
    "9": [{ w: 5, h: 7, bits: "01110100011000101111000011000101110" }],
  };
  const LV_TPL = {
    "0": [{ w: 7, h: 7, bits: "0111110110001111000111100011110001111000110111110" }],
    // 「1」三種變體：有左襯線（移植字模的原样）、2px 光棍、1px 光棍。
    // 實機（1368x800 視窗）的徽章「1」渲染出來就是光棍——襯線那顆點被
    // 顏色過濾吃掉或字型本身沒有。只有有襯線字模時，光棍的比對分數是
    // 0.286、剛好超過容錯上限被整個否決（Lv.51 讀不到的實際元兇，跟
    // EXP 字模的「1」本來就備有窄版變體是同一個道理）
    "1": [
      { w: 3, h: 7, bits: "011111011011011011011" },
      { w: 2, h: 7, bits: "11111111111111" },
      { w: 1, h: 7, bits: "1111111" },
    ],
    "2": [{ w: 7, h: 7, bits: "0111110110001100000110011110011000011000001111111" }],
    "3": [{ w: 7, h: 7, bits: "0111110110001100000110011110000001111000110111110" }],
    "4": [{ w: 7, h: 7, bits: "0001110001111001101101100110111111100001100000110" }],
    "5": [{ w: 7, h: 7, bits: "1111111110000011000000111110000001111000110111110" }],
    "6": [{ w: 7, h: 7, bits: "0111110110001111000001111110110001111000110111110" }],
    "7": [{ w: 7, h: 7, bits: "1111111000001100001100001100000110000110000011000" }],
    "8": [{ w: 7, h: 7, bits: "0111110110001111000110111110110001111000110111110" }],
    "9": [{ w: 7, h: 7, bits: "0111110110001111000110111111000001111000110111110" }],
  };

  // 像素分類（實機校準過的顏色條件）
  function expWhiteInk(r, g, b) {
    const br = (r + g + b) / 3;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return br > 145 && sat < 135;
  }
  function expBracketInk(r, g, b) {
    return g > 125 && r < 190 && b < 170 && g - r > 25; // 綠色中括號
  }
  function lvBadgeInk(r, g, b) {
    return r > 150 && g > 60 && b < 130 && r - b > 50; // 橘色等級徽章
  }
  function lvWhiteInk(r, g, b) {
    const br = (r + g + b) / 3;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return br > 180 && sat < 90 && r > 150 && g > 150 && b > 145; // 徽章裡的白色數字
  }

  const state = {
    running: false,
    stream: null,
    video: null,
    timer: null,
    tickOwner: null,
    tesseractFailed: false,
    status: "",
    presetKey: "",
    // 最新讀值
    level: null,
    exp: null,
    percent: null,
    crops: null, // 診斷用：最近一次裁切區塊的預覽圖（dataURL）
    // 校準鎖定的區塊（座標綁定目前的擷取尺寸）
    lvRectLock: null,
    expRectLock: null,
    lockSize: "",
    lockMisses: 0,
    calibrateAttempts: 0,
    lvWide: false,
    generation: 0, // 停止、重新定位或切換來源後，舊的非同步校準不能回寫。
    // 累計
    firstAt: 0,
    lastAt: 0,
    lastLevel: null,
    lastExp: null,
    gainedExp: 0,
    samples: 0,
    rejects: 0,
    history: [], // 每筆收下的樣本 {t, gained}——算「實測 5/10 分鐘視窗」用
    contRejects: 0, // 連續「驗證有過卻跟前一筆接不上」的筆數（重新對齊用）
  };

  const listeners = [];
  function emit() {
    const snap = getState();
    listeners.forEach((cb) => {
      try { cb(snap); } catch {}
    });
  }
  function setStatus(msg) {
    state.status = msg;
    emit();
  }

  // 「實測 N 分鐘獲得」：從歷史樣本找 N 分鐘前的累計值，跟現在相減。
  // 讀取還沒滿 N 分鐘就回 null（顯示端會改用平均速率推算）
  function windowGain(minutes) {
    const ms = minutes * 60000;
    if (!state.firstAt || !state.lastAt || state.lastAt - state.firstAt < ms) return null;
    const target = state.lastAt - ms;
    // 歷史樣本裡沒有「N 分鐘前（或更早）」的基準點＝中間讀取斷過太久、
    // 舊樣本被修剪掉了。這時不能退回「從開始累計」當基準——那會把整場
    // 的經驗當成 N 分鐘量報出來。老實回 null，等視窗重新填滿再顯示實測
    if (!state.history.length || state.history[0].t > target) return null;
    let base = state.history[0];
    for (const h of state.history) {
      if (h.t <= target) base = h;
      else break;
    }
    return state.gainedExp - base.gained;
  }

  function getState() {
    const elapsedMs = state.firstAt ? (state.lastAt || Date.now()) - state.firstAt : 0;
    const elapsedMin = elapsedMs / 60000;
    const expPerMin = elapsedMin > 0 ? state.gainedExp / elapsedMin : 0;
    return {
      supported: isSupported(),
      running: state.running,
      status: state.status,
      presetKey: state.presetKey,
      level: state.level,
      exp: state.exp,
      percent: state.percent,
      elapsedMs,
      gainedExp: state.gainedExp,
      expPerMin,
      exp5Actual: windowGain(5),
      exp10Actual: windowGain(10),
      samples: state.samples,
      rejects: state.rejects,
      crops: state.crops,
      lastTickDebug: state.lastTickDebug,
    };
  }

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }

  // ---------- Tesseract（只用在校準定位；常駐 worker） ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  let workerPromise = null;
  let currentWorker = null;
  let workerUse = null;
  let workerShutdown = Promise.resolve();
  function ensureWorker() {
    if (state.tesseractFailed) return Promise.resolve(null);
    if (!workerPromise) {
      setStatus("辨識元件載入中…（第一次要下載，約幾 MB）");
      const pending = workerShutdown
        .then(() => window.Tesseract ? null : loadScript(TESSERACT_URL))
        .then(() => window.Tesseract.createWorker("eng"))
        .then(worker => {
          if (workerPromise === pending) currentWorker = worker;
          return worker;
        })
        .catch(() => {
          if (workerPromise === pending) state.tesseractFailed = true;
          return null;
        });
      workerPromise = pending;
    }
    return workerPromise;
  }

  function retireWorker(worker) {
    if (!worker || currentWorker !== worker) return;
    currentWorker = null;
    workerPromise = null;
    // 不在仍執行中的 worker 上開始另一輪 setParameters/recognize。
    // 清理中的 promise 也共用；即使終止卡住，新世代的像素讀取仍可運作。
    workerShutdown = Promise.resolve().then(() => worker.terminate());
    workerShutdown.catch(() => {});
  }

  function invalidateTick() {
    const previous = state.tickOwner;
    state.generation++;
    state.tickOwner = null;
    if (previous && previous.cancelCalibration) previous.cancelCalibration();
  }

  function fixDigitConfusion(text) {
    return String(text)
      .replace(/[OoQD]/g, "0").replace(/[Il|]/g, "1").replace(/[Zz]/g, "2")
      .replace(/[Aa]/g, "4").replace(/[Ss]/g, "5").replace(/[Gb]/g, "6")
      .replace(/[Tt]/g, "7").replace(/[B]/g, "8").replace(/[g]/g, "9");
  }

  // ---------- 裁切工具 ----------
  function presetChoices(w, h) {
    const exactKey = w + "x" + h;
    const targetAspect = w / Math.max(1, h);
    return Object.keys(PRESETS)
      .map((key) => {
        const [pw, ph] = key.split("x").map(Number);
        const sizeDistance = Math.abs(Math.log(w / pw)) + Math.abs(Math.log(h / ph));
        const aspectDistance = Math.abs(Math.log(targetAspect / (pw / ph)));
        return { key, preset: PRESETS[key], exact: key === exactKey, score: sizeDistance + aspectDistance * 3 };
      })
      .sort((a, b) => Number(b.exact) - Number(a.exact) || a.score - b.score);
  }

  function pickPreset(w, h) {
    const best = presetChoices(w, h)[0];
    return { key: best.exact ? best.key : best.key + "（近似）", preset: best.preset };
  }

  function rectFor(preset, name, w, h) {
    const r = preset[name];
    return {
      x: Math.round(r.x * w),
      y: Math.round(r.y * h),
      width: Math.max(1, Math.round(r.width * w)),
      height: Math.max(1, Math.round(r.height * h)),
    };
  }

  // 未收錄的解析度不能只看「最接近的寬度」猜一組座標：同樣 2560 寬可能是
  // 16:9、21:9 或視窗模式，HUD 版型不一定相同。圖樣比對成本很低，因此把
  // 所有已知版型依尺寸／長寬比排序後逐一嘗試；座標完全相同的版型去重。
  // 這讓 1280×720、1600×900、1920×1200、3440×1440、5120×1440 等
  // 非精準 preset 也能命中，而不是在第一組猜錯後立刻依賴外部 OCR 校準。
  function presetReadCandidates(w, h) {
    const seen = new Set();
    const out = [];
    for (const choice of presetChoices(w, h)) {
      // 比例座標在某些高度會因四捨五入超出底邊 1px；候選、鎖定、
      // 預覽與除錯全部從這裡就使用同一個合法矩形，避免各自裁出不同結果。
      const lv = clampRect(rectFor(choice.preset, "lv", w, h), w, h);
      const exp = clampRect(rectFor(choice.preset, "exp", w, h), w, h);
      const signature = [lv.x, lv.y, lv.width, lv.height, exp.x, exp.y, exp.width, exp.height].join(":");
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push({
        key: choice.key,
        lv,
        exp,
        wide: false,
        tag: choice.exact ? "精準版型 " + choice.key : "候選版型 " + choice.key,
      });
    }
    return out;
  }

  function clampRect(rect, w, h) {
    const x = Math.max(0, Math.min(Math.round(rect.x), w - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), h - 1));
    return {
      x,
      y,
      width: Math.max(1, Math.min(Math.round(rect.width), w - x)),
      height: Math.max(1, Math.min(Math.round(rect.height), h - y)),
    };
  }

  // 9/10 HUD：等級靠左、EXP 在底部右半。UI 像素大小不一定隨解析度同比
  // 放大，所以同時涵蓋原生 UI 與常見 DPI；找不到時再用顏色特徵定位。
  function modernReadCandidates(w, h) {
    const scales = [...new Set([1, h / 768, 1.25, 1.5, 1.75, 2, 2.5, 3, 4])];
    return scales.filter(s => s >= 0.75 && s <= 4).map(scale => ({
      key: "hud-20260910-" + scale,
      lv: clampRect({ x: 0, y: Math.round(h - 40 * scale),
        width: Math.round(Math.min(w * 0.4, 110 * scale)), height: Math.round(40 * scale) }, w, h),
      exp: clampRect({ x: Math.round(w * 0.55), y: Math.round(h - 39 * scale),
        width: Math.round(w * 0.22), height: Math.round(15 * scale) }, w, h),
      wide: true,
      tag: "新版狀態列 " + Math.round(scale * 100) + "%",
    }));
  }

  function slicePixels(img, rect) {
    const r = clampRect(rect, img.width, img.height);
    const data = new Uint8ClampedArray(r.width * r.height * 4);
    for (let y = 0; y < r.height; y++) {
      const start = ((r.y + y) * img.width + r.x) * 4;
      data.set(img.data.subarray(start, start + r.width * 4), y * r.width * 4);
    }
    return { width: r.width, height: r.height, data };
  }

  // 連通色塊不依賴絕對座標，可涵蓋帶外框、偏移、超寬和不同 UI 比例。
  // 只對底部裁切執行，而且必須先走完輕量版型仍失敗才執行。
  function inkComponents(img, inkFn) {
    const mask = new Uint8Array(img.width * img.height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = inkFn(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]) ? 1 : 0;
    }
    const out = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      mask[i] = 0;
      const queue = [i];
      let minX = img.width, maxX = 0, minY = img.height, maxY = 0;
      for (let head = 0; head < queue.length; head++) {
        const index = queue[head], x = index % img.width, y = Math.floor(index / img.width);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let yy = Math.max(0, y - 1); yy <= Math.min(img.height - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(img.width - 1, x + 1); xx++) {
            const next = yy * img.width + xx;
            if (mask[next]) { mask[next] = 0; queue.push(next); }
          }
        }
      }
      out.push({ minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 });
    }
    return out;
  }

  function locateHudFromImage(img, offsetY = 0, stats = {}) {
    Object.assign(stats, { pairChecks: 0, expReads: 0, levelReads: 0 });
    const brackets = inkComponents(img, expBracketInk).filter(b =>
      b.height >= 5 && b.height <= 64 && b.width <= b.height * 0.65);
    const badges = inkComponents(img, lvBadgeInk).filter(b =>
      b.height >= 6 && b.height <= 96 && b.width >= 8 && b.width <= b.height * 6 && b.minX < img.width * 0.5)
      .sort((a, b) => b.maxY - a.maxY || a.minX - b.minX)
      .slice(0, HUD_SEARCH_LIMITS.levelReads);
    const out = [];
    if (!badges.length || brackets.length < 2) return out;
    // 依列與 x 建索引，不把整個底帶的所有色塊兩兩配對。
    const rows = new Map();
    for (const bracket of brackets) {
      if (!rows.has(bracket.minY)) rows.set(bracket.minY, []);
      rows.get(bracket.minY).push(bracket);
    }
    rows.forEach(row => row.sort((a, b) => a.minX - b.minX));
    const expCache = new Map();
    for (const badge of badges) {
      const padY = Math.max(2, Math.round(badge.height / 6));
      const padX = padY * 2;
      const lvRect = clampRect({ x: Math.max(0, badge.minX - padX), y: Math.max(0, badge.minY - padY),
        width: badge.width + padX * 2, height: badge.height + padY * 2 }, img.width, img.height);
      stats.levelReads++;
      const levels = readLevelCandidatesFromImage(slicePixels(img, lvRect), true);
      if (!levels.length) continue;
      // 先找徽章旁的實際文字行；同列時偏好 HUD 常見的畫面右半位置。
      const rank = b => Math.abs((badge.minY - b.minY) / b.height - 1) + Math.abs(b.minX / img.width - 0.65);
      const opens = brackets.filter(b => b.minX > badge.maxX && Math.abs(badge.minY - b.minY) <= b.height * 3)
        .sort((a, b) => rank(a) - rank(b)).slice(0, HUD_SEARCH_LIMITS.opensPerBadge);
      for (const open of opens) {
        const rowTolerance = Math.floor(open.height * 0.2);
        for (let y = open.minY - rowTolerance; y <= open.minY + rowTolerance; y++) {
          const row = rows.get(y);
          if (!row) continue;
          let lo = 0, hi = row.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (row[mid].minX <= open.maxX) lo = mid + 1;
            else hi = mid;
          }
          for (let i = lo; i < row.length && row[i].minX - open.maxX <= open.height * 8; i++) {
            if (stats.pairChecks >= HUD_SEARCH_LIMITS.pairs) return out;
            stats.pairChecks++;
            const close = row[i];
            if (Math.abs(open.height - close.height) > open.height * 0.2) continue;
            const pad = Math.max(2, Math.round(open.height / 4));
            const expRect = clampRect({ x: Math.max(0, open.minX - open.height * 12), y: Math.max(0, open.minY - pad),
              width: close.maxX - Math.max(0, open.minX - open.height * 12) + pad + 1,
              height: open.height + pad * 2 }, img.width, img.height);
            const key = [expRect.x, expRect.y, expRect.width, expRect.height].join(":");
            if (!expCache.has(key)) {
              if (stats.expReads >= HUD_SEARCH_LIMITS.expReads) return out;
              stats.expReads++;
              expCache.set(key, readExpFromImage(slicePixels(img, expRect)));
            }
            const parsed = expCache.get(key);
            if (!levels.some(l => crossCheck(l.level, parsed.exp, parsed.percent))) continue;
            out.push({ lv: { ...lvRect, y: lvRect.y + offsetY }, exp: { ...expRect, y: expRect.y + offsetY },
              wide: true, tag: "狀態列特徵定位" });
            if (out.length >= 12) return out;
          }
        }
      }
    }
    return out;
  }

  function cropCanvas(source, rect, scale) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, rect.width * scale);
    c.height = Math.max(1, rect.height * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, c.width, c.height);
    return c;
  }

  function cropImageData(source, rect) {
    const r = clampRect(rect, source.width, source.height);
    return source.getContext("2d", { willReadFrequently: true }).getImageData(r.x, r.y, r.width, r.height);
  }

  // 校準用：命中像素轉黑、其餘轉白＋補白邊（Tesseract 對貼邊文字辨識差）
  function thresholdCanvas(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const brightness = (r + g + b) / 3;
      const ink = brightness > 135 || (r > 140 && g > 55 && b < 80) || (g > 140 && r > 90);
      const v = ink ? 0 : 255;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const padded = document.createElement("canvas");
    const PAD = OCR_PADDING;
    padded.width = canvas.width + PAD * 2;
    padded.height = canvas.height + PAD * 2;
    const pctx = padded.getContext("2d");
    pctx.fillStyle = "#fff";
    pctx.fillRect(0, 0, padded.width, padded.height);
    pctx.drawImage(canvas, PAD, PAD);
    return padded;
  }

  // ---------- 圖樣比對核心 ----------
  function px(img, x, y) {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  // 垂直欄掃描分字：一欄裡有命中像素就算有字，連續空 closingGap 欄切一刀。
  // yBand 可以限定只看某個垂直範圍——EXP 字下面就是亮色經驗條，不限範圍
  // 的話經驗條會讓每一欄都亮、整行黏成一大塊（1920 實機就是這樣掛的）
  function glyphGroups(img, inkFn, closingGap, yBand) {
    const yStart = yBand ? yBand.y0 : Math.max(0, Math.floor(img.height * 0.12));
    const yEnd = yBand ? yBand.y1 + 1 : Math.min(img.height, Math.ceil(img.height * 0.92));
    const columns = [];
    for (let x = 0; x < img.width; x++) {
      let count = 0;
      for (let y = yStart; y < yEnd; y++) {
        const [r, g, b] = px(img, x, y);
        if (inkFn(r, g, b)) count++;
      }
      columns.push(count);
    }
    const groups = [];
    let start = null, gap = 0;
    const push = (x1, x2) => {
      const b = glyphBounds(img, x1, x2, inkFn, yBand);
      if (b) groups.push(b);
    };
    for (let x = 0; x < columns.length; x++) {
      if (columns[x] > 0) {
        if (start === null) start = x;
        gap = 0;
      } else if (start !== null) {
        gap++;
        if (gap >= closingGap) {
          push(start, x - gap);
          start = null;
          gap = 0;
        }
      }
    }
    if (start !== null) push(start, columns.length - 1);
    return groups;
  }

  function glyphBounds(img, x1, x2, inkFn, yBand) {
    const yFrom = yBand ? yBand.y0 : 0;
    const yTo = yBand ? yBand.y1 + 1 : img.height;
    let minX = x2, minY = img.height, maxX = x1, maxY = -1;
    for (let x = x1; x <= x2; x++) {
      for (let y = yFrom; y < yTo; y++) {
        const [r, g, b] = px(img, x, y);
        if (inkFn(r, g, b)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxY < minY) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  // 用綠色括號的像素定出「文字那一行」的垂直範圍——括號只存在文字行，
  // 經驗條、邊框線都影響不了它
  function bracketRowBand(img) {
    let minY = img.height, maxY = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r, g, b] = px(img, x, y);
        if (expBracketInk(r, g, b)) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          break;
        }
      }
    }
    if (maxY < minY) return null;
    return { y0: Math.max(0, minY - 1), y1: Math.min(img.height - 1, maxY + 1) };
  }

  // 把字形重採樣到字模的網格大小（點取樣：EXP 小字用）
  function sampleGlyph(img, b, inkFn, w, h) {
    let out = "";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.round(b.minX + ((x + 0.5) * b.width) / w - 0.5);
        const sy = Math.round(b.minY + ((y + 0.5) * b.height) / h - 0.5);
        const [r, g, bb] = px(img, Math.max(0, Math.min(sx, img.width - 1)), Math.max(0, Math.min(sy, img.height - 1)));
        out += inkFn(r, g, bb) ? "1" : "0";
      }
    }
    return out;
  }

  // 面積取樣（等級 7×7 用；格子內命中比例超過門檻算 1）
  function sampleGrid(img, b, inkFn, w, h, threshold) {
    let out = "";
    for (let y = 0; y < h; y++) {
      const y0 = Math.round(b.minY + (y * b.height) / h);
      const y1 = Math.max(y0 + 1, Math.round(b.minY + ((y + 1) * b.height) / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.round(b.minX + (x * b.width) / w);
        const x1 = Math.max(x0 + 1, Math.round(b.minX + ((x + 1) * b.width) / w));
        let total = 0, ink = 0;
        for (let sy = Math.max(0, y0); sy < Math.min(img.height, y1); sy++) {
          for (let sx = Math.max(0, x0); sx < Math.min(img.width, x1); sx++) {
            const [r, g, bb] = px(img, sx, sy);
            total++;
            if (inkFn(r, g, bb)) ink++;
          }
        }
        out += total > 0 && ink / total >= threshold ? "1" : "0";
      }
    }
    return out;
  }

  function bitDistance(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff / a.length;
  }

  // ---------- EXP 讀值（brackets 定界 → 逐字比對 5×7 字模） ----------
  function classifyNarrowOne(img, g) {
    if (g.width > 4 || g.height < 6) return null;
    let tallest = 0;
    for (let x = g.minX; x <= g.maxX; x++) {
      let count = 0;
      for (let y = g.minY; y <= g.maxY; y++) {
        const [r, gg, b] = px(img, x, y);
        if (expWhiteInk(r, gg, b)) count++;
      }
      tallest = Math.max(tallest, count);
    }
    return tallest >= Math.max(5, Math.round(g.height * 0.75)) ? { digit: "1", score: 0 } : null;
  }

  function classifyExpDigit(img, g) {
    const one = classifyNarrowOne(img, g);
    if (one) return one;
    let best = null;
    for (const [digit, tpls] of Object.entries(EXP_TPL)) {
      for (const t of tpls) {
        // 寬字形不可能是 1；面積重採樣到 1×7 時，任何每列都有墨的寬字
        // 都會退化成一條直線，若不先用長寬比排除會把 6／8 等誤判成 1。
        if (digit === "1" && g.width > g.height * 0.5) continue;
        // 點取樣對原生／整數倍點陣最準；Windows 125%／150%／175% 會把
        // 部分網格拉成 1px、部分 2px，單一取樣點可能剛好落在空白。再用
        // 不同門檻的面積取樣補判，取最貼近字模者，最後仍受 EXP 百分比
        // 交叉驗證約束，不會因放寬縮放容錯就直接收進錯值。
        const masks = [
          sampleGlyph(img, g, expWhiteInk, t.w, t.h),
          sampleGrid(img, g, expWhiteInk, t.w, t.h, 0.2),
          sampleGrid(img, g, expWhiteInk, t.w, t.h, 0.4),
        ];
        const score = Math.min(...masks.map((mask) => bitDistance(mask, t.bits)));
        if (!best || score < best.score) best = { digit, score };
      }
    }
    return best;
  }

  // 小數點的判斷基準要用「文字行本身的高度」（refH＝綠括號那行的高度），
  // 不能用裁切框的尺寸——校準給的鎖定框常比文字高很多，用框的比例判斷時，
  // 百分比裡最窄的數字「1」會整顆被誤認成小數點吃掉（11.43% 變 1.43%），
  // 交叉驗證就一直過不了。點跟 1 寬度可能一樣窄，唯一可靠的區別是高度
  function isLikelyDot(g, refH) {
    return g.height <= Math.max(2, Math.round(refH * 0.5));
  }

  function readDigits(img, groups, skipDots, refH, strict = false) {
    const out = [];
    for (let g of groups) {
      if (skipDots && isLikelyDot(g, refH || img.height)) continue;
      let m = classifyExpDigit(img, g);
      if (skipDots && (!m || m.score > 0.3)) {
        // 實機的小數點會緊貼小數第一位的「1」，欄切字把 .1 合為一團。
        // 原生偶然能以窄 1 救回，125% 起卻超過窄字寬度。只剝離左側
        // 位於文字下半部的短點，不放寬所有數字的寬度／相似度門檻。
        let left = g.minX;
        while (left < g.maxX) {
          const col = glyphBounds(img, left, left, expWhiteInk, { y0: g.minY, y1: g.maxY });
          if (col && (col.minY < g.minY + g.height * 0.45 || col.height > g.height * 0.4)) break;
          left++;
        }
        if (left > g.minX) g = glyphBounds(img, left, g.maxX, expWhiteInk, { y0: g.minY, y1: g.maxY }) || g;
        m = classifyExpDigit(img, g);
      }
      if (m && m.score <= 0.3) out.push(m.digit); // 分數太差的字不算（雜訊/標籤字母）
      else if (strict) return []; // EXP 不可漏掉某一位後，把殘缺數字當有效值。
    }
    return out;
  }

  // 讀「12345[6.78%]」：綠色括號當定界，括號左＝經驗值、括號內＝百分比。
  // 百分比不讀小數點——取數字末兩位當小數（點陣的小數點常黏在數字上，
  // 直接跳過它反而百分之百穩）
  function readExpFromImage(img) {
    // 先用綠括號定出文字那一行的垂直範圍，白色數字只在這個範圍內找——
    // 文字下面的亮色經驗條、框到的邊框線通通影響不到（1920 實機的教訓）
    const band = bracketRowBand(img);
    const brackets = glyphGroups(img, expBracketInk, 2, band)
      .filter((g) => g.width <= Math.max(6, Math.round(img.width * 0.04)));
    if (brackets.length < 2) return { exp: null, percent: null };
    const open = brackets[0];
    const close = brackets[brackets.length - 1];
    const whites = glyphGroups(img, expWhiteInk, 1, band);
    // 數字取「括號左邊、且彼此緊鄰」的那串——從括號往左收，遇到大縫隙就停。
    // 「EXP」標籤的白色字母在更左邊，跟數字之間有明顯空隙；不切掉的話，
    // 標籤字偶爾會被誤判成數字黏上去（實機讀出過 167278，真值 67278）
    const leftWhites = whites.filter((g) => g.maxX < open.minX).sort((a, b) => a.minX - b.minX);
    const kept = [];
    for (let i = leftWhites.length - 1; i >= 0; i--) {
      const g = leftWhites[i];
      if (kept.length) {
        const rightNeighbor = kept[kept.length - 1];
        const gapPx = rightNeighbor.minX - g.maxX;
        const h = Math.max(g.height, rightNeighbor.height);
        // 窄字「1」仍占固定字距，實機在 2 倍時會留下 8px 空隙；
        // 以字高同比放大分界，否則多位 EXP 會被截成後半段。
        if (gapPx > Math.max(5, Math.ceil(h * 0.75))) break; // 標籤與數字的分界
      }
      kept.push(g);
    }
    kept.reverse();
    const expDigits = readDigits(img, kept, false, 0, true);
    if (!expDigits.length || expDigits.length > 12) return { exp: null, percent: null };
    const exp = Number(expDigits.join(""));
    const pctDigits = readDigits(
      img,
      whites.filter((g) => g.minX > open.maxX && g.maxX < close.minX),
      true,
      band ? band.y1 - band.y0 + 1 : img.height
    ).join("");
    let percent = null;
    if (pctDigits.length >= 3) {
      percent = Number(pctDigits.slice(0, -2) + "." + pctDigits.slice(-2));
      if (percent > 100) percent = null;
    }
    return { exp: Number.isFinite(exp) ? exp : null, percent };
  }

  // ---------- 等級讀值（找橘色徽章 → 徽章內白色數字逐字比對 7×7 字模） ----------
  function levelDigitGroups(img, band) {
    if (!band) return [];
    const insetX = Math.max(2, Math.round(band.width * 0.07));
    const insetY = Math.max(1, Math.round(band.height * 0.12));
    const minX = Math.min(img.width - 1, band.minX + insetX);
    const maxX = Math.max(minX, band.maxX - insetX);
    const scanY0 = Math.min(img.height - 1, band.minY + insetY);
    const scanY1 = Math.max(scanY0, band.maxY - insetY);

    // 第一步：橫列直方圖找出數字真正佔據的「列帶」。真實遊戲的徽章有
    // 光澤亮紋（1px 的近白色橫線，橫貫整個徽章），不先排除的話每一欄都
    // 會有白點、欄切分直接失效。亮紋跟數字列帶之間有空列隔開，取「最高
    // 的連續有墨列段」＝數字本體（7×縮放 列高，遠高於 1px 的亮紋）
    const rowInk = [];
    for (let y = scanY0; y <= scanY1; y++) {
      let count = 0;
      for (let x = minX; x <= maxX; x++) {
        const [r, g, b] = px(img, x, y);
        if (lvWhiteInk(r, g, b)) count++;
      }
      rowInk.push(count);
    }
    let bandY0 = -1, bandY1 = -1, curStart = -1;
    for (let i = 0; i <= rowInk.length; i++) {
      if (i < rowInk.length && rowInk[i] > 0) {
        if (curStart < 0) curStart = i;
      } else if (curStart >= 0) {
        if (bandY0 < 0 || i - curStart > bandY1 - bandY0 + 1) {
          bandY0 = curStart;
          bandY1 = i - 1;
        }
        curStart = -1;
      }
    }
    if (bandY0 < 0) return [];
    const minY = scanY0 + bandY0;
    const maxY = scanY0 + bandY1;

    // 第二步：在乾淨的列帶內做欄切分。門檻固定 2 顆像素，不跟高度連動：
    // 「1」「7」的稀疏邊欄在字模裡只有 1 顆點，放大 N 倍後變 N 顆——
    // 2 倍以上自然過門檻、完整保留；間隙裡的抗鋸齒雜點永遠只有 1 顆，
    // 被門檻擋掉。門檻跟高度連動的版本會在放大時把稀疏邊欄又切掉，
    // 補回來還會讓取樣網格偏移、比對分數剛好爆線（實測踩過）。
    // 任一低於門檻的欄就切團——間隙可能只有 1 欄寬，等 2 欄才切會黏字
    const minColumnPixels = 2;
    const columns = [];
    for (let x = minX; x <= maxX; x++) {
      let count = 0;
      for (let y = minY; y <= maxY; y++) {
        const [r, g, b] = px(img, x, y);
        if (lvWhiteInk(r, g, b)) count++;
      }
      columns.push(count);
    }
    // 團寬至少 2 欄（擋雜訊欄），但「單欄且幾乎滿高」放行——1px 的細光棍
    // 「1」就是一整根滿高的單欄，跟只有 1-2 顆像素的雜訊欄分得開。不放行
    // 的話細光棍被整根丟掉，Lv.51 會漏字讀成 Lv.5（幸好有交叉驗證擋著，
    // 但等級就讀不到了）
    const bandH = maxY - minY + 1;
    const runs = [];
    let start = null;
    const flush = (end) => {
      if (end - start + 1 >= 2 || columns[start] >= bandH * 0.7) {
        runs.push({ x1: start, x2: end });
      }
      start = null;
    };
    for (let i = 0; i < columns.length; i++) {
      if (columns[i] >= minColumnPixels) {
        if (start === null) start = i;
      } else if (start !== null) {
        flush(i - 1);
      }
    }
    if (start !== null) flush(columns.length - 1);
    // 第三步：每團往「左」補回一欄有像素但低於門檻的邊欄——原生 1 倍時
    // 「1」「7」的稀疏左緣只有 1 顆點、會被門檻切掉，字形削窄到比對爆掉
    // （Lv.51 讀不到的根因）。只補左邊：所有數字字模的「右」緣至少 2 顆
    // 點不會被切，往右補只會把間隙雜點黏進字形、反而害比對偏移
    for (const run of runs) {
      if (run.x1 > 0 && columns[run.x1 - 1] > 0) run.x1--;
    }
    runs.forEach((run) => { run.x1 += minX; run.x2 += minX; });
    return runs
      .map((run) => {
        let gMinX = run.x2, gMinY = maxY, gMaxX = run.x1, gMaxY = minY, found = false;
        for (let x = run.x1; x <= run.x2; x++) {
          for (let y = minY; y <= maxY; y++) {
            const [r, g, b] = px(img, x, y);
            if (lvWhiteInk(r, g, b)) {
              found = true;
              if (x < gMinX) gMinX = x;
              if (x > gMaxX) gMaxX = x;
              if (y < gMinY) gMinY = y;
              if (y > gMaxY) gMaxY = y;
            }
          }
        }
        if (!found) return null;
        return { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY, width: gMaxX - gMinX + 1, height: gMaxY - gMinY + 1 };
      })
      .filter(Boolean);
  }

  // v7 使用的切字方式。v8 為了排除徽章亮紋改成上面的列帶法後，部分實機
  // 的亮紋／抗鋸齒排列反而會讓列帶抓錯，結果是整個等級都讀不到。兩種
  // 畫面沒有一套固定門檻能全吃，因此保留舊法作第二候選，最後再交給
  // EXP＋百分比交叉驗證決定哪一個等級是真的。
  function levelDigitGroupsLegacy(img, band) {
    if (!band) return [];
    const insetX = Math.max(2, Math.round(band.width * 0.07));
    const insetY = Math.max(1, Math.round(band.height * 0.12));
    const minX = Math.min(img.width - 1, band.minX + insetX);
    const maxX = Math.max(minX, band.maxX - insetX);
    const minY = Math.min(img.height - 1, band.minY + insetY);
    const maxY = Math.max(minY, band.maxY - insetY);
    const minColumnPixels = Math.max(1, Math.round((maxY - minY + 1) * 0.12));
    const columns = [];
    for (let x = minX; x <= maxX; x++) {
      let count = 0;
      for (let y = minY; y <= maxY; y++) {
        const [r, g, b] = px(img, x, y);
        if (lvWhiteInk(r, g, b)) count++;
      }
      columns.push(count);
    }
    const runs = [];
    let start = null, gap = 0, peak = 0;
    const flush = (end) => {
      if (start !== null && end - start + 1 >= 1 && peak >= minColumnPixels) {
        runs.push({ x1: minX + start, x2: minX + end });
      }
      start = null;
      gap = 0;
      peak = 0;
    };
    for (let i = 0; i < columns.length; i++) {
      if (columns[i] > 0) {
        if (start === null) start = i;
        peak = Math.max(peak, columns[i]);
        gap = 0;
      } else if (start !== null) {
        gap++;
        if (gap >= 2) flush(i - gap);
      }
    }
    if (start !== null) flush(columns.length - 1);
    return runs
      .map((run) => glyphBounds(img, run.x1, run.x2, lvWhiteInk, { y0: minY, y1: maxY }))
      .filter(Boolean);
  }

  function classifyLevelDigit(img, g) {
    let best = null;
    for (const [digit, tpls] of Object.entries(LV_TPL)) {
      for (const t of tpls) {
        if (digit === "1" && g.width > Math.max(4, Math.round(g.height * 0.55))) continue;
        const mask = sampleGrid(img, g, lvWhiteInk, t.w, t.h, 0.2);
        const score = bitDistance(mask, t.bits);
        if (!best || score < best.score) best = { digit, score };
      }
    }
    return best;
  }

  function readLevelCandidatesFromImage(img, wideMode) {
    // 找橘色徽章：窄框（等級色塊的緊框）時徽章在右半（左邊是 LV. 標籤）；
    // 寬框（同行左段）時不限位置，取面積最大的橘色群
    let badges = glyphGroups(img, lvBadgeInk, 2).filter((g) => g.height >= 5 && g.width >= 8);
    if (!wideMode) badges = badges.filter((g) => g.minX > img.width * 0.2);
    badges.sort((a, b) => b.width * b.height - a.width * a.height);
    if (!badges.length) return [];
    const strategies = [
      { name: "列帶", groups: levelDigitGroups(img, badges[0]) },
      { name: "傳統", groups: levelDigitGroupsLegacy(img, badges[0]) },
    ];
    const candidates = [];
    for (const strategy of strategies) {
      const digits = strategy.groups.sort((a, b) => a.minX - b.minX);
      if (!digits.length || digits.length > 3) continue;
      // 容錯上限 0.31：實機渲染跟字模的正常落差在 0.25~0.30，錯誤數字
      // 通常在 0.35 以上；最終仍須通過 EXP 百分比交叉驗證才會收樣。
      const matches = digits.map((g) => classifyLevelDigit(img, g));
      if (matches.some((m) => !m || m.score > 0.31)) continue;
      const level = Number(matches.map((m) => m.digit).join(""));
      if (!Number.isFinite(level) || level < 1 || level > 200) continue;
      const score = matches.reduce((sum, match) => sum + match.score, 0) / matches.length;
      if (!candidates.some((candidate) => candidate.level === level)) {
        candidates.push({ level, score, strategy: strategy.name });
      }
    }
    return candidates.sort((a, b) => a.score - b.score);
  }

  function readLevelFromImage(img, wideMode) {
    const candidates = readLevelCandidatesFromImage(img, wideMode);
    return candidates.length ? candidates[0].level : null;
  }

  // ---------- 校準：OCR 整條狀態列，用詞座標找出 EXP 的位置 ----------
  function ocrBoxToRect(bb, strip, scale, padX, extraRight) {
    return {
      x: strip.x + Math.round((bb.x0 - OCR_PADDING) / scale) - padX,
      y: strip.y + Math.round((bb.y0 - OCR_PADDING) / scale) - 3,
      width: Math.round((bb.x1 - bb.x0) / scale) + padX * 2 + extraRight,
      height: Math.round((bb.y1 - bb.y0) / scale) + 6,
    };
  }

  function calibrate(source, owner) {
    const SCALE = 3;
    const stripH = Math.max(28, Math.round(source.height * 0.055));
    const strip = { x: 0, y: source.height - stripH, width: source.width, height: stripH };
    const job = { finished: false, worker: null, sourceWidth: source.width, sourceHeight: source.height,
      strip, canvas: thresholdCanvas(cropCanvas(source, strip, SCALE)) };
    // 待載入的 worker 共用同一個 promise；取消只移除這份裁切與等待者，
    // 不會因反覆按重新定位建立一批仍在下載的 worker。
    return new Promise(resolve => {
      const finish = result => {
        if (job.finished) return;
        job.finished = true;
        clearTimeout(timeout);
        job.canvas = null;
        job.worker = null;
        if (workerUse === job) workerUse = null;
        if (owner.cancelCalibration === cancel) owner.cancelCalibration = null;
        resolve(result);
      };
      const cancel = () => {
        if (job.finished) return;
        if (workerUse === job) retireWorker(job.worker);
        finish(null);
      };
      owner.cancelCalibration = cancel;
      const timeout = setTimeout(cancel, CALIBRATION_TIMEOUT_MS);
      runCalibration(job).then(finish, () => {
        if (!job.finished) retireWorker(job.worker);
        finish(null);
      });
    });
  }

  async function runCalibration(job) {
    const worker = await ensureWorker();
    if (job.finished || !worker || workerUse) return null;
    job.worker = worker;
    workerUse = job;
    let words = [];
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789[]()%.,/LV",
      tessedit_pageseg_mode: "7",
    });
    if (job.finished) return null;
    const result = await worker.recognize(job.canvas);
    if (job.finished) return null;
    words = (result && result.data && result.data.words) || [];
    const { strip, sourceWidth, sourceHeight } = job;

    // EXP：數字＋括號＋% 三個元素都有的詞（數字被誤讀不影響定位）
    let expRect = null;
    for (const w of words) {
      const t = fixDigitConfusion(w.text || "");
      if (/[0-9]/.test(t) && /[\[(]/.test(t) && t.includes("%") && w.bbox) {
        expRect = ocrBoxToRect(w.bbox, strip, 3, 5, 16);
        break;
      }
    }
    if (!expRect) return null;
    // 寬得離譜＝OCR 把整條狀態列黏成一個詞（實機發生過），放棄用預設座標
    if (expRect.width > Math.max(320, sourceWidth * 0.25)) return null;

    // 等級：同一行左段（等級一定是這一行最左邊的橘色徽章；徽章偵測交給
    // 圖樣比對那層自己找，這裡只要框出範圍）
    const lvRect = {
      x: 2,
      y: expRect.y - Math.ceil(expRect.height * 0.8),
      width: Math.min(sourceWidth * 0.5, Math.max(40, expRect.x - 12)),
      height: expRect.height * 3,
    };
    return { lvRect: clampRect(lvRect, sourceWidth, sourceHeight), expRect: clampRect(expRect, sourceWidth, sourceHeight) };
  }

  // ---------- 驗證 ----------
  function expToNext(level) {
    const table = window.MapleData && window.MapleData.EXP_TABLE;
    if (!table || !level || level < 1 || level > table.length) return null;
    return table[level - 1] || null;
  }

  function crossCheck(level, exp, percent) {
    const need = expToNext(level);
    // 沒有對應 EXP 表的等級無法做百分比驗證，不能因為「有讀到一個數字」
    // 就直接放行；否則 Lv.100 被誤讀成資料表外等級時反而完全失去防呆。
    if (!need || !Number.isInteger(level)) return false;
    if (!Number.isSafeInteger(exp) || exp < 0 || exp > need) return false;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return false;
    // 畫面保留兩位小數；0.02 容納截斷／四捨五入，而不是容許整整 2% 的錯值。
    return Math.abs((exp / need) * 100 - percent) <= 0.02;
  }

  function acceptSample(level, exp, percent) {
    const now = Date.now();
    if (exp === null) return false;

    if (state.lastLevel !== null) {
      const dl = level - state.lastLevel;
      if (dl < 0 || dl > 1) { state.rejects++; return false; }
      if (dl === 0 && exp < state.lastExp) { state.rejects++; return false; }
      if (dl === 1) {
        const lastNeed = expToNext(state.lastLevel);
        state.gainedExp += (lastNeed ? Math.max(0, lastNeed - state.lastExp) : 0) + exp;
      } else {
        state.gainedExp += exp - state.lastExp;
      }
    } else {
      state.firstAt = now;
    }

    state.lastLevel = level;
    state.lastExp = exp;
    state.lastAt = now;
    state.level = level;
    state.exp = exp;
    state.percent = percent;
    state.samples++;
    // 記歷史樣本給「實測 5/10 分鐘視窗」用；只留最近 11 分鐘
    state.history.push({ t: now, gained: state.gainedExp });
    const cutoff = now - 11 * 60000;
    while (state.history.length && state.history[0].t < cutoff) state.history.shift();
    return true;
  }

  // 重新對齊錨點：連續多筆「交叉驗證有過、卻跟前一筆接不上」代表錨點本身
  // 錯了——切角色（經驗值看似倒退）、讀取中斷期間升了兩級以上、或先前收進
  // 一筆偏高的誤讀，這三種都會讓之後的真讀值永遠被防呆規則拒收。對齊時
  // 不知道中間發生什麼，所以這段獲得量直接放棄不計，之後從新錨點續算
  function reAnchor(level, exp, percent) {
    const now = Date.now();
    if (!state.firstAt) state.firstAt = now;
    state.lastLevel = level;
    state.lastExp = exp;
    state.lastAt = now;
    state.level = level;
    state.exp = exp;
    state.percent = percent;
    state.samples++;
    state.contRejects = 0;
    state.history.push({ t: now, gained: state.gainedExp });
    const cutoff = now - 11 * 60000;
    while (state.history.length && state.history[0].t < cutoff) state.history.shift();
  }

  // ---------- 主循環 ----------
  async function tick(sourceOverride) {
    if (state.tickOwner) return;
    const generation = state.generation;
    const owner = { generation, cancelCalibration: null };
    state.tickOwner = owner;
    try {
      let source = sourceOverride;
      if (!source) {
        const v = state.video;
        if (!v || !v.videoWidth) return;
        source = document.createElement("canvas");
        source.width = v.videoWidth;
        source.height = v.videoHeight;
        source.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0);
      }
      if (state.lockSize !== source.width + "x" + source.height) {
        state.lvRectLock = null;
        state.expRectLock = null;
        state.calibrateAttempts = 0;
        state.lockSize = source.width + "x" + source.height;
      }

      // 所有已知版型都試（圖樣比對是毫秒級）：校準框優先，其次依目前
      // 擷取尺寸／長寬比排序。哪組通過 EXP 百分比交叉驗證就鎖定；後續每秒
      // 只需先試鎖定框，未知解析度也不必每次依賴 Tesseract。
      const candidates = [];
      const candidateSignatures = new Set();
      const addCandidate = (candidate) => {
        const signature = [candidate.lv.x, candidate.lv.y, candidate.lv.width, candidate.lv.height,
          candidate.exp.x, candidate.exp.y, candidate.exp.width, candidate.exp.height].join(":");
        if (candidateSignatures.has(signature)) return;
        candidateSignatures.add(signature);
        candidates.push(candidate);
      };
      if (state.expRectLock) {
        addCandidate({ lv: state.lvRectLock, exp: state.expRectLock, wide: state.lvWide, tag: "已定位" });
      }
      modernReadCandidates(source.width, source.height).forEach(addCandidate);
      presetReadCandidates(source.width, source.height).forEach(addCandidate);

      let level = null;
      let parsed = { exp: null, percent: null };
      let used = candidates[0];
      let bestPartialScore = -1;
      let pairComplete = false;
      state.lastTickDebug = [];
      for (let ci = 0; ci < candidates.length; ci++) {
        const c = candidates[ci];
        // 不加邊距：跟除錯頁走完全相同的路（邊距曾兩度造成「除錯頁讀得到、
        // 實際讀取失敗」的分歧——多框進來的經驗條/邊框線會干擾切字）
        const levelCandidates = readLevelCandidatesFromImage(cropImageData(source, c.lv), c.wide);
        const p = readExpFromImage(cropImageData(source, c.exp));
        const verified = levelCandidates.find((candidate) => crossCheck(candidate.level, p.exp, p.percent));
        const lvl = verified ? verified.level : (levelCandidates[0] && levelCandidates[0].level) || null;
        state.lastTickDebug.push({
          tag: c.tag,
          lvRect: c.lv,
          expRect: c.exp,
          wide: c.wide,
          lvl,
          levelCandidates,
          exp: p.exp,
          pct: p.percent,
        });
        if (verified) {
          level = verified.level;
          parsed = p;
          used = c;
          pairComplete = true;
          // 成功的那組轉正為鎖定，下一輪直接命中
          state.lvRectLock = c.lv;
          state.expRectLock = c.exp;
          state.lvWide = c.wide;
          state.lockMisses = 0;
          break;
        }
        // 沒全過時保留「同一版型」裡資訊最完整的一組。不能從 A 框拿
        // 等級、B 框拿 EXP 再拼起來驗證；版型變多後這種混搭更容易偶然
        // 對上百分比，既會收錯值，也會誤以為已定位而不再啟動校準。
        const partialScore = (lvl !== null ? 2 : 0) + (p.exp !== null ? 2 : 0) + (p.percent !== null ? 1 : 0);
        if (partialScore > bestPartialScore) {
          bestPartialScore = partialScore;
          level = lvl;
          parsed = p;
          used = c;
        }
        if (ci === candidates.length - 1 && !pairComplete && !c.adaptive) {
          const stripHeight = Math.min(source.height, Math.max(100, Math.round(source.height * 0.15)));
          const offsetY = source.height - stripHeight;
          const strip = cropImageData(source, { x: 0, y: offsetY, width: source.width, height: stripHeight });
          locateHudFromImage(strip, offsetY).forEach(candidate => addCandidate({ ...candidate, adaptive: true }));
        }
      }
      state.presetKey = source.width + "x" + source.height + "・" + used.tag;

      state.crops = {
        lv: cropCanvas(source, clampRect(used.lv, source.width, source.height), 2).toDataURL(),
        exp: cropCanvas(source, clampRect(used.exp, source.width, source.height), 2).toDataURL(),
      };

      // 所有候選框都讀不到時才動用校準（OCR 整條狀態列找位置）——
      // 預設座標就能用的人（全螢幕玩家）連 Tesseract 都不用載
      if (!pairComplete && !state.expRectLock && state.calibrateAttempts < 2) {
        state.calibrateAttempts++;
        setStatus("預設座標讀不到，改用整條狀態列定位中…（第一次要載辨識元件）");
        const found = await calibrate(source, owner);
        if (generation !== state.generation) return;
        if (found) {
          state.expRectLock = found.expRect;
          state.lvRectLock = found.lvRect;
          state.lvWide = true; // 校準給的等級框是同行左段（寬版）
          state.lockMisses = 0;
        }
      }

      if (state.expRectLock && !pairComplete) {
        state.lockMisses = (state.lockMisses || 0) + 1;
        if (state.lockMisses >= 12) {
          state.lvRectLock = null;
          state.expRectLock = null;
          state.calibrateAttempts = 0;
        }
      }

      if (!level) {
        setStatus("還沒讀到等級（擷取 " + state.presetKey + "）——看預覽圖有沒有框到橘色等級徽章");
        return;
      }

      // 每筆都需交叉驗證。穩定的錯框可能每秒讀到同一個錯誤值，不能以
      // 重複兩次或增量不大取代百分比驗證，否則會建立錯誤錨點。
      const need = expToNext(level);
      const admit = pairComplete && crossCheck(level, parsed.exp, parsed.percent);

      if (!admit) {
        state.rejects++;
        const expect = need && parsed.exp !== null ? ((parsed.exp / need) * 100).toFixed(2) : "?";
        setStatus("讀到 Lv." + level + "・EXP=" + parsed.exp + "・%=" + parsed.percent +
          "（表算 " + expect + "%），驗證不符已略過");
        return;
      }
      if (acceptSample(level, parsed.exp, parsed.percent)) {
        state.contRejects = 0;
        setStatus("讀取中（每秒更新）");
      } else if (
        ++state.contRejects >= 10 &&
        crossCheck(level, parsed.exp, parsed.percent)
      ) {
        reAnchor(level, parsed.exp, parsed.percent);
        setStatus("讀值持續對不上先前紀錄，已重新對齊（切角色或中斷後跳級會這樣；累計不歸零，但對不上那段不計入）");
      } else {
        setStatus("這筆讀值異常已略過（等級跳動或經驗倒退，屬正常防呆）");
      }
    } finally {
      // 舊校準的 finally 可以晚於新 tick；只有持有者才能釋放鎖與通知 UI。
      if (state.tickOwner === owner) {
        state.tickOwner = null;
        emit();
      }
    }
  }

  // ---------- 開關 ----------
  async function start(view) {
    if (state.running) return true;
    if (!isSupported()) {
      setStatus("這個瀏覽器不支援畫面分享（手機都不支援，請用電腦版 Chrome/Edge）");
      return false;
    }
    const w = view || window;
    let stream;
    try {
      const getMedia = w.navigator && w.navigator.mediaDevices && w.navigator.mediaDevices.getDisplayMedia
        ? w.navigator.mediaDevices.getDisplayMedia.bind(w.navigator.mediaDevices)
        : navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      stream = await getMedia({
        video: { frameRate: { ideal: 2, max: 5 }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
    } catch {
      setStatus("沒有取得畫面分享（可能按了取消）");
      return false;
    }
    state.stream = stream;
    state.video = document.createElement("video");
    state.video.muted = true;
    state.video.srcObject = stream;
    try { await state.video.play(); } catch {}
    stream.getVideoTracks().forEach((t) => t.addEventListener("ended", stop));
    state.running = true;
    resetCounters();
    // 每次重新開始都是一個新的擷取來源；不能沿用上一輪已失敗的座標、
    // 校準次數或 CDN 載入結果，否則使用者按停止再開始仍會永久卡住。
    resetPositioning(true);
    setStatus("已連接畫面分享，開始讀取…");
    state.timer = setInterval(() => { tick(); }, INTERVAL_MS);
    tick();
    return true;
  }

  function resetCounters() {
    state.level = null; state.exp = null; state.percent = null;
    state.firstAt = 0; state.lastAt = 0;
    state.lastLevel = null; state.lastExp = null;
    state.gainedExp = 0;
    state.samples = 0; state.rejects = 0;
    state.history = [];
    state.contRejects = 0;
  }

  function resetPositioning(retryCalibration) {
    invalidateTick();
    state.lvRectLock = null;
    state.expRectLock = null;
    state.lockSize = "";
    state.lockMisses = 0;
    state.calibrateAttempts = 0;
    state.lvWide = false;
    state.presetKey = "";
    state.crops = null;
    state.lastTickDebug = [];
    // CDN 或網路瞬斷不該讓這個分頁永久放棄校準；使用者重新開始／重新定位
    // 時允許再試一次。成功建立的 worker 則繼續沿用，不重複下載。
    if (retryCalibration && state.tesseractFailed) {
      state.tesseractFailed = false;
      workerPromise = null;
    }
  }

  function recalibrate() {
    resetPositioning(true);
    setStatus(state.running
      ? "已清除舊定位，下一秒會重新嘗試所有解析度版型"
      : "定位已重置，按開始後會重新偵測");
  }

  function stop() {
    invalidateTick();
    clearInterval(state.timer);
    state.timer = null;
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    if (state.video) {
      state.video.srcObject = null;
      state.video = null;
    }
    if (state.running) {
      state.running = false;
      setStatus("已停止讀取");
    }
    emit();
  }

  // 除錯匯出：把當下畫面、裁切框、過濾視角、圖樣比對結果攤在新分頁
  async function debugDump() {
    const v = state.video;
    if (!v || !v.videoWidth) {
      setStatus("要先按「開始」連上畫面分享，才能匯出除錯資料");
      return;
    }
    const source = document.createElement("canvas");
    source.width = v.videoWidth;
    source.height = v.videoHeight;
    source.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0);

    const fallback = presetReadCandidates(source.width, source.height)[0];
    const lvRect = clampRect(state.lvRectLock || fallback.lv, source.width, source.height);
    const expRect = clampRect(state.expRectLock || fallback.exp, source.width, source.height);
    const lvWide = state.lvRectLock ? state.lvWide : false;

    const filterView = (rect, inkFn) => {
      const c = cropCanvas(source, rect, 4);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const image = ctx.getImageData(0, 0, c.width, c.height);
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        const ink = inkFn(d[i], d[i + 1], d[i + 2]);
        const val = ink ? 0 : 255;
        d[i] = val; d[i + 1] = val; d[i + 2] = val; d[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      return c.toDataURL();
    };

    const parsed = readExpFromImage(cropImageData(source, expRect));
    const levelCandidates = readLevelCandidatesFromImage(cropImageData(source, lvRect), lvWide);
    const verified = levelCandidates.find((candidate) => crossCheck(candidate.level, parsed.exp, parsed.percent));
    const level = verified ? verified.level : (levelCandidates[0] && levelCandidates[0].level) || null;

    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const w = window.open("", "_blank");
    if (!w) {
      setStatus("彈出視窗被瀏覽器擋住了，請允許彈出視窗後再按一次");
      return;
    }
    w.document.write(
      '<meta charset="utf-8"><title>自動測速除錯資料</title>' +
      '<body style="font-family:sans-serif;background:#fff;color:#111;padding:16px;max-width:900px">' +
      "<h2>自動測速除錯資料（請整頁截圖回報）</h2>" +
      "<p>擷取尺寸：" + source.width + "x" + source.height +
      "・模式：" + esc(state.presetKey) +
      "・等級框：" + JSON.stringify(lvRect) +
      "・EXP框：" + JSON.stringify(expRect) + "</p>" +
      "<p><b>圖樣比對結果：</b>等級=" + esc(level) + "　候選=" + esc(JSON.stringify(levelCandidates)) +
      "　EXP=" + esc(parsed.exp) + "　百分比=" + esc(parsed.percent) + "</p>" +
      "<details><summary>本輪全部候選版型結果</summary><pre style=\"white-space:pre-wrap\">" +
      esc(JSON.stringify(state.lastTickDebug || [], null, 2)) + "</pre></details>" +
      "<h3>等級框</h3>" +
      '<p>原圖：<br><img src="' + cropCanvas(source, lvRect, 4).toDataURL() + '" style="max-width:100%;border:1px solid #999"></p>' +
      '<p>橘色徽章視角：<br><img src="' + filterView(lvRect, lvBadgeInk) + '" style="max-width:100%;border:1px solid #999"></p>' +
      '<p>白色數字視角：<br><img src="' + filterView(lvRect, lvWhiteInk) + '" style="max-width:100%;border:1px solid #999"></p>' +
      "<h3>EXP 框</h3>" +
      '<p>原圖：<br><img src="' + cropCanvas(source, expRect, 4).toDataURL() + '" style="max-width:100%;border:1px solid #999"></p>' +
      '<p>白色數字視角：<br><img src="' + filterView(expRect, expWhiteInk) + '" style="max-width:100%;border:1px solid #999"></p>' +
      '<p>綠色括號視角：<br><img src="' + filterView(expRect, expBracketInk) + '" style="max-width:100%;border:1px solid #999"></p>' +
      "</body>"
    );
    w.document.close();
  }

  window.MapleExpOcr = {
    isSupported,
    start,
    stop,
    getState,
    debugDump,
    recalibrate,
    onUpdate(cb) { listeners.push(cb); },
    running() { return state.running; },
    _tickWith(canvas) { return tick(canvas); },
    _test: {
      readLevelCandidatesFromImage,
      readLevelFromImage,
      readExpFromImage,
      crossCheck,
      expToNext,
      acceptSample,
      windowGain,
      presetChoices,
      pickPreset,
      presetReadCandidates,
      modernReadCandidates,
      locateHudFromImage,
      HUD_SEARCH_LIMITS,
      CALIBRATION_TIMEOUT_MS,
      slicePixels,
      ocrBoxToRect,
      clampRect,
    },
    // 內部探針：把 EXP 框每個字形群的分類明細倒出來（除錯用）
    _probeExp(source, rect) {
      const img = cropImageData(source, rect);
      const brackets = glyphGroups(img, expBracketInk, 2).filter((g) => g.width <= Math.max(6, Math.round(img.width * 0.04)));
      const whites = glyphGroups(img, expWhiteInk, 1);
      return {
        engineResult: readExpFromImage(cropImageData(source, rect)),
        brackets: brackets.map((g) => ({ x: g.minX + "-" + g.maxX, w: g.width })),
        whites: whites.map((g) => {
          const m = classifyExpDigit(img, g);
          return { x: g.minX + "-" + g.maxX, w: g.width, h: g.height, digit: m && m.digit, score: m && +m.score.toFixed(3) };
        }),
      };
    },
    _reset() {
      resetCounters();
      resetPositioning(true);
    },
  };
})();
