"use strict";

// 自動測速的純演算法回歸測試；不需要 npm 套件，直接 `node tools/test_expocr.js`。
// 測 EXP 表涵蓋的全部等級、1～4 倍與常見系統縮放、徽章亮紋／窄版 1、
// EXP 數字與百分比、720p～4K／超寬裁切矩陣、同級累計、升級跨級、
// 倒退與跳級防呆、5／10 分鐘視窗。

const assert = require("node:assert/strict");

global.window = global;
require("../js/data.js");
require("../js/expocr.js");

const engine = global.MapleExpOcr;
const test = engine && engine._test;
assert.ok(test, "MapleExpOcr 測試介面不存在");
assert.equal(typeof engine.recalibrate, "function", "缺少手動重新定位介面");
const MAX_LEVEL = global.MapleData.EXP_TABLE.length;

const LV_MASKS = {
  "0": { w: 7, bits: "0111110110001111000111100011110001111000110111110" },
  "1": { w: 3, bits: "011111011011011011011" },
  "2": { w: 7, bits: "0111110110001100000110011110011000011000001111111" },
  "3": { w: 7, bits: "0111110110001100000110011110000001111000110111110" },
  "4": { w: 7, bits: "0001110001111001101101100110111111100001100000110" },
  "5": { w: 7, bits: "1111111110000011000000111110000001111000110111110" },
  "6": { w: 7, bits: "0111110110001111000001111110110001111000110111110" },
  "7": { w: 7, bits: "1111111000001100001100001100000110000110000011000" },
  "8": { w: 7, bits: "0111110110001111000110111110110001111000110111110" },
  "9": { w: 7, bits: "0111110110001111000110111111000001111000110111110" },
};

const EXP_MASKS = {
  "0": { w: 5, bits: "01110100011000110001100011000101110" },
  "1": { w: 2, bits: "11111101010101" },
  "2": { w: 5, bits: "01110100010000100010001000100011111" },
  "3": { w: 5, bits: "01110100010000100110000011000101110" },
  "4": { w: 5, bits: "00010001100101010010111110001000010" },
  "5": { w: 5, bits: "11111100001000001110000011000101110" },
  "6": { w: 5, bits: "01110100011000011110100011000101110" },
  "7": { w: 5, bits: "11111000010000100001000100010000100" },
  "8": { w: 5, bits: "01110100011000101110100011000101110" },
  "9": { w: 5, bits: "01110100011000101111000011000101110" },
};

function makeImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

function pixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (y * image.width + x) * 4;
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = 255;
}

function fill(image, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) pixel(image, xx, yy, color);
  }
}

function resizeNearest(image, factor) {
  const resized = makeImage(Math.round(image.width * factor), Math.round(image.height * factor));
  for (let y = 0; y < resized.height; y++) {
    for (let x = 0; x < resized.width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / factor));
      const sourceY = Math.min(image.height - 1, Math.floor(y / factor));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      pixel(resized, x, y, [
        image.data[sourceOffset], image.data[sourceOffset + 1], image.data[sourceOffset + 2],
      ]);
    }
  }
  return resized;
}

function drawMask(image, mask, x, y, scale, color) {
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < mask.w; col++) {
      if (mask.bits[row * mask.w + col] !== "1") continue;
      fill(image, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
  return mask.w * scale;
}

function levelFixture(level, { scale = 1, highlight = false, narrowOne = false, brokenRow = false } = {}) {
  const image = makeImage(180, 56);
  const orange = [220, 105, 30];
  const white = [255, 255, 255];
  const chars = String(level).split("");
  const widths = chars.map((digit) => digit === "1" && narrowOne ? scale : LV_MASKS[digit].w * scale);
  const contentWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, chars.length - 1) * 2 * scale;
  const badge = { x: 42, y: 4, width: Math.max(30, contentWidth + 14), height: Math.max(30, 7 * scale + 14) };
  fill(image, badge.x, badge.y, badge.width, badge.height, orange);
  const digitY = badge.y + Math.floor((badge.height - 7 * scale) / 2) + 1;
  let x = badge.x + Math.floor((badge.width - contentWidth) / 2);
  for (const digit of chars) {
    if (digit === "1" && narrowOne) {
      fill(image, x, digitY, scale, 7 * scale, white);
      x += scale;
    } else {
      x += drawMask(image, LV_MASKS[digit], x, digitY, scale, white);
    }
    x += 2 * scale;
  }
  if (highlight) {
    const lineY = Math.max(badge.y + 2, digitY - 3);
    fill(image, badge.x + 3, lineY, badge.width - 6, 1, [245, 245, 245]);
  }
  // 模擬某些縮放／抗鋸齒下，同一橫列剛好被顏色門檻吃掉。v8～v10 的
  // 「只取最長連續列帶」會只剩半個字；v7 舊法仍能把上下兩段視為同一字。
  if (brokenRow) fill(image, badge.x, digitY + 3 * scale, badge.width, scale, orange);
  return image;
}

