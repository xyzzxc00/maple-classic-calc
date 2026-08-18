/**
 * expocr.js — 螢幕讀取 EXP（實驗性）
 * -----------------------------------------------------------------
 * 用瀏覽器的 getDisplayMedia 請玩家分享遊戲視窗，每秒截一格畫面，
 * 讀出等級與 EXP，自動累計獲得經驗、換算速率。
 *
 * 辨識架構（實測演化到第三版的結果）：
 * - 定位：校準時把整條狀態列丟給 Tesseract OCR（只在這一步用），
 *   利用它會回報「每個詞的座標」，找到「數字[百分比%]」樣式的詞
 *   （＝EXP）鎖定位置；等級用同一行左段。任何解析度都行。
 * - 讀值：不用 OCR——遊戲數字是固定點陣字形（EXP 5×7、等級徽章 7×7），
 *   直接用像素圖樣比對（移植自另一位玩家工具作者的公開實作，同一款
 *   遊戲實機驗證過的字模）。比 OCR 快百倍且不會有 3↔2、小數點被吃
 *   這類字形誤讀；百分比從設計上就不讀小數點（取數字末兩位當小數）。
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
    "1": [{ w: 3, h: 7, bits: "011111011011011011011" }],
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
    ticking: false,
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
    // 累計
    firstAt: 0,
    lastAt: 0,
    lastLevel: null,
    lastExp: null,
    gainedExp: 0,
    samples: 0,
    rejects: 0,
    history: [], // 每筆收下的樣本 {t, gained}——算「實測 5/10 分鐘視窗」用
    pendingFirst: null, // 第一筆錨定備援：上一輪的候選讀值
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
  function ensureWorker() {
    if (state.tesseractFailed) return Promise.resolve(null);
    if (!workerPromise) {
      setStatus("辨識元件載入中…（第一次要下載，約幾 MB）");
      workerPromise = (window.Tesseract ? Promise.resolve() : loadScript(TESSERACT_URL))
        .then(() => window.Tesseract.createWorker("eng"))
        .catch(() => {
          state.tesseractFailed = true;
          return null;
        });
    }
    return workerPromise;
  }

  function fixDigitConfusion(text) {
    return String(text)
      .replace(/[OoQD]/g, "0").replace(/[Il|]/g, "1").replace(/[Zz]/g, "2")
      .replace(/[Aa]/g, "4").replace(/[Ss]/g, "5").replace(/[Gb]/g, "6")
      .replace(/[Tt]/g, "7").replace(/[B]/g, "8").replace(/[g]/g, "9");
  }

  // ---------- 裁切工具 ----------
  function pickPreset(w, h) {
    const key = w + "x" + h;
    if (PRESETS[key]) return { key, preset: PRESETS[key] };
    let best = null;
    for (const k of Object.keys(PRESETS)) {
      const kw = parseInt(k, 10);
      if (!best || Math.abs(kw - w) < Math.abs(parseInt(best, 10) - w)) best = k;
    }
    return { key: best + "（近似）", preset: PRESETS[best] };
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

  function clampRect(rect, w, h) {
    const x = Math.max(0, Math.min(rect.x, w - 1));
    const y = Math.max(0, Math.min(rect.y, h - 1));
    return {
      x,
      y,
      width: Math.max(1, Math.min(rect.width, w - x)),
      height: Math.max(1, Math.min(rect.height, h - y)),
    };
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
    const PAD = 16;
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
        const mask = sampleGlyph(img, g, expWhiteInk, t.w, t.h);
        const score = bitDistance(mask, t.bits);
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

  function readDigits(img, groups, skipDots, refH) {
    const out = [];
    for (const g of groups) {
      if (skipDots && isLikelyDot(g, refH || img.height)) continue;
      const m = classifyExpDigit(img, g);
      if (m && m.score <= 0.3) out.push(m.digit); // 分數太差的字不算（雜訊/標籤字母）
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
        if (gapPx > Math.max(5, Math.round(h * 0.45))) break; // 標籤與數字的分界
      }
      kept.push(g);
    }
    kept.reverse();
    const expDigits = readDigits(img, kept, false).slice(-12);
    if (!expDigits.length) return { exp: null, percent: null };
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
    // 分欄用「有白像素就算」，切完再要求整團至少有一根實心欄（≥minColumnPixels）。
    // 以前是逐欄先過雜訊門檻，會把「1」最左欄那顆單獨的白點砍掉、字形削窄，
    // 小字（原生 1 倍）時比對分數直接爆掉——等級尾數是 1 的玩家整個讀不到
    const runs = [];
    let start = null, gap = 0, peak = 0;
    const flush = (end) => {
      if (end - start + 1 >= 2 && peak >= minColumnPixels) {
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

  function readLevelFromImage(img, wideMode) {
    // 找橘色徽章：窄框（等級色塊的緊框）時徽章在右半（左邊是 LV. 標籤）；
    // 寬框（同行左段）時不限位置，取面積最大的橘色群
    let badges = glyphGroups(img, lvBadgeInk, 2).filter((g) => g.height >= 5 && g.width >= 8);
    if (!wideMode) badges = badges.filter((g) => g.minX > img.width * 0.2);
    badges.sort((a, b) => b.width * b.height - a.width * a.height);
    if (!badges.length) return null;
    const digits = levelDigitGroups(img, badges[0]).sort((a, b) => a.minX - b.minX);
    if (!digits.length || digits.length > 3) return null;
    const matches = digits.map((g) => classifyLevelDigit(img, g));
    if (matches.some((m) => !m || m.score > 0.28)) return null;
    const level = Number(matches.map((m) => m.digit).join(""));
    if (!Number.isFinite(level) || level < 1 || level > 200) return null;
    return level;
  }

  // ---------- 校準：OCR 整條狀態列，用詞座標找出 EXP 的位置 ----------
  async function calibrate(source) {
    const worker = await ensureWorker();
    if (!worker) return null;
    const SCALE = 3;
    const stripH = Math.max(28, Math.round(source.height * 0.055));
    const strip = { x: 0, y: source.height - stripH, width: source.width, height: stripH };
    const canvas = thresholdCanvas(cropCanvas(source, strip, SCALE));
    let words = [];
    try {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789[]()%.,/LV",
        tessedit_pageseg_mode: "7",
      });
      const result = await worker.recognize(canvas);
      words = (result && result.data && result.data.words) || [];
    } catch {
      return null;
    }
    const toRect = (bb, padX, extraRight) => ({
      x: strip.x + Math.round(bb.x0 / SCALE) - padX,
      y: strip.y + Math.round(bb.y0 / SCALE) - 3,
      width: Math.round((bb.x1 - bb.x0) / SCALE) + padX * 2 + extraRight,
      height: Math.round((bb.y1 - bb.y0) / SCALE) + 6,
    });

    // EXP：數字＋括號＋% 三個元素都有的詞（數字被誤讀不影響定位）
    let expRect = null;
    for (const w of words) {
      const t = fixDigitConfusion(w.text || "");
      if (/[0-9]/.test(t) && /[\[(]/.test(t) && t.includes("%") && w.bbox) {
        expRect = toRect(w.bbox, 5, 16);
        break;
      }
    }
    if (!expRect) return null;
    // 寬得離譜＝OCR 把整條狀態列黏成一個詞（實機發生過），放棄用預設座標
    if (expRect.width > 320) return null;

    // 等級：同一行左段（等級一定是這一行最左邊的橘色徽章；徽章偵測交給
    // 圖樣比對那層自己找，這裡只要框出範圍）
    const lvRect = {
      x: 2,
      y: expRect.y - 6,
      width: Math.max(40, expRect.x - 12),
      height: expRect.height + 12,
    };
    return { lvRect, expRect };
  }

  // ---------- 驗證 ----------
  function expToNext(level) {
    const table = window.MapleData && window.MapleData.EXP_TABLE;
    if (!table || !level || level < 1 || level > table.length) return null;
    return table[level - 1] || null;
  }

  function crossCheck(level, exp, percent) {
    const need = expToNext(level);
    if (!need) return exp !== null;
    if (exp === null || percent === null) return false;
    if (exp > need) return false;
    return Math.abs((exp / need) * 100 - percent) <= 2;
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
    if (state.ticking) return;
    state.ticking = true;
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

      const picked = pickPreset(source.width, source.height);
      // 兩組候選框都試（圖樣比對是毫秒級，多讀一組沒成本）：
      // 校準框優先，預設座標當備援——校準偶爾會「假成功」給出歪的框，
      // 哪組讀出來能通過交叉驗證就用哪組，並把它轉正為鎖定（自我修復）
      const candidates = [];
      if (state.expRectLock) {
        candidates.push({ lv: state.lvRectLock, exp: state.expRectLock, wide: state.lvWide, tag: "已定位" });
      }
      candidates.push({
        lv: rectFor(picked.preset, "lv", source.width, source.height),
        exp: rectFor(picked.preset, "exp", source.width, source.height),
        wide: false,
        tag: "預設座標",
      });

      let level = null;
      let parsed = { exp: null, percent: null };
      let used = candidates[0];
      state.lastTickDebug = [];
      for (const c of candidates) {
        // 不加邊距：跟除錯頁走完全相同的路（邊距曾兩度造成「除錯頁讀得到、
        // 實際讀取失敗」的分歧——多框進來的經驗條/邊框線會干擾切字）
        const lvl = readLevelFromImage(cropImageData(source, c.lv), c.wide);
        const p = readExpFromImage(cropImageData(source, c.exp));
        state.lastTickDebug.push({ tag: c.tag, lvRect: c.lv, expRect: c.exp, wide: c.wide, lvl, exp: p.exp, pct: p.percent });
        if (lvl && crossCheck(lvl, p.exp, p.percent)) {
          level = lvl;
          parsed = p;
          used = c;
          // 成功的那組轉正為鎖定，下一輪直接命中
          state.lvRectLock = c.lv;
          state.expRectLock = c.exp;
          state.lvWide = c.wide;
          state.lockMisses = 0;
          break;
        }
        // 沒全過的話留讀得比較多的那組當顯示與預覽
        if (level === null && lvl) { level = lvl; used = c; }
        if (parsed.exp === null && p.exp !== null) { parsed = p; used = c; }
      }
      state.presetKey = source.width + "x" + source.height + "・" + used.tag;

      state.crops = {
        lv: cropCanvas(source, clampRect(used.lv, source.width, source.height), 2).toDataURL(),
        exp: cropCanvas(source, clampRect(used.exp, source.width, source.height), 2).toDataURL(),
      };

      // 兩組候選框都讀不到時才動用校準（OCR 整條狀態列找位置）——
      // 預設座標就能用的人（全螢幕玩家）連 Tesseract 都不用載
      if ((parsed.exp === null || level === null) && !state.expRectLock && state.calibrateAttempts < 2) {
        state.calibrateAttempts++;
        setStatus("預設座標讀不到，改用整條狀態列定位中…（第一次要載辨識元件）");
        const found = await calibrate(source);
        if (found) {
          state.expRectLock = found.expRect;
          state.lvRectLock = found.lvRect;
          state.lvWide = true; // 校準給的等級框是同行左段（寬版）
          state.lockMisses = 0;
        }
      }

      if (state.expRectLock && (parsed.exp === null || level === null)) {
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

      // 收樣判定：百分比交叉驗證為主；百分比讀不好（例如 11.43% 開頭
      // 連續兩個 1 是最窄字形、容易讀壞）時走備援——
      // a) 續讀：跟上一筆同等級、往前走、增量合理（<10% 升級需求）就收
      // b) 第一筆錨定備援：連續兩輪讀到幾乎相同的值才收（防單輪誤讀）
      const need = expToNext(level);
      let admit = crossCheck(level, parsed.exp, parsed.percent);
      if (!admit && parsed.exp !== null && need && parsed.exp <= need) {
        if (state.lastLevel === level && parsed.exp >= state.lastExp && parsed.exp - state.lastExp <= need * 0.1) {
          admit = true;
        } else if (state.lastLevel === null) {
          if (state.pendingFirst && state.pendingFirst.level === level &&
              Math.abs(state.pendingFirst.exp - parsed.exp) <= need * 0.02) {
            admit = true;
          } else {
            state.pendingFirst = { level, exp: parsed.exp };
          }
        }
      }

      if (!admit) {
        state.rejects++;
        const expect = need && parsed.exp !== null ? ((parsed.exp / need) * 100).toFixed(2) : "?";
        setStatus("讀到 Lv." + level + "・EXP=" + parsed.exp + "・%=" + parsed.percent +
          "（表算 " + expect + "%），驗證不符已略過");
        return;
      }
      if (acceptSample(level, parsed.exp, parsed.percent)) {
        state.pendingFirst = null;
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
      state.ticking = false;
      emit();
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
    state.pendingFirst = null;
    state.contRejects = 0;
  }

  function stop() {
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

    const picked = pickPreset(source.width, source.height);
    const lvRect = clampRect(state.lvRectLock || rectFor(picked.preset, "lv", source.width, source.height), source.width, source.height);
    const expRect = clampRect(state.expRectLock || rectFor(picked.preset, "exp", source.width, source.height), source.width, source.height);
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

    const level = readLevelFromImage(cropImageData(source, lvRect), lvWide);
    const parsed = readExpFromImage(cropImageData(source, expRect));

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
      "<p><b>圖樣比對結果：</b>等級=" + esc(level) + "　EXP=" + esc(parsed.exp) + "　百分比=" + esc(parsed.percent) + "</p>" +
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
    onUpdate(cb) { listeners.push(cb); },
    running() { return state.running; },
    _tickWith(canvas) { return tick(canvas); },
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
      state.lvRectLock = null;
      state.expRectLock = null;
      state.lockSize = "";
      state.lockMisses = 0;
      state.calibrateAttempts = 0;
      state.lvWide = false;
    },
  };
})();
