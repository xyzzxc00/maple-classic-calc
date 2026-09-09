"use strict";

// Run: node tools/test_skill_text.js
// Source audit (optional in CI): node tools/test_skill_text.js --source ../.morris-source-20260909/skills-data.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const skillText = require("../js/skillText.js");
const ROOT = path.resolve(__dirname, "..");
const unresolved = /#[A-Za-z_][A-Za-z0-9_]*/;

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function readDetails(relative) {
  const dir = path.join(ROOT, relative);
  assert.ok(fs.existsSync(dir), `Missing corpus: ${relative}`);
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

function checkDetail(d, label, allowNoLevels = false) {
  const before = JSON.stringify(d);
  freeze(d);
  const labels = skillText.labels(d);
  const keys = [...new Set([...Object.keys(d.labels || {}), ...d.levels.flatMap((l) => Object.keys(l.values || {}))])];
  assert.deepEqual(Object.keys(labels).sort(), keys.sort(), `${label}: label keys changed`);
  for (const key of keys) {
    assert.equal(typeof labels[key], "string", `${label}/${key}: missing label`);
    assert.ok(labels[key].trim(), `${label}/${key}: blank label`);
  }
  if (!d.levels.length) {
    assert.ok(allowNoLevels, `${label}: no source levels`);
    assert.equal(skillText.effect(d), "");
  } else {
    assert.equal(new Set(d.levels.map((l) => l.level)).size, d.levels.length, `${label}: duplicate levels`);
    const max = Math.max(...d.levels.map((l) => l.level));
    assert.equal(skillText.effect(d), d.levels.find((l) => l.level === max).desc.trim(), `${label}: wrong default`);
    for (const level of d.levels) {
      const actual = skillText.effect(d, level.level);
      assert.ok(actual, `${label}/Lv.${level.level}: missing resolved effect`);
      // Exact text equality preserves all numbers, signs, fixed costs, Chinese
      // numerals and source-specific wording; no formula regeneration is allowed.
      assert.equal(actual, level.desc.trim(), `${label}/Lv.${level.level}: source text changed`);
      assert.equal(skillText.effect(d, String(level.level)), actual, `${label}: select value support`);
      assert.ok(!unresolved.test(actual), `${label}/Lv.${level.level}: unresolved token`);
    }
  }
  assert.equal(JSON.stringify(d), before, `${label}: mutated input/values`);
  return d.levels.length;
}

const current = readDetails("data/db/skills");
const preview = readDetails("data/preview/el-nath/skills");
const third = current.filter((d) => d.adv === "三轉");
const byId = new Map(current.map((d) => [Number(d.id), d]));
assert.equal(third.length, 89, "Review third-job scope against Morris before changing this baseline");
assert.equal(new Set(third.map((d) => d.job)).size, 12);
for (const [name, corpus] of [["current", current], ["preview", preview]]) {
  let levelCount = 0;
  const withoutLevels = corpus.filter((d) => !d.levels.length);
  assert.deepEqual(withoutLevels.map((d) => d.id).sort(), [1003, 1004], `${name}: unexpected missing source levels`);
  for (const d of corpus) levelCount += checkDetail(d, `${name}/${d.id} ${d.name}`, [1003, 1004].includes(d.id));
  const thirdRows = corpus.filter((d) => d.adv === "三轉");
  assert.deepEqual(thirdRows.map((d) => d.id).sort(), third.map((d) => d.id).sort(), `${name}: third-job coverage`);
  console.log(`${name}: ${corpus.length} skills / ${levelCount} levels; ${thirdRows.length} third-job skills / ${thirdRows.reduce((n, d) => n + d.levels.length, 0)} levels`);
  console.log(`${name} without level effects (general description only): ${withoutLevels.map((d) => `${d.id} ${d.name}`).join(", ")}`);
}

// Specific regression assertions tie a corrected column to the source sentence.
// They intentionally distinguish same-key/different-skill semantics and units.
const regressions = [
  [2311003, "xAddHun", "隊員取得經驗值（%）", "隊員的取得經驗值150%"],
  [5110000, "xSubHun", "額外殺傷力（%）", "造成60%的額外殺傷力"],
  [1311006, "y", "技能間隔時間（秒）", "技能間隔時間2秒"],
  [4211005, "x", "楓幣消耗占抵擋傷害（%）", "楓幣為抵擋傷害的78%"],
  [4211001, "x", "恢復中承受傷害（%）", "所受到的傷害為70%"],
  [4211006, "attackCount", "可引爆楓幣數", "20個引爆可能"],
  [5111005, "pdd", "物理／魔法防禦力增加", "物理、魔法防禦力40"],
  [3110001, "y", "即死機率（%）", "以10%的機率該敵人會必死"],
  [3210001, "y", "即死機率（%）", "以10%的機率該敵人會必死"],
  [2110001, "y", "魔法攻擊力倍率（%）", "魔法攻擊力增加到140%"],
  [2210001, "y", "魔法攻擊力倍率（%）", "魔法攻擊力增加到140%"],
  [2311001, "rb", "適用範圍", "適用範圍 300"],
  [1311008, "x", "每 4 秒 HP 減少量", "每4秒 HP20減少"],
  [2311006, "mad", "召喚龍攻擊力", "召喚攻擊力150的龍"],
  [2111002, "mad", "基本攻擊力", "基本攻擊力120"],
];
for (const corpus of [current, preview]) {
  for (const [id, key, expected, evidence] of regressions) {
    const d = corpus.find((skill) => skill.id === id);
    assert.ok(d, `Missing regression skill ${id}`);
    assert.equal(skillText.labels(d)[key], expected, `${id}/${key}`);
    assert.ok(skillText.effect(d).includes(evidence), `${id}: source evidence changed; review label`);
  }
}
assert.equal(skillText.effect(byId.get(2311003), 1), "消耗MP51, 持續32秒 隊員的取得經驗值102%");
assert.equal(skillText.effect(byId.get(2311003)), "消耗MP80, 持續120秒 隊員的取得經驗值150%");
assert.equal(byId.get(2311003).levels.at(-1).values.xAddHun, 150);
assert.equal(byId.get(5110000).levels.at(-1).values.xSubHun, 60);

// No guessed structured values for these six skills; resolved prose still works.
const textOnly = third.filter((d) => d.levels.every((l) => !Object.keys(l.values).length));
assert.deepEqual(textOnly.map((d) => d.id).sort(), [1311001, 1311002, 2111005, 2211005, 4211004, 5110001].sort());
assert.ok(skillText.effect(byId.get(1311001)).includes("對三名怪物三次攻擊"));
assert.ok(skillText.effect(byId.get(2111005)).includes("提升二個等級"));
assert.ok(skillText.effect(byId.get(4211004)).includes("五個分身"));
assert.ok(skillText.effect(byId.get(5110001)).includes("物理攻擊力增加20"));
console.log(`Text-only structured fields (intentionally not inferred): ${textOnly.map((d) => `${d.id} ${d.name}`).join(", ")}`);

// ID+name must both match; a translated name or a different job's same-name
// skill must not silently receive an adventurer-specific correction.
const holy = byId.get(2311003);
assert.equal(skillText.labels({ ...holy, id: "2311003" }).xAddHun, "隊員取得經驗值（%）");
assert.equal(skillText.labels({ ...holy, id: 999 }).xAddHun, "xAddHun");
assert.equal(skillText.labels({ ...holy, name: "Renamed" }).xAddHun, "xAddHun");
assert.equal(skillText.labels({ ...byId.get(5110000), id: 999 }).xSubHun, "xSubHun");
const neutral = freeze({ labels: { x: "效果值", z: "" }, levels: [{ level: 1, values: { x: 0, z: -5, newField: 9 } }] });
assert.deepEqual(skillText.labels(neutral), { x: "效果值", z: "z", newField: "newField" });
const relabeled = skillText.labels(holy);
relabeled.mpCon = "changed by caller";
assert.equal(skillText.labels(holy).mpCon, "消耗 MP");
assert.deepEqual(skillText.labels(null), {});

// Exact level selection, incomplete data and caller-owned escaping.
const sparse = freeze({ maxLevel: 30, formula: "wrong #xAddHun", levels: [
  { level: 9, desc: "  HP -5，機率0%，<原文>&  ", values: { hp: -5, prop: 0 } },
  { level: 1, desc: "Lv1原文", values: {} },
] });
assert.equal(skillText.effect(sparse), "HP -5，機率0%，<原文>&");
assert.equal(skillText.effect(sparse, null), skillText.effect(sparse));
assert.equal(skillText.effect(sparse, 1), "Lv1原文");
for (const bad of [0, -1, 2, 30, 1.5, NaN, Infinity, "", "missing", true, {}, []]) {
  assert.equal(skillText.effect(sparse, bad), "", `Unexpected fallback for ${String(bad)}`);
}
for (const d of [null, {}, { formula: "Flat Lv1 text" }, { levels: [] }, { levels: [null] },
  { levels: [{ level: 1, desc: "" }] }, { levels: [{ level: 1, desc: "消耗#mpCon" }], formula: "Not a fallback" }]) {
  assert.equal(skillText.effect(d), "");
}

// Both exports work without document, fetch, storage or a browser runtime.
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "js/skillText.js"), "utf8"), context);
assert.equal(typeof context.window.MapleSkillText.labels, "function");
assert.equal(context.window.MapleSkillText.effect(holy), skillText.effect(holy));
assert.equal(context.window.MapleSkillText.labels(holy).xAddHun, skillText.labels(holy).xAddHun);

