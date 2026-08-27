const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "js", "gachaData.js"), "utf8"),
  context,
  { filename: "js/gachaData.js" }
);

const boxes = context.window.MapleGachaBoxes;
const expected = new Map([
  ["shining-comet", { count: 29, period: "2026/08/27 09:00 ～ 2026/09/09 23:59" }],
  ["brilliant-comet", { count: 59, period: "2026/08/27 09:00 ～ 2026/09/09 23:59" }],
  ["royal-salon-hair-m", { count: 12, period: "2026/08/27 00:00 ～ 2026/09/09 23:59" }],
  ["royal-salon-hair-f", { count: 12, period: "2026/08/27 00:00 ～ 2026/09/09 23:59" }],
  ["royal-salon-face-m", { count: 12, period: "2026/08/27 00:00 ～ 2026/09/09 23:59" }],
  ["royal-salon-face-f", { count: 12, period: "2026/08/27 00:00 ～ 2026/09/09 23:59" }],
  ["gasha-machine", { count: 101, period: "2026/08/20 09:00 ～ 2026/09/10 00:00" }],
]);

function fail(message) {
  throw new Error(message);
}

if (!Array.isArray(boxes)) fail("MapleGachaBoxes 沒有正確載入");
if (boxes.length !== expected.size) fail(`轉蛋池數量錯誤：${boxes.length}`);

const seenIds = new Set();
for (const box of boxes) {
  if (seenIds.has(box.id)) fail(`重複的轉蛋池 id：${box.id}`);
  seenIds.add(box.id);

  const spec = expected.get(box.id);
  if (!spec) fail(`未登記的轉蛋池：${box.id}`);
  if (box.period !== spec.period) fail(`${box.name} 活動時間不符：${box.period}`);
  if (!Array.isArray(box.items) || box.items.length !== spec.count) {
    fail(`${box.name} 獎項數量不符：${box.items && box.items.length}`);
  }

  const names = new Set();
  let total = 0;
  for (const item of box.items) {
    if (!item.name || typeof item.name !== "string") fail(`${box.name} 有空白獎項名稱`);
    if (names.has(item.name)) fail(`${box.name} 有重複獎項：${item.name}`);
    names.add(item.name);
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      fail(`${box.name}／${item.name} 的機率無效：${item.weight}`);
    }
    total += item.weight;
  }

  // 官方公告只保留小數兩位，因此容許極小的四捨五入差；超出代表常見的
  // 性別共用機率被重複計算，或資料列有漏收。
  if (Math.abs(total - 100) > 0.15) {
    fail(`${box.name} 機率總和異常：${total.toFixed(2)}%`);
  }
  console.log(`${box.name}: ${box.items.length} 項，合計 ${total.toFixed(2)}%`);
}

const brilliant = boxes.find((box) => box.id === "brilliant-comet");
const coldHope = brilliant.items.find((item) => item.name === "冷冽的希望");
if (!coldHope || coldHope.rarity !== "B" || coldHope.weight !== 0.94) {
  fail("璀璨彗星的「冷冽的希望」分級或機率未同步官方 08/27 公告");
}

console.log("轉蛋資料驗證通過");
