const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");

const root = path.resolve(__dirname, "..");
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "js", "gachaData.js"), "utf8"),
  context,
  { filename: "js/gachaData.js" }
);

const boxes = context.window.MapleGachaBoxes;
const expected = new Map([
  ["shining-comet", { count: 35, total: 100.06, eventAdId: 18945, period: "2026/09/10 09:00 ～ 2026/09/24 07:59" }],
  ["brilliant-comet", { count: 58, total: 100.01, eventAdId: 18945, period: "2026/09/10 09:00 ～ 2026/09/24 07:59" }],
  ["royal-salon-hair-m", { count: 12, total: 100, eventAdId: 18938, period: "2026/09/10 09:00 ～ 2026/09/23 23:59" }],
  ["royal-salon-hair-f", { count: 12, total: 100, eventAdId: 18938, period: "2026/09/10 09:00 ～ 2026/09/23 23:59" }],
  ["royal-salon-face-m", { count: 12, total: 100, eventAdId: 18938, period: "2026/09/10 09:00 ～ 2026/09/23 23:59" }],
  ["royal-salon-face-f", { count: 12, total: 100, eventAdId: 18938, period: "2026/09/10 09:00 ～ 2026/09/23 23:59" }],
  ["gasha-machine", { count: 101, total: 99.97, eventAdId: 19046, period: "2026/09/10 09:00 ～ 2026/10/06 23:59" }],
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
  assert.equal(box.editionId, `${box.id}-20260910`);
  assert.equal(box.eventAdId, spec.eventAdId);
  assert.equal(box.sourceUrl, `https://maplestoryclassic-event.beanfun.com/EventAd/EventAd?eventAdId=${spec.eventAdId}`);
  assert.equal(box.verifiedAt, "2026-09-10");
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
    if (box.id.includes("comet")) assert.match(item.rarity, /^[SABC]$/);
    else assert.equal(item.rarity, undefined, "官方未分級的獎項不可自行加稀有度");
    assert.equal(item.image, undefined, "未逐項核對的圖示維持空白");
  }

  // 官方公告只保留小數兩位，因此容許極小的四捨五入差；超出代表常見的
  // 性別共用機率被重複計算，或資料列有漏收。
  if (Math.abs(total - 100) > 0.15) {
    fail(`${box.name} 機率總和異常：${total.toFixed(2)}%`);
  }
  assert.ok(Math.abs(total - spec.total) < 1e-9, `${box.name} 應保留公告原始機率，勿重新分配四捨五入差`);
  console.log(`${box.name}: ${box.items.length} 項，合計 ${total.toFixed(2)}%`);
}

const brilliant = boxes.find((box) => box.id === "brilliant-comet");
const coldHope = brilliant.items.find((item) => item.name === "冷冽的希望");
if (!coldHope || coldHope.rarity !== "B" || coldHope.weight !== 0.91) {
  fail("璀璨彗星的「冷冽的希望」分級或機率未同步官方 09/10 公告");
}

// 官方 HTML 的三組 rowspan 機率只計一次；不是每個性別各有一份機率。
for (const [name, weight] of [
  ["巧克力套裝(男)／巧克力套裝(女)", 1.28],
  ["海上男人的海灘褲(男)／海灘辣妹的泳裝(女)", 2.43],
  ["海上男人的夾腳拖(男)／海灘辣妹的夾腳拖(女)", 2.56],
]) {
  assert.equal(brilliant.items.find((item) => item.name === name)?.weight, weight);
  for (const separateName of name.split("／")) {
    assert.ok(!brilliant.items.some((item) => item.name === separateName), "性別共用機率不可重複列入");
  }
}
assert.ok(!brilliant.items.some((item) => /芙莉蓮|欣梅爾|尤蓓爾|琉古納|鏡蓮華/.test(item.name)), "璀璨彗星沒有本期聯名獎項");

for (const gender of ["m", "f"]) {
  const hair = boxes.find((box) => box.id === `royal-salon-hair-${gender}`);
  const face = boxes.find((box) => box.id === `royal-salon-face-${gender}`);
  assert.equal(JSON.stringify(hair.items.map((item) => item.weight)), JSON.stringify([2.5, 2.5, 2.5, 2.5, 7.5, 7.5, 7.5, 7.5, 15, 15, 15, 15]));
  assert.equal(JSON.stringify(face.items.map((item) => item.weight)), JSON.stringify([7.5, 7.5, 7.5, 7.5, 8.75, 8.75, 8.75, 8.75, 8.75, 8.75, 8.75, 8.75]));
  assert.equal(hair.items[4].name, gender === "m" ? "黑色棉花糖造型" : "黑色隨興吹整造型");
  assert.equal(face.items[4].name, gender === "m" ? "泛淚光臉型" : "好市民臉");
}
const machine = boxes.find((box) => box.id === "gasha-machine");
assert.equal(JSON.stringify(machine.items.slice(0, 4)), JSON.stringify([
  { name: "被寶箱怪吞噬的椅子", weight: 1 },
  { name: "芙莉蓮的飛吻誘惑椅子", weight: 1 },
  { name: "一級魔法使勳章交換券", weight: 1 },
  { name: "月亮星星抱枕椅", weight: 1 },
]));

// Execute UI bindings without browser control: switching and resetting must keep
// the seven statistics independent, and displayed rates must stay unnormalized.
const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: "", textContent: "", value: "", events: {},
      addEventListener(type, handler) { this.events[type] = handler; },
    });
    return elements.get(id);
  },
};
const uiContext = { window: { MapleGachaBoxes: boxes }, document, Math: Object.create(Math) };
uiContext.Math.random = () => 0;
vm.runInNewContext(fs.readFileSync(path.join(root, "js/gacha.js"), "utf8"), uiContext);
const select = elements.get("gachaBoxSelect");
const switchTo = (id) => { select.value = id; select.events.change(); };
const click = (id) => elements.get(id).events.click();
assert.match(elements.get("gachaBoxPeriod").innerHTML, /eventAdId=18945/);
assert.match(elements.get("gachaPoolBox").innerHTML, /0\.80%/);
click("gachaPullOnceBtn");
assert.match(elements.get("gachaResultGrid").innerHTML, /芙莉蓮的服裝/);
assert.equal(elements.get("gachaTotalPulls").textContent, "1");
switchTo("royal-salon-hair-f");
assert.match(elements.get("gachaBoxPeriod").innerHTML, /eventAdId=18938/);
click("gachaPullTenBtn");
assert.equal(elements.get("gachaTotalPulls").textContent, "10");
switchTo("shining-comet");
assert.equal(elements.get("gachaTotalPulls").textContent, "1");
click("gachaResetBtn");
assert.equal(elements.get("gachaTotalPulls").textContent, "0");
switchTo("royal-salon-hair-f");
assert.equal(elements.get("gachaTotalPulls").textContent, "10");
for (const box of boxes) {
  switchTo(box.id);
  assert.match(elements.get("gachaBoxPeriod").innerHTML, /官方機率表/);
  assert.ok(elements.get("gachaBoxPeriod").innerHTML.includes(box.note));
  uiContext.Math.random = () => 1 - Number.EPSILON;
  click("gachaPullOnceBtn");
  assert.ok(elements.get("gachaResultGrid").innerHTML.includes(box.items.at(-1).name));
}

console.log("轉蛋資料驗證通過");