// Optional source comparison never executes Morris JS. The file is one JSON
// assignment, parsed as data; tests remain runnable without the external clone.
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--source"), "Usage: node tools/test_skill_text.js [--source path/to/skills-data.js]");
if (args.length) {
  const raw = fs.readFileSync(path.resolve(args[1]), "utf8");
  const prefix = /^\s*window\.MS_SKILL_DB\s*=\s*/;
  assert.ok(prefix.test(raw), "Unexpected Morris data wrapper");
  const source = JSON.parse(raw.replace(prefix, "").replace(/;\s*$/, ""));
  const sourceThird = source.skills.filter((s) => s.advancement === "三轉");
  const sourceById = new Map(source.skills.map((s) => [s.id, s]));
  const noLevels = [];
  let count = 0;
  for (const s of sourceThird) {
    const d = { id: s.id, name: s.name, labels: s.valueLabels || {}, levels: s.levels.map((l) => ({ level: l.level, desc: (l.description || "").trim(), values: l.values || {} })) };
    if (!d.levels.length) noLevels.push(`${s.id} ${s.name}`);
    count += checkDetail(d, `Morris/${s.id}`, true);
  }
  for (const corpus of [current, preview]) {
    for (const d of corpus.filter((skill) => skill.adv === "三轉")) {
      const s = sourceById.get(d.id);
      assert.ok(s, `No source skill ${d.id}`);
      assert.equal(d.name, s.name);
      assert.equal(d.maxLevel, s.maxLevel);
      assert.deepEqual(d.levels, s.levels.map((l) => ({ level: l.level, desc: (l.description || "").trim(), values: l.values || {} })), `${d.id}: imported values/descriptions drifted`);
    }
  }
  console.log(`Morris: ${sourceThird.length} third-job skills / ${count} levels verified; unimported skills receive no name-only corrections`);
  assert.deepEqual(sourceThird.filter((s) => !s.levels.length).map((s) => s.id).sort(), [21110007, 21110008], "Review new missing source-level data");
  console.log(`Source unknowns (unimported hidden skills without levels): ${noLevels.join(", ") || "none"}`);
} else {
  console.log("Morris source comparison not run: pass --source path/to/skills-data.js to include it.");
}
console.log("Skill text tests passed: exact source effects, preserved values, contextual labels, pure Node/browser API.");
