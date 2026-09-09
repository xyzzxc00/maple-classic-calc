"use strict";

/**
 * El Nath preview regression gate; reads files only, never runs the importer.
 * node tools/test_el_nath.js
 * node tools/test_el_nath.js --compare <preview snapshot from the previous import>
 *
 * The optional comparison checks every JSON file, including the manifest, after
 * a second import. CI needs no upstream checkout. Live data/images are protected
 * against the pre-expansion commit; deliberate future live updates must review
 * and advance LIVE_BASELINE rather than silently accepting import side effects.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PREVIEW = path.join(ROOT, "data/preview/el-nath");
const LIVE_BASELINE = "943f43972446496565e1090f725aaef2f678cdb5";
const SOURCE = {
  gameVersion: "1.14.7",
  generatedAt: "2026-09-03T16:09:17+08:00",
};
const KINDS = ["monsters", "maps", "items", "npcs", "quests", "skills"];
// Reviewed output of this exact source revision: [union total, added, preview].
// A self-consistent manifest alone cannot catch an importer dropping new rows.
const EXPECTED_SETS = {
  monsters: [145, 74, 74], maps: [436, 83, 83], items: [1899, 457, 457],
  npcs: [262, 26, 26], quests: [264, 0, 0], skills: [208, 0, 89],
};
const EXPANSION = new Set(["冰原雪域", "廢礦"]);
const REGIONS = new Set(["楓之島", "維多利亞島", "奇幻村", "鯨魚號", ...EXPANSION]);
// The dump has TWELVE lines: 3 warriors + 3 mages + 2 archers + 2 thieves + 2 pirates.
// Pin each line's skill IDs, not just a total that could hide an omitted branch.
const THIRD = {
  111: [0, 1, 1002, 1003, 1004, 1005, 1006, 1007, 1008],
  121: [0, 1, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009],
  131: [0, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008],
  211: [0, 1, 1002, 1003, 1004, 1005, 1006],
  221: [0, 1, 1002, 1003, 1004, 1005, 1006],
  231: [0, 1001, 1002, 1003, 1004, 1005, 1006],
  311: [0, 1, 1002, 1003, 1004, 1005, 1006],
  321: [0, 1, 1002, 1003, 1004, 1005, 1006],
  411: [0, 1001, 1002, 1003, 1004, 1005, 1006],
  421: [0, 1001, 1002, 1003, 1004, 1005, 1006],
  511: [0, 1, 1002, 1004, 1005, 1006],
  521: [0, 1001, 1002, 1004, 1005, 1006],
};
const THIRD_NAMES = {
  111: "十字軍之路", 121: "騎士之路", 131: "龍騎士之路",
  211: "魔導士之路(火毒)", 221: "魔導士之路(冰雷)", 231: "祭司之路",
  311: "遊俠之路", 321: "狙擊手之路", 411: "暗殺者之路", 421: "神偷之路",
  511: "格鬥家之路", 521: "神槍手之路",
};
const SKILL_GROUPS = ["初心者/共通", "冒險家劍士", "冒險家法師", "冒險家弓箭手", "冒險家盜賊", "冒險家海盜"];
const JOBS = new Set([0, 100, 110, 120, 130, 200, 210, 220, 230,
  300, 310, 320, 400, 410, 420, 500, 510, 520, ...Object.keys(THIRD).map(Number)]);
const id = (value) => String(value);
const sameIds = (a, b) => JSON.stringify(a.map(id).sort()) === JSON.stringify(b.map(id).sort());
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

// Independent fixtures audited directly from the 2026-09-03 snapshot, not generated
// from the preview. These prevent a missing label from making itself invisible
// to a source-filtered test. Pair identity matters as much as aggregate counts.
const TMS_MAP_MOBS = [6130104, 6230101, 6300003, 6400003, 6400004,
  ...Array.from({ length: 11 }, (_, i) => 8800000 + i),
  ...Array.from({ length: 16 }, (_, i) => 8800100 + i)];
const TMS_SHARED_ITEMS = [1472053, 1312030, 1382035, 1492012, 1372049,
  1322045, 1432030, 1482012, 1462015, 1452019, 1422027, 1302056, 1402035,
  1332052, 1462016, 1452020, 1442044, 1412021, 1372010, 1332051, 2388023,
  2000004, 2000005, 2020013, 2020015, 4001083];
const TMS_ITEM_DROPS = TMS_SHARED_ITEMS.flatMap((item) => [[item, 8800002], [item, 8800102]])
  .concat([[1002357, 8800002], [1003112, 8800102]]);
// 4031459 is source=tmsv113, not source=quest: its restriction exists only
// in dropConditions[].questId=6231. It must not become an ordinary drop.
const CLOSED_QUEST_DROPS = [[8130100, 4031475, 6153], [8140000, 4031460, 6168],
  [8140000, 4031477, 6191], [6130104, 4031459, 6231]];
const OPEN_QUEST_DROPS = [[130101, 4031846, 2173], [210100, 4031273, 2104],
  [1110100, 4031146, 2065], [1130100, 4031147, 2065], [1210100, 4031846, 2173],
  [2130100, 4031153, 2070], [3210100, 4001000, 2017], [3230100, 4001004, 2001],
  [5300100, 4031925, 2223]];
// Only dropRates contain tmsv113 for these pairs. The association is MonsterBook.
const RATE_ONLY_TMS = [[1432004, 5220002], [1442005, 5220002],
  [1372015, 6220000], [1412003, 8140100], [1422010, 6220000]];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${path.relative(ROOT, file)}: ${error.message}`); }
}

function jsonFiles(folder, prefix = "") {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) return jsonFiles(path.join(folder, entry.name), rel + "/");
    return entry.isFile() && entry.name.endsWith(".json") ? [rel] : [];
  }).sort();
}

function readPreview(folder = PREVIEW) {
  const indexes = {}, details = {};
  for (const kind of KINDS) {
    indexes[kind] = readJson(path.join(folder, `${kind}.json`));
    if (!Array.isArray(indexes[kind])) throw new Error(`${kind}.json 必須是索引陣列`);
    details[kind] = new Map(jsonFiles(path.join(folder, kind)).map((file) => {
      if (!/^\d+\.json$/.test(file)) throw new Error(`${kind}/${file}: 非預期詳情檔名`);
      return [file.slice(0, -5), readJson(path.join(folder, kind, file))];
    }));
  }
  return { indexes, details, manifest: readJson(path.join(folder, "manifest.json")),
    shops: readJson(path.join(folder, "shops.json")), world: readJson(path.join(folder, "worldmaps.json")) };
}

function readLive() {
  return Object.fromEntries(KINDS.map((kind) => [kind, readJson(path.join(ROOT, `data/db/${kind}.json`))]));
}

function validatePreview(bundle, live) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  const { indexes, details, manifest, shops, world } = bundle;
  const ids = Object.fromEntries(KINDS.map((kind) => [kind, new Set(indexes[kind].map((r) => id(r.id)))]));
  const liveIds = Object.fromEntries(KINDS.map((kind) => [kind, new Set(live[kind].map((r) => id(r.id)))]));
  const unique = (values, label) => check(new Set(values.map(id)).size === values.length, `${label}: ID 重複（含數字／字串重複）`);
  const link = (kind, ref, label, conditional = false) => {
    if (!ref || (conditional && ref.link !== true)) return;
    check(ids[kind].has(id(ref.id)), `${label} → ${kind}/${ref.id}: 連結不存在`);
  };
  const links = (kind, refs, label, conditional = false) => {
    for (const ref of refs || []) link(kind, ref, label, conditional);
  };
  const craftLink = (ref, label) => {
    check(ref && /^\d+$/.test(id(ref.id)), `${label}: 製作參照缺少有效 ID`);
    if (!ref) return;
    if (Object.hasOwn(ref, "link")) check(typeof ref.link === "boolean", `${label}/${ref.id}: link 必須是布林值`);
    if (ref.link === false) {
      // Unnamed/unavailable materials stay visible as honest plain text. No
      // implicit falsy values: old records without the flag MUST still resolve.
      check(!ids.items.has(id(ref.id)), `${label}/${ref.id}: 已收錄道具誤標為 link:false`);
    } else link("items", ref, label);
  };

  for (const kind of KINDS) {
    const rows = indexes[kind];
    check(rows.length > 0, `${kind}: 索引不可為空`);
    unique(rows.map((r) => r.id), kind);
    check(sameIds([...ids[kind]], [...details[kind].keys()]), `${kind}: 索引與詳情檔 ID 不一致`);
    const omitted = [...liveIds[kind]].filter((key) => !ids[kind].has(key));
    // One legacy item is now proven to be fourth-job-quest-only. Its original
    // live file remains protected; preview must not resurrect its stale drop.
    const reviewedOmissions = kind === "items" ? ["4031475"] : [];
    check(sameIds(omitted, reviewedOmissions), `${kind}: 預覽遺漏清單超出已審核排除 ${omitted.join(", ")}`);
    for (const row of rows) {
      const label = `${kind}/${row.id}`;
      check(/^\d+$/.test(id(row.id)), `${label}: 無效 ID`);
      const doc = details[kind].get(id(row.id));
      if (!doc) continue;
      check(id(doc.id) === id(row.id) && doc.name === row.name, `${label}: 詳情 ID／名稱與索引不符`);
      const preview = !liveIds[kind].has(id(row.id)) || (kind === "skills" && row.adv === "三轉");
      check(row.preview === preview && doc.preview === preview, `${label}: preview 旗標不符新資料／三轉狀態`);
    }
  }

  check(manifest.status === "preview", "manifest.status 必須是 preview");
  check(!Object.hasOwn(manifest, "source") && !Object.hasOwn(manifest, "sourceCommit"), "公開 manifest 不應包含外部作者網址或版本庫提交資訊");
  check(Array.isArray(manifest.excludedQuestItems) && sameIds(manifest.excludedQuestItems, CLOSED_QUEST_DROPS.map(([, iid]) => iid)), "manifest.excludedQuestItems: 任務限定排除清單不符來源審核");
  for (const [key, value] of Object.entries(SOURCE)) {
    check(manifest[key] === value, `manifest.${key}: 來源版本漂移，需核對拆包後更新測試基準`);
  }
  check(typeof manifest.title === "string" && manifest.title.includes("預覽"), "manifest.title 未標示預覽");
  check(/^\d{4}-\d{2}-\d{2}$/.test(manifest.checkedAt) && Number.isFinite(Date.parse(manifest.checkedAt)), "manifest.checkedAt: 日期無效");
  check(typeof manifest.notice === "string" && /不代表.*開放/.test(manifest.notice), "manifest.notice: 缺少未開放說明");
  check(Array.isArray(manifest.regions) && sameIds(manifest.regions, [...EXPANSION]), "manifest.regions: 必須只包含冰原雪域／廢礦");
  check(manifest.sets && sameIds(Object.keys(manifest.sets), KINDS), "manifest.sets: 必須包含六種資料集");
  for (const kind of KINDS) {
    const summary = manifest.sets?.[kind];
    const actualCounts = [indexes[kind].length, summary?.added?.length, summary?.preview?.length];
    check(JSON.stringify(actualCounts) === JSON.stringify(EXPECTED_SETS[kind]), `manifest.sets.${kind}: 同一來源的總數／新增／預覽筆數偏離基準 ${EXPECTED_SETS[kind].join("/")}`);
    check(summary && summary.total === indexes[kind].length && summary.total === ids[kind].size, `manifest.sets.${kind}.total: 筆數不符`);
    for (const field of ["added", "preview"]) {
      const rows = summary?.[field];
      if (!Array.isArray(rows)) { check(false, `manifest.sets.${kind}.${field}: 缺少 ID 清單`); continue; }
      unique(rows, `manifest.sets.${kind}.${field}`);
      const expected = indexes[kind].filter((r) => field === "added" ? !liveIds[kind].has(id(r.id)) : r.preview).map((r) => r.id);
      check(sameIds(rows, expected), `manifest.sets.${kind}.${field}: ID／重複匯入筆數不符`);
    }
  }
  const missingMaps = indexes.maps.filter((m) => m.dataMissing).map((m) => m.id);
  for (const field of ["missingMapData", "referenceOnlyMaps"]) {
    const values = manifest[field];
    if (!Array.isArray(values)) { check(false, `manifest.${field}: 缺少清單`); continue; }
    unique(values, `manifest.${field}`);
    for (const mid of values) {
      const map = details.maps.get(id(mid));
      check(map?.dataMissing === true && EXPANSION.has(map.region), `manifest.${field}/${mid}: 非缺少幾何的擴充地圖`);
    }
  }
  check(Array.isArray(manifest.missingMapData) && sameIds(manifest.missingMapData, missingMaps), "manifest.missingMapData: 與索引缺漏標記不符");
  check(manifest.missingMapData?.length === 82 && manifest.referenceOnlyMaps?.length === 11, "manifest: 同一來源應有 82 張缺少幾何地圖、11 張僅來源提及地圖");

  for (const row of indexes.maps) {
    const label = `maps/${row.id}`, doc = details.maps.get(id(row.id));
    if (!doc) continue;
    check(liveIds.maps.has(id(row.id)) || EXPANSION.has(row.region), `${label}: 超出既有地圖＋冰原雪域／廢礦範圍`);
    check(row.region === doc.region && Boolean(row.dataMissing) === Boolean(doc.dataMissing), `${label}: 地區／幾何缺漏旗標不一致`);
    if (doc.dataMissing) {
      for (const field of ["spawns", "npcs", "portals"]) check(row[field] === null, `${label}.${field}: 幾何缺失必須為 null，不能假造 0`);
      check(row.mobs === null || (isCount(row.mobs) && row.mobs > 0), `${label}.mobs: 未知怪物種類不能顯示 0`);
      check(doc.hasMini === false && doc.spawns.length === 0 && doc.portals.length === 0, `${label}: 缺少幾何卻宣稱有小地圖／重生座標／傳送點`);
      for (const npc of doc.npcs) check(npc.x === null && npc.y === null, `${label}/NPC ${npc.name}: 來源提及不等於已知座標`);
      for (const mob of doc.mobs) check(mob.count === null, `${label}/monster ${mob.id}: 未知重生數必須是 null`);
    } else {
      for (const field of ["mobs", "spawns", "npcs", "portals"]) check(isCount(row[field]), `${label}.${field}: 已知幾何計數無效`);
      // The list counts destinations outside this map, not same-map ladders.
      check(row.mobs === doc.mobs.length && row.npcs === doc.npcs.length && row.portals === doc.portals.filter((p) => !p.same).length, `${label}: 索引計數與詳情不符`);
      check(row.spawns === doc.mobs.reduce((n, m) => n + m.count, 0), `${label}: 重生總數不符`);
      for (const mob of doc.mobs) check(isCount(mob.count), `${label}/monster ${mob.id}: 重生數無效`);
    }
    links("monsters", doc.mobs, label, true);
    for (const spawn of doc.spawns) {
      check(doc.mobs.some((m) => id(m.id) === id(spawn.id)), `${label}: 重生座標沒有對應怪物 ${spawn.id}`);
      if (doc.mobs.find((m) => id(m.id) === id(spawn.id))?.link) link("monsters", spawn, label);
    }
    links("maps", doc.portals, label, true);
    links("npcs", doc.npcs, label, true);
  }
  for (const doc of details.monsters.values()) {
    const label = `monsters/${doc.id}`;
    links("items", doc.drops, label, true);
    links("maps", doc.maps, label, true);
    links("quests", doc.quests, label);
    for (const map of doc.maps) {
      const missing = details.maps.get(id(map.id))?.dataMissing;
      check(missing ? map.spawns === null : map.spawns === null || isCount(map.spawns), `${label} → maps/${map.id}: 未知重生數必須是 null`);
    }
  }
  for (const doc of details.items.values()) {
    const label = `items/${doc.id}`;
    links("monsters", doc.drops, label);
    links("quests", doc.quests, label);
    for (const usedIn of doc.usedIn) craftLink(usedIn, `${label}/usedIn`);
    for (const craft of doc.crafts) {
      for (const material of craft.materials) craftLink(material, `${label}/materials`);
      craftLink(craft.out, `${label}/out`);
    }
  }
  for (const doc of details.npcs.values()) {
    const label = `npcs/${doc.id}`;
    links("maps", doc.maps, label);
    links("quests", doc.quests, label);
    links("items", doc.shop, label);
    links("items", doc.crafts, label);
    const row = indexes.npcs.find((n) => id(n.id) === id(doc.id));
    if (row) check(row.quests === doc.quests.length && row.shop === doc.shop.length + doc.crafts.length && row.img === doc.img, `${label}: NPC 索引計數／圖片旗標不符`);
  }
  for (const doc of details.quests.values()) {
    const label = `quests/${doc.id}`;
    for (const value of [doc.minLevel, doc.start.level, doc.maxLevel]) check(value === null || (isCount(value) && value <= 100), `${label}: 等級超過 100 或無效`);
    // Existing ordinary quests list every class that MAY accept them, including
    // later jobs. They are not fourth-job quests unless ONLY closed jobs qualify.
    check(doc.start.jobs.every((job) => Number.isInteger(job) && job >= 0), `${label}: 職業條件格式無效`);
    check(!doc.start.jobs.length || doc.start.jobs.some((job) => JOBS.has(job)), `${label}: 僅四轉／未上線職業能接取`);
    check(!/四轉/.test(doc.name + doc.parent + doc.category), `${label}: 不應收錄四轉任務`);
    for (const npc of [doc.startNpc, doc.endNpc]) if (npc) {
      // NPCs mentioned only by name can remain plain text; located NPCs must resolve.
      if (npc.maps.length) link("npcs", npc, label);
      links("maps", npc.maps, label);
    }
    links("items", doc.start.items, label, true);
    links("items", doc.complete.items, label, true);
    links("monsters", doc.complete.monsters, label, true);
    links("items", doc.rewards.items, label, true);
    links("skills", doc.rewards.skills, label, true);
    links("quests", [...doc.start.quests, ...doc.deps, ...(doc.next ? [doc.next] : [])], label, true);
    const consumed = new Set(doc.complete.items.map((r) => id(r.id)));
    check(!doc.rewards.items.some((r) => consumed.has(id(r.id))), `${label}: 完成材料誤列為獎勵`);
  }

  const skillCode = (s) => Math.floor(Number(s.id) / 10000);
  const liveSkills = new Map(live.skills.map((s) => [id(s.id), s]));
  const prereqs = new Map();
  for (const row of indexes.skills) {
    const label = `skills/${row.id}`, doc = details.skills.get(id(row.id)), code = skillCode(row);
    if (!doc) continue;
    check(JOBS.has(code) && row.adv !== "四轉" && doc.adv !== "四轉", `${label}: 含四轉／未上線技能`);
    check(row.group === SKILL_GROUPS[Math.floor(code / 100)], `${label}: 職業群組不符冒險家範圍`);
    for (const field of ["adv", "job", "group", "maxLevel"]) check(row[field] === doc[field], `${label}.${field}: 索引與詳情不符`);
    check((row.adv === "三轉") === Object.hasOwn(THIRD, code), `${label}: 三轉職業代碼／標籤不符`);
    check(Number.isInteger(doc.maxLevel) && doc.maxLevel > 0, `${label}: maxLevel 無效`);
    if (liveSkills.has(id(row.id))) check(doc.maxLevel === liveSkills.get(id(row.id)).maxLevel, `${label}: 技能上限與既有來源基準不符`);
    // Common mount skills 1003/1004 have no level records in this source dump.
    if (![1003, 1004].includes(Number(doc.id))) {
      check(doc.levels.length === doc.maxLevel && doc.levels.every((lv, i) => lv.level === i + 1), `${label}: 技能等級未完整涵蓋 1～${doc.maxLevel}`);
      for (const lv of doc.levels) {
        check(typeof lv.desc === "string" && lv.desc.trim().length > 0, `${label}/Lv.${lv.level}: 缺少逐級說明`);
        check(lv.values && Object.values(lv.values).every(Number.isFinite), `${label}/Lv.${lv.level}: 數值無效`);
      }
    }
    check((row.req?.name ?? null) === (doc.req?.name ?? null) && (row.req?.level ?? null) === (doc.req?.level ?? null), `${label}: 前置需求與詳情不符`);
    if (row.req && row.req.id == null) {
      let candidates = indexes.skills.filter((s) => s.job === row.job && s.name === row.req.name);
      if (!candidates.length) candidates = indexes.skills.filter((s) => s.group === row.group && s.name === row.req.name);
      check(candidates.length !== 1, `${label}: 唯一可解析的前置技能遺失連結 ID`);
    }
    for (const req of [row.req, doc.req]) if (req) {
      check(Number.isInteger(req.level) && req.level > 0 && typeof req.name === "string" && req.name.length > 0, `${label}: 前置需求格式錯誤`);
      if (req.id != null) {
        link("skills", req, `${label}/req`);
        const target = details.skills.get(id(req.id));
        if (target) {
          const targetCode = skillCode(target);
          const ancestors = new Set([0, Math.floor(code / 100) * 100, Math.floor(code / 10) * 10, code]);
          check(target.name === req.name && target.group === doc.group && ancestors.has(targetCode), `${label}: 前置技能名稱／職業路線不符`);
          check(req.level <= target.maxLevel, `${label}: 前置等級超過技能上限`);
          prereqs.set(id(row.id), id(req.id));
        }
      }
    }
  }
  for (const start of prereqs.keys()) {
    const seen = new Set(); let current = start;
    while (prereqs.has(current)) {
      if (seen.has(current)) { check(false, `skills/${start}: 前置技能循環`); break; }
      seen.add(current); current = prereqs.get(current);
    }
  }
  for (const [code, suffixes] of Object.entries(THIRD)) {
    const rows = indexes.skills.filter((s) => skillCode(s) === Number(code));
    check(sameIds(rows.map((r) => r.id), suffixes.map((suffix) => Number(code) * 10000 + suffix)), `三轉職業 ${code}: 技能缺漏或混入額外技能`);
    check(rows.every((r) => r.job === THIRD_NAMES[code]), `三轉職業 ${code}: 職業名稱不符`);
  }

  unique(shops.map((s) => s.id), "shops");
  const liveShopIds = new Set(readJson(path.join(ROOT, "data/db/shops.json")).map((s) => id(s.id)));
  for (const shop of shops) {
    const label = `shops/${shop.id}`;
    link("npcs", shop, label);
    links("items", shop.items, label);
    links("items", shop.crafts, label);
    check(shop.preview === !liveShopIds.has(id(shop.id)), `${label}: preview 旗標不符`);
    const npc = details.npcs.get(id(shop.id));
    if (npc) check(JSON.stringify(shop.items) === JSON.stringify(npc.shop) && JSON.stringify(shop.crafts) === JSON.stringify(npc.crafts) && shop.img === npc.img, `${label}: 商品／製作／圖片與 NPC 不一致`);
  }
  check(sameIds(world.map((r) => r.name), [...REGIONS]), "worldmaps: 區域必須恰好為四個原區域＋冰原雪域／廢礦");
  unique(world.map((r) => r.key), "worldmaps");
  const worldKeys = new Set(world.map((r) => r.key));
  for (const region of world) {
    const label = `worldmaps/${region.key}`, nodes = new Set(region.nodes.map((n) => id(n.id)));
    unique(region.nodes.map((n) => n.id), label);
    links("maps", region.nodes, label, true);
    for (const [from, to] of region.edges) check(nodes.has(id(from)) && nodes.has(id(to)), `${label}: 世界地圖連線端點不存在 ${from} → ${to}`);
    for (const proxy of region.proxies) check(worldKeys.has(proxy.region), `${label}: 跨區入口不存在 ${proxy.region}`);
  }
  errors.push(...validateProvenance(bundle, live));
  return errors;
}

function validateProvenance(bundle, live) {
  const errors = [], { details, indexes, manifest } = bundle;
  const check = (ok, message) => { if (!ok) errors.push(`來源／條件: ${message}`); };
  const questIds = new Set(indexes.quests.map((q) => id(q.id)));
  const itemIds = new Set(indexes.items.map((i) => id(i.id)));
  const liveItems = new Set(live.items.map((i) => id(i.id)));
  const pair = (a, b) => `${a}/${b}`;
  const evidence = (row) => [row, ...(Array.isArray(row?.sourceEvidence) ? row.sourceEvidence : [])].filter(Boolean);
  const from = (row, source) => evidence(row).some((e) => e.source === source);
  const find = (kind, key, field, target) => details[kind].get(id(key))?.[field]?.find((r) => id(r.id) === id(target));
  const expect = (row, source, label, sourceLabel) => {
    check(Boolean(row), `${label}: 關聯遺失`);
    if (!row) return;
    check(evidence(row).some((e) => e.source === source &&
      (sourceLabel === undefined || (e.sourceLabel === sourceLabel && typeof e.sourceNote === "string" && e.sourceNote.includes(sourceLabel)))),
    `${label}: ${source} 原始來源／標籤／顯示註記遺失`);
  };
  check(manifest.provenanceSchemaVersion === 1, "manifest.provenanceSchemaVersion 必須為 1");

  const mapPairs = [], reverseMapPairs = [], itemPairs = [], monsterPairs = [];
  for (const kind of ["maps", "monsters", "items"]) for (const doc of details[kind].values()) {
    const fields = kind === "maps" ? ["mobs"] : kind === "monsters" ? ["maps", "drops"] : ["drops"];
    for (const field of fields) for (const row of doc[field]) {
      const label = `${kind}/${doc.id}/${field}/${row.id}`;
      if (Object.hasOwn(row, "sourceEvidence")) {
        check(Array.isArray(row.sourceEvidence) && row.sourceEvidence.length > 0 && row.sourceEvidence.every((e) => e && typeof e === "object" && !Array.isArray(e)), `${label}: 多筆來源必須是非空證據物件陣列`);
        if (Array.isArray(row.sourceEvidence)) check(new Set(row.sourceEvidence.map((e) => JSON.stringify(e))).size === row.sourceEvidence.length, `${label}: 多筆來源重複`);
      }
      for (const e of evidence(row)) {
        if (Object.hasOwn(e, "source")) check(typeof e.source === "string" && e.source.length > 0 && typeof e.sourceNote === "string", `${label}: source／sourceNote 格式錯誤`);
        for (const key of ["sourceLabel", "sourceUrl", "spawnNote"]) if (Object.hasOwn(e, key)) check(typeof e[key] === "string", `${label}.${key}: 原始來源欄位格式錯誤`);
        for (const key of ["dropRates", "probability", "dropProbability"]) check(!Object.hasOwn(e, key), `${label}: 不應把 ${key} 掉率估計混入關聯來源`);
        if (field === "drops" && e.source === "quest") {
          check(Array.isArray(e.questIds) && Array.isArray(e.questNames), `${label}: 任務限定掉落遺失條件欄位`);
          if (Array.isArray(e.questIds) && e.questIds.length) check(e.questIds.some((qid) => questIds.has(id(qid))), `${label}: 只有未收錄／四轉任務可掉落`);
        }
        if (Object.hasOwn(e, "dropConditions")) {
          check(Array.isArray(e.dropConditions), `${label}: dropConditions 必須是陣列`);
          if (Array.isArray(e.dropConditions)) {
            for (const condition of e.dropConditions) {
              const valid = condition && typeof condition === "object" && !Array.isArray(condition);
              check(valid, `${label}: dropConditions 必須包含條件物件`);
              if (!valid) continue;
              for (const key of ["dropRates", "probability", "dropProbability"]) check(!Object.hasOwn(condition, key), `${label}: dropConditions 不可夾帶 ${key} 掉率估計`);
              if (Object.hasOwn(condition, "questId")) check(/^\d+$/.test(id(condition.questId)), `${label}: dropConditions.questId 必須是非負任務 ID`);
            }
          }
        }
      }
      if (field === "drops") {
        const conditions = evidence(row).flatMap((e) => Array.isArray(e.dropConditions) ? e.dropConditions : []);
        // Zero explicitly means unrestricted; an absent questId is unknown.
        // Neither may be silently converted to a positive quest restriction.
        // Multiple sourceEvidence entries are alternative evidence, not ANDs.
        const closedOnly = conditions.length > 0 && conditions.every((c) => c && /^\d+$/.test(id(c.questId)) && Number(c.questId) > 0);
        const openQuestSource = evidence(row).some((e) => e.source === "quest" && Array.isArray(e.questIds) && e.questIds.some((qid) => questIds.has(id(qid))));
        if (closedOnly && !openQuestSource) check(conditions.some((c) => questIds.has(id(c.questId))), `${label}: dropConditions 只有未收錄／四轉任務，不得列為一般掉落`);
      }
      if (!from(row, "tmsv113")) continue;
      if (kind === "maps") mapPairs.push(pair(doc.id, row.id));
      else if (kind === "items") itemPairs.push(pair(doc.id, row.id));
      else if (field === "maps") reverseMapPairs.push(pair(row.id, doc.id));
      else monsterPairs.push(pair(row.id, doc.id));
    }
  }
  const expectedMaps = TMS_MAP_MOBS.map((mid) => pair(280030000, mid));
  const expectedDrops = TMS_ITEM_DROPS.map(([iid, mid]) => pair(iid, mid));
  check(sameIds(mapPairs, expectedMaps), "TMS v113 地圖→怪物應精確保留 32 組關聯");
  check(sameIds(reverseMapPairs, expectedMaps), "TMS v113 怪物→地圖反向關聯應保留同一批 32 組來源");
  check(sameIds(itemPairs, expectedDrops), "TMS v113 道具→掉落怪物應精確保留 54 組關聯");
  check(sameIds(monsterPairs, expectedDrops), "TMS v113 怪物→掉落道具應保留同一批 54 組來源");
  check(itemPairs.filter((key) => !liveItems.has(key.split("/")[0])).length === 46, "新增道具的 TMS v113 掉落關聯應為 46 筆（另有 8 筆既有道具；6231 任務限定掉落已排除）");
  for (const mid of TMS_MAP_MOBS) {
    expect(find("maps", 280030000, "mobs", mid), "tmsv113", `maps/280030000/mobs/${mid}`, "TMS v113 廢礦補充");
    expect(find("monsters", mid, "maps", 280030000), "tmsv113", `monsters/${mid}/maps/280030000`, "TMS v113 廢礦補充");
  }
  for (const [iid, mid] of TMS_ITEM_DROPS) {
    expect(find("items", iid, "drops", mid), "tmsv113", `items/${iid}/drops/${mid}`, "TMS v113 端表");
    expect(find("monsters", mid, "drops", iid), "tmsv113", `monsters/${mid}/drops/${iid}`, "TMS v113 端表");
  }
  for (const [iid, mid] of RATE_ONLY_TMS) for (const [kind, key, target] of [["items", iid, mid], ["monsters", mid, iid]]) {
    const row = find(kind, key, "drops", target), label = `${kind}/${key}/drops/${target}`;
    expect(row, "monsterBook", label);
    check(!from(row, "tmsv113"), `${label}: 掉率來源 tmsv113 不能改寫 MonsterBook 關聯來源`);
  }
  for (const mid of [5300000, 5400000]) {
    const row = find("maps", 211000200, "mobs", mid);
    expect(row, "monsterBook", `maps/211000200/mobs/${mid}`, "怪物圖鑑標註");
    check(!from(row, "tmsv113"), `maps/211000200/mobs/${mid}: 不可將整個雪域標成跨版本補充`);
  }

  for (const [mid, iid, qid] of CLOSED_QUEST_DROPS) {
    check(!questIds.has(id(qid)), `四轉任務 ${qid} 混入預覽任務`);
    // Do not restore excluded quest-only items from the older live snapshot.
    // The immutable live baseline is checked separately.
    check(!itemIds.has(id(iid)), `四轉任務專用道具 ${iid} 不應靠條件掉落取得收錄資格`);
    check(!find("monsters", mid, "drops", iid), `monsters/${mid}/drops/${iid}: 四轉限定掉落混入一般掉落`);
    check(!find("items", iid, "drops", mid), `items/${iid}/drops/${mid}: 四轉限定掉落反向關聯未移除`);
  }
  for (const [mid, iid, qid] of OPEN_QUEST_DROPS) for (const [kind, key, target] of [["monsters", mid, iid], ["items", iid, mid]]) {
    const row = find(kind, key, "drops", target), label = `${kind}/${key}/drops/${target}`;
    expect(row, "quest", label);
    check(evidence(row).some((e) => e.source === "quest" && Array.isArray(e.questIds) && sameIds(e.questIds, [qid]) &&
      Array.isArray(e.questNames) && e.questNames.length === 1 && typeof e.questNames[0] === "string" && e.questNames[0].length > 0), `${label}: 現有任務掉落的任務 ID／名稱遺失`);
  }
  for (const doc of details.maps.values()) if (doc.dataMissing) for (const npc of doc.npcs) {
    const label = `maps/${doc.id}/npc/${npc.name}`;
    check(npc.referenceOnly === true, `${label}: NPC 文字位置來源須標記 referenceOnly`);
    check(evidence(npc).some((e) => ["quests-data.js", "items-data.js"].includes(e.referenceFile) &&
      ["startNpc", "endNpc", "shop", "craft"].includes(e.referenceKind) && /^\d+$/.test(id(e.referenceId))), `${label}: NPC 位置的原始檔案／引用身分遺失`);
  }
  return errors;
}

function checkLiveBaseline() {
  const output = execFileSync("git", ["ls-tree", "-r", "-z", LIVE_BASELINE, "--", "data/db", "assets/db"], { cwd: ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const entries = output.split("\0").filter(Boolean).map((line) => {
    const match = /^\d+ blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match) throw new Error(`無法解析正式資料基準: ${line}`);
    return { hash: match[1], file: match[2] };
  });
  if (!entries.length) throw new Error("正式資料基準為空；CI 需要 checkout fetch-depth: 0");
  const errors = [];
  for (const { hash, file } of entries) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) { errors.push(`正式檔案遭移除: ${file}`); continue; }
    let bytes = fs.readFileSync(full);
    // Respect Windows Git text checkout without masking actual JSON changes.
    if (file.endsWith(".json")) bytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
    const actual = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (actual !== hash) errors.push(`預覽匯入不可修改正式檔案: ${file}`);
  }
  const expected = entries.filter((e) => e.file.startsWith("data/db/")).map((e) => e.file.slice(8));
  if (!sameIds(jsonFiles(path.join(ROOT, "data/db")), expected)) errors.push("data/db: 預覽匯入增減了正式資料檔案");
  return errors;
}

function checkImages(bundle) {
  const errors = [], inspected = new Set(); let missing = 0;
  function imageFile(relative, required = false) {
    if (inspected.has(relative)) return;
    inspected.add(relative);
    const full = path.join(ROOT, "assets/db", relative);
    if (!fs.existsSync(full)) {
      missing++;
      if (required) errors.push(`圖片旗標宣稱存在但缺檔: assets/db/${relative}`);
      return;
    }
    const bytes = fs.readFileSync(full);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0) {
      errors.push(`圖片不是有效 PNG: assets/db/${relative}`);
    }
  }
  for (const kind of ["monsters", "items", "skills", "maps", "npcs"]) {
    for (const doc of bundle.details[kind].values()) {
      imageFile(`${kind}/${doc.id}.png`, kind === "maps" ? doc.hasMini === true : kind === "npcs" && doc.img === true);
      if (kind === "maps" && doc.mark) imageFile(`marks/${doc.mark}.png`);
    }
  }
  for (const region of bundle.world) imageFile(`worldmaps/${region.key}.png`);
  for (const doc of bundle.details.quests.values()) {
    for (const row of [...doc.start.items, ...doc.complete.items, ...doc.rewards.items]) imageFile(`items/${row.id}.png`);
    for (const row of doc.complete.monsters) imageFile(`monsters/${row.id}.png`);
    for (const row of doc.rewards.skills) imageFile(`skills/${row.id}.png`);
  }
  const overrides = path.join(ROOT, "tools/icon_overrides");
  let overrideCount = 0;
  for (const entry of fs.readdirSync(overrides, { withFileTypes: true })) if (entry.isDirectory()) {
    for (const file of fs.readdirSync(path.join(overrides, entry.name)).filter((f) => f.endsWith(".png"))) {
      overrideCount++;
      const actual = path.join(ROOT, "assets/db", entry.name, file);
      if (!fs.existsSync(actual) || !fs.readFileSync(actual).equals(fs.readFileSync(path.join(overrides, entry.name, file)))) errors.push(`人工圖示校正被覆蓋: ${entry.name}/${file}`);
    }
  }
  if (overrideCount < 14) errors.push("人工圖示校正清單少於已確認的 14 張");
  console.log(`圖片：檢查 ${inspected.size} 個引用，${missing} 個缺圖保留誠實缺席；${overrideCount} 張人工校正比對`);
  return errors;
}

function checkKnownFixes(bundle) {
  const errors = [];
  for (const [label, folder] of [["正式", path.join(ROOT, "data/db")], ["預覽", PREVIEW]]) {
    const shops = label === "預覽" ? bundle.shops : readJson(path.join(folder, "shops.json"));
    const jane = shops.find((s) => id(s.id) === "1002100");
    const npc = readJson(path.join(folder, "npcs/1002100.json"));
    const potion = readJson(path.join(folder, "items/2000002.json"));
    if (jane?.items.find((i) => id(i.id) === "2000002")?.price !== 310 || npc.shop.find((i) => id(i.id) === "2000002")?.price !== 310 || potion.shops.find((s) => s.npc === "珍")?.price !== 310) errors.push(`${label}: 珍的白色藥水 2000002 必須在三處都為 310`);
    const index = label === "預覽" ? bundle.indexes.monsters : readJson(path.join(folder, "monsters.json"));
    const pig = readJson(path.join(folder, "monsters/4230103.json"));
    if (index.find((m) => id(m.id) === "4230103")?.exp !== 99 || pig.stats.exp !== 99) errors.push(`${label}: 鋼之肥肥 4230103 必須為 99 EXP`);
    if (!index.find((m) => id(m.id) === "9300060")?.name.includes("任務版")) errors.push(`${label}: 任務版鋼之肥肥必須清楚標示`);
  }
  return errors;
}

function compareImport(snapshot) {
  const before = path.resolve(snapshot), errors = [];
  const realBefore = fs.realpathSync(before), realPreview = fs.realpathSync(PREVIEW);
  if ((process.platform === "win32" ? realBefore.toLowerCase() === realPreview.toLowerCase() : realBefore === realPreview)) throw new Error("--compare 必須指向上次匯入的獨立快照，不能與目前預覽相同");
  const files = jsonFiles(PREVIEW), oldFiles = jsonFiles(before);
  if (!sameIds(files, oldFiles)) errors.push("重複匯入: JSON 檔名／筆數改變");
  for (const file of files) if (oldFiles.includes(file)) {
    const a = fs.readFileSync(path.join(PREVIEW, file), "utf8").replace(/\r\n/g, "\n");
    const b = fs.readFileSync(path.join(before, file), "utf8").replace(/\r\n/g, "\n");
    if (a !== b) errors.push(`重複匯入輸出不穩定: ${file}`);
  }
  console.log(`重複匯入：比對 ${files.length} 個 JSON（含 manifest 與所有筆數）`);
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--compare")) throw new Error("用法: node tools/test_el_nath.js [--compare <previous-preview-directory>]");
  const bundle = readPreview();
  const errors = [...checkLiveBaseline(), ...validatePreview(bundle, readLive()), ...checkImages(bundle), ...checkKnownFixes(bundle)];
  if (args.length) errors.push(...compareImport(args[1]));
  console.log(KINDS.map((kind) => `${kind} ${bundle.indexes[kind].length}`).join("、"));
  if (errors.length) {
    for (const error of errors.slice(0, 100)) console.error(`::error::${error}`);
    if (errors.length > 100) console.error(`另有 ${errors.length - 100} 項；先修正以上問題後重跑。`);
    console.error(`冰原雪域預覽驗證失敗：${errors.length} 項`);
    process.exitCode = 1;
  } else console.log("冰原雪域預覽驗證通過：六種資料／連結／12 條三轉路線／正式資料與圖片保護");
}

module.exports = { readPreview, readLive, validatePreview, validateProvenance, checkLiveBaseline, compareImport };
if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
