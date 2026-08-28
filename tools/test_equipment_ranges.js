"use strict";

/**
 * 裝備天然浮動範圍健檢。
 *
 * 驗證道具詳情與卷軸模擬使用同一份「目前開放取得方式」資料，並把 Morris
 * 目前採用的能力值範圍規則鎖進 CI。日後上游規則若改變，匯入不能靜默地
 * 把整批武器／防具範圍改掉，必須先人工確認再更新這支測試。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ITEM_DIR = path.join(ROOT, "data", "db", "items");
const SCROLL_SIM = path.join(ROOT, "data", "db", "scroll_sim.json");

const ATTACK_STATS = new Set(["incPAD", "incMAD"]);
const DEFENSE_STATS = new Set(["incPDD", "incMDD"]);
const VITAL_STATS = new Set(["incMHP", "incMMP"]);
const MINOR_STATS = new Set([
  "incSTR", "incDEX", "incINT", "incLUK", "incACC", "incEVA",
  "incSpeed", "incJump",
]);
const ALLOWED_SOURCES = new Set(["怪物掉落", "使用催化劑合成"]);

const problems = [];
let detailRangeItems = 0;
let weaponRangeItems = 0;
let checkedFields = 0;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function expectedDelta(key, base) {
  if (ATTACK_STATS.has(key)) return Math.min(Math.ceil(base / 10) + 1, 7);
  if (DEFENSE_STATS.has(key) || VITAL_STATS.has(key)) {
    return Math.min(Math.ceil(base / 10), 10);
  }
  if (MINOR_STATS.has(key)) return Math.min(Math.ceil(base / 10), 5);
  return null;
}

function checkRange(label, key, base, min, max) {
  checkedFields += 1;
  if (![base, min, max].every(Number.isFinite)) {
    problems.push(`${label} ${key}：base/min/max 必須是數字`);
    return;
  }
  const delta = expectedDelta(key, base);
  if (delta == null) {
    problems.push(`${label} ${key}：未知的浮動能力欄位`);
    return;
  }
  if (min !== base - delta || max !== base + delta) {
    problems.push(
      `${label} ${key}：目前是 ${min}~${max}，基準 ${base} 應為 ${base - delta}~${base + delta}`
    );
  }
}

const details = new Map();
for (const filename of fs.readdirSync(ITEM_DIR).filter((name) => name.endsWith(".json"))) {
  const item = readJson(path.join(ITEM_DIR, filename));
  const ranges = item.float || {};
  const sources = item.floatFrom || [];
  details.set(Number(item.id), item);

  if (!Object.keys(ranges).length) {
    if (sources.length) problems.push(`${item.id} ${item.name}：沒有範圍卻有浮動來源`);
    continue;
  }

  detailRangeItems += 1;
  if ((item.equip || {}).incPAD || (item.equip || {}).incMAD) weaponRangeItems += 1;
  if (!sources.length) problems.push(`${item.id} ${item.name}：有範圍卻沒有浮動來源`);
  if (new Set(sources).size !== sources.length) {
    problems.push(`${item.id} ${item.name}：浮動來源重複`);
  }
  for (const source of sources) {
    if (!ALLOWED_SOURCES.has(source)) {
      problems.push(`${item.id} ${item.name}：未知浮動來源「${source}」`);
    }
    if (source === "怪物掉落" && !(item.drops || []).length) {
      problems.push(`${item.id} ${item.name}：標成怪物掉落浮動，但沒有目前開放的掉落怪物`);
    }
    if (source === "使用催化劑合成"
        && !(item.crafts || []).some((craft) => craft.catalyst === true)) {
      problems.push(`${item.id} ${item.name}：標成催化劑浮動，但沒有目前開放的催化劑配方`);
    }
  }
  for (const [key, bounds] of Object.entries(ranges)) {
    const base = (item.equip || {})[key];
    checkRange(`${item.id} ${item.name}`, key, base, bounds[0], bounds[1]);
  }
}

const scrollSim = readJson(SCROLL_SIM);
let simulatorRangeItems = 0;
for (const equipment of scrollSim.equipment || []) {
  const detail = details.get(Number(equipment.id));
  if (!detail) {
    problems.push(`卷軸模擬 ${equipment.id} ${equipment.name}：找不到道具詳情`);
    continue;
  }
  const detailRanges = detail.float || {};
  const simRanges = equipment.statRanges || {};
  if (Object.keys(simRanges).length) simulatorRangeItems += 1;

  const expectedRanges = Object.fromEntries(
    Object.entries(detailRanges).map(([key, bounds]) => [key, {
      base: (detail.equip || {})[key], min: bounds[0], max: bounds[1],
    }])
  );
  if (JSON.stringify(simRanges) !== JSON.stringify(expectedRanges)) {
    problems.push(`卷軸模擬 ${equipment.id} ${equipment.name}：初始範圍與道具詳情不一致`);
  }
  if (JSON.stringify(equipment.statRangeSources || [])
      !== JSON.stringify(detail.floatFrom || [])) {
    problems.push(`卷軸模擬 ${equipment.id} ${equipment.name}：浮動來源與道具詳情不一致`);
  }
}

if (problems.length) {
  console.error(`裝備浮動範圍健檢失敗（${problems.length} 項）：`);
  for (const problem of problems.slice(0, 80)) console.error(`- ${problem}`);
  if (problems.length > 80) console.error(`- ……另有 ${problems.length - 80} 項`);
  process.exit(1);
}

console.log(
  `裝備浮動範圍正常：目前開放 ${detailRangeItems} 件（武器 ${weaponRangeItems}、` +
  `其他 ${detailRangeItems - weaponRangeItems}），驗證 ${checkedFields} 個能力欄位；` +
  `卷軸模擬同步 ${simulatorRangeItems} 件。`
);