function expFixture(exp, percent, { scale = 1 } = {}) {
  const image = makeImage(420 * scale, 24 * scale);
  const white = [255, 255, 255];
  const green = [55, 185, 70];
  let x = 8 * scale;
  const drawDigits = (text) => {
    for (const char of String(text)) {
      if (char === ".") {
        fill(image, x, 14 * scale, scale, scale, white);
        x += 2 * scale;
        continue;
      }
      x += drawMask(image, EXP_MASKS[char], x, 6 * scale, scale, white) + scale;
    }
  };
  drawDigits(exp);
  x += 2 * scale;
  fill(image, x, 5 * scale, scale, 9 * scale, green);
  x += 3 * scale;
  drawDigits(Number(percent).toFixed(2));
  x += scale;
  fill(image, x, 5 * scale, scale, 9 * scale, green);
  return image;
}

let levelCases = 0;
let legacyFallbackCases = 0;
for (let level = 1; level <= MAX_LEVEL; level++) {
  for (const scale of [1, 2, 3, 4]) {
    for (const highlight of [false, true]) {
      for (const narrowOne of [false, true]) {
        const candidates = test.readLevelCandidatesFromImage(
          levelFixture(level, { scale, highlight, narrowOne }),
          false
        );
        const matched = candidates.find((candidate) => candidate.level === level);
        assert.ok(
          matched,
          `Lv.${level} 辨識失敗（scale=${scale}, highlight=${highlight}, narrowOne=${narrowOne}）：${JSON.stringify(candidates)}`
        );
        if (matched.strategy === "傳統") legacyFallbackCases++;
        levelCases++;
      }
    }
  }
}
for (let level = 1; level <= MAX_LEVEL; level++) {
  const candidates = test.readLevelCandidatesFromImage(
    levelFixture(level, { scale: 1, brokenRow: true }),
    false
  );
  const matched = candidates.find((candidate) => candidate.level === level);
  if (matched && matched.strategy === "傳統") {
    const need = global.MapleData.EXP_TABLE[level - 1];
    const exp = Math.floor(need * 0.4321);
    const percent = Number(((exp / need) * 100).toFixed(2));
    const verified = candidates.find((candidate) => test.crossCheck(candidate.level, exp, percent));
    assert.equal(verified && verified.level, level, `Lv.${level} 多候選交叉驗證選錯等級`);
    legacyFallbackCases++;
  }
}
assert.ok(legacyFallbackCases > 0, "斷列矩陣沒有實際走到 v7 傳統切字備援");

// Windows 常見顯示縮放 125%／150%／175% 會產生非整數比例字形；以最近鄰
// 重採樣模擬像素邊界不平均的情況，不能只在整數 1～4 倍時能辨識。
let fractionalScaleCases = 0;
for (let level = 1; level <= MAX_LEVEL; level++) {
  for (const factor of [1.25, 1.5, 1.75]) {
    const candidates = test.readLevelCandidatesFromImage(
      resizeNearest(levelFixture(level), factor),
      false
    );
    assert.ok(
      candidates.some((candidate) => candidate.level === level),
      `Lv.${level} 非整數縮放辨識失敗（${factor * 100}%）：${JSON.stringify(candidates)}`
    );
    fractionalScaleCases++;
  }
}

let expCases = 0;
for (let level = 1; level <= MAX_LEVEL; level++) {
  const need = global.MapleData.EXP_TABLE[level - 1];
  assert.equal(test.expToNext(level), need, `Lv.${level} EXP 表索引錯誤`);
  for (const scale of [1, 2, 3, 4]) {
    for (const ratio of [0, 0.0111, 0.4321, 0.9999]) {
      const exp = Math.floor(need * ratio);
      const percent = Number(((exp / need) * 100).toFixed(2));
      const parsed = test.readExpFromImage(expFixture(exp, percent, { scale }));
      assert.equal(parsed.exp, exp, `Lv.${level} EXP 數字辨識錯誤（scale=${scale}）`);
      assert.equal(parsed.percent, percent, `Lv.${level} 百分比辨識錯誤（scale=${scale}）`);
      assert.equal(test.crossCheck(level, parsed.exp, parsed.percent), true, `Lv.${level} 交叉驗證失敗（scale=${scale}）`);
      expCases++;
    }
  }
  for (const factor of [1.25, 1.5, 1.75]) {
    const exp = Math.floor(need * 0.4321);
    const percent = Number(((exp / need) * 100).toFixed(2));
    const parsed = test.readExpFromImage(resizeNearest(expFixture(exp, percent), factor));
    assert.equal(parsed.exp, exp, `Lv.${level} EXP 非整數縮放辨識錯誤（${factor * 100}%）`);
    assert.equal(parsed.percent, percent, `Lv.${level} 百分比非整數縮放辨識錯誤（${factor * 100}%）`);
    assert.equal(test.crossCheck(level, parsed.exp, parsed.percent), true, `Lv.${level} 非整數縮放交叉驗證失敗（${factor * 100}%）`);
    fractionalScaleCases++;
  }
}

