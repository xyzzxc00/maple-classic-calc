"use strict";

// 自動測速的純演算法回歸測試；不需要 npm 套件，直接 `node tools/test_expocr.js`。
// 測 1～100 每個等級、多種縮放／徽章亮紋／窄版 1、EXP 數字與百分比、
// 同級累計、升級跨級、倒退與跳級防呆、5／10 分鐘視窗。

const assert = require("node:assert/strict");

global.window = global;
require("../js/data.js");
require("../js/expocr.js");

const engine = global.MapleExpOcr;
const test = engine && engine._test;
assert.ok(test, "MapleExpOcr 測試介面不存在");

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

function expFixture(exp, percent) {
  const image = makeImage(420, 24);
  const white = [255, 255, 255];
  const green = [55, 185, 70];
  let x = 8;
  const drawDigits = (text) => {
    for (const char of String(text)) {
      if (char === ".") {
        pixel(image, x, 14, white);
        x += 2;
        continue;
      }
      x += drawMask(image, EXP_MASKS[char], x, 6, 1, white) + 1;
    }
  };
  drawDigits(exp);
  x += 2;
  fill(image, x, 5, 1, 9, green);
  x += 3;
  drawDigits(Number(percent).toFixed(2));
  x += 1;
  fill(image, x, 5, 1, 9, green);
  return image;
}

let levelCases = 0;
let legacyFallbackCases = 0;
for (let level = 1; level <= 100; level++) {
  for (const scale of [1, 2, 3]) {
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
for (let level = 1; level <= 100; level++) {
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

let expCases = 0;
for (let level = 1; level <= 100; level++) {
  const need = global.MapleData.EXP_TABLE[level - 1];
  assert.equal(test.expToNext(level), need, `Lv.${level} EXP 表索引錯誤`);
  for (const ratio of [0, 0.0111, 0.4321, 0.9999]) {
    const exp = Math.floor(need * ratio);
    const percent = Number(((exp / need) * 100).toFixed(2));
    const parsed = test.readExpFromImage(expFixture(exp, percent));
    assert.equal(parsed.exp, exp, `Lv.${level} EXP 數字辨識錯誤`);
    assert.equal(parsed.percent, percent, `Lv.${level} 百分比辨識錯誤`);
    assert.equal(test.crossCheck(level, parsed.exp, parsed.percent), true, `Lv.${level} 交叉驗證失敗`);
    expCases++;
  }
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
  `${expCases} 組 EXP／百分比、累計／升級／防呆／時間視窗。`
);