// 資料表外的等級無法用百分比交叉驗證，不得只因為讀到 EXP 就放行。
assert.equal(test.crossCheck(MAX_LEVEL + 1, 123, 0.01), false, "資料表外等級未被擋下");

// 擷取串流拿到的是分享來源的實際像素尺寸，並不一定等於使用者口中的
// 「螢幕解析度」。把常見 16:9、16:10、超寬、雙寬與高 DPI 尺寸全跑過，
// 確認每個候選框都在畫面內；已知尺寸必須優先選到精準版型。
const captureSizes = [
  [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [1920, 1200],
  [2048, 1152], [2560, 1080], [2560, 1440], [2732, 1440], [2732, 1536],
  [2880, 1800], [3200, 1800], [3440, 1440], [3840, 1600], [3840, 2160],
  [4096, 2160], [5120, 1440], [5120, 2160], [7680, 4320],
];
let resolutionCases = 0;
for (const [width, height] of captureSizes) {
  const candidates = test.presetReadCandidates(width, height);
  assert.ok(candidates.length >= 4, `${width}x${height} 候選版型不足`);
  for (const candidate of candidates) {
    for (const [name, rect] of [["等級", candidate.lv], ["EXP", candidate.exp]]) {
      const clamped = test.clampRect(rect, width, height);
      assert.deepEqual(clamped, rect, `${width}x${height} ${candidate.key} ${name}框超出畫面`);
      assert.ok(rect.width > 0 && rect.height > 0, `${width}x${height} ${name}框尺寸無效`);
      resolutionCases++;
    }
  }
}
for (const key of ["1366x768", "1920x1080", "2560x1440", "2732x1440", "2732x1536", "3840x2160"]) {
  const [width, height] = key.split("x").map(Number);
  const choices = test.presetChoices(width, height);
  assert.equal(choices[0].key, key, `${key} 沒有優先選精準版型`);
  assert.equal(choices[0].exact, true, `${key} 沒有標成精準版型`);
  assert.equal(test.presetReadCandidates(width, height)[0].key, key, `${key} 第一讀取候選錯誤`);
}

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
try {
  engine._reset();
  assert.equal(test.acceptSample(50, 100_000, 0), true);
  now += 60_000;
  assert.equal(test.acceptSample(50, 100_500, 0), true);
  assert.equal(engine.getState().gainedExp, 500, "同級 EXP 累計錯誤");
  assert.equal(test.acceptSample(50, 100_400, 0), false, "EXP 倒退未被拒絕");
  assert.equal(test.acceptSample(52, 1, 0), false, "跳兩級未被拒絕");

  engine._reset();
  const need50 = global.MapleData.EXP_TABLE[49];
  assert.equal(test.acceptSample(50, need50 - 20, 99.99), true);
  now += 1_000;
  assert.equal(test.acceptSample(51, 30, 0), true);
  assert.equal(engine.getState().gainedExp, 50, "升級跨級 EXP 累計錯誤");

  engine._reset();
  assert.equal(test.acceptSample(40, 10_000, 0), true);
  now += 5 * 60_000;
  assert.equal(test.acceptSample(40, 11_000, 0), true);
  assert.equal(test.windowGain(5), 1_000, "5 分鐘視窗錯誤");
  now += 5 * 60_000;
  assert.equal(test.acceptSample(40, 12_500, 0), true);
  assert.equal(test.windowGain(5), 1_500, "最近 5 分鐘視窗錯誤");
  assert.equal(test.windowGain(10), 2_500, "10 分鐘視窗錯誤");
} finally {
  Date.now = realNow;
  engine._reset();
}

console.log(
  `自動測速測試通過：${levelCases} 組等級辨識（${legacyFallbackCases} 組由 v7 備援救回）、` +
  `${expCases} 組 EXP／百分比、${fractionalScaleCases} 組 125%／150%／175% 縮放、` +
  `${resolutionCases} 組解析度裁切、累計／升級／防呆／時間視窗。`
);
