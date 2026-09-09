(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MapleSkillText = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Pure display helpers for the imported skill-detail schema:
  // { id, name, labels: { field: label }, levels: [{ level, desc, values }] }.
  // Returns plain text / a fresh label map. HTML escaping belongs to the caller.
  // No values, descriptions, units or percentages are recalculated here.
  //
  // Evidence: the 2026-09-03 snapshot, skills-data.js (2026-09-03), all 89 imported
  // adventurer third-job skills / 2,330 levels. valueLabels contains heuristic
  // labels, NOT authoritative field semantics: xAddHun/xSubHun are reused for
  // EXP and extra damage; y can be either duration or a skill interval.
  // Corrections require BOTH the exact ID and source name. Never match a job,
  // name substring, or a shared field alone. Each comment quotes the source
  // level text that supports the correction; only observed keys are returned.
  const CORRECTIONS = {
    // "MP恢復增加30"; "盾牌的物理防禦力增加100％".
    1110000: ["魔力恢復", { mp: "MP 恢復增加" }],
    1210000: ["魔力恢復", { mp: "MP 恢復增加" }],
    1110001: ["盾防精通", { x: "盾牌物理防禦力增加（%）" }],
    1210001: ["盾防精通", { x: "盾牌物理防禦力增加（%）" }],
    4210000: ["強化盾", { x: "盾牌物理防禦力增加（%）" }],
    // "攻擊力220%, 最高鬥氣量5"; do not turn 220% into +220%.
    1111002: ["鬥氣集中", { z: "攻擊力（%）", x: "最高鬥氣量" }],
    // "按攻擊力5％減少HP" versus "每4秒 HP20減少".
    1311005: ["龍之獻祭", { x: "HP 減少占攻擊力（%）" }],
    1311008: ["龍之魂", { x: "每 4 秒 HP 減少量" }],
    // "消耗MP30、HP30% ... 技能間隔時間2秒"; not buff duration.
    1311006: ["龍咆哮", { x: "消耗 HP（%）", y: "技能間隔時間（秒）" }],
    // "消耗MP200%, 魔法攻擊力增加到140%"; these are percentages,
    // not flat MP cost or a flat addition to the character's magic attack.
    2110001: ["魔力激發", { x: "消耗 MP（%）", y: "魔法攻擊力倍率（%）" }],
    2210001: ["魔力激發", { x: "消耗 MP（%）", y: "魔法攻擊力倍率（%）" }],
    // The following seven skills explicitly say "基本攻擊力", not a stat buff.
    2111002: ["末日烈焰", { mad: "基本攻擊力" }],
    2111003: ["致命毒霧", { mad: "基本攻擊力" }],
    2111006: ["火毒合擊", { mad: "基本攻擊力" }],
    2211002: ["冰風暴", { mad: "基本攻擊力" }],
    2211003: ["落雷凝聚", { mad: "基本攻擊力" }],
    2211006: ["冰雷合擊", { mad: "基本攻擊力" }],
    2311004: ["聖光", { mad: "基本攻擊力" }],
    // "適用範圍 300" has no unit; do not invent pixels or a percentage.
    2311001: ["淨化", { rb: "適用範圍" }],
    // "隊員的取得經驗值150%" means the displayed total, not a +150% bonus.
    2311003: ["神聖祈禱", { xAddHun: "隊員取得經驗值（%）", y: "持續時間（秒）" }],
    // "召喚攻擊力150的龍"; eagle/octopus/seagull descriptions identify
    // summoned attackers. These fields are not additions to player stats.
    2311006: ["聖龍召喚", { mad: "召喚龍攻擊力" }],
    3111005: ["銀鷹召喚", { pad: "召喚銀鷹攻擊力", prop: "自動出擊機率（%）" }],
    3211005: ["金鷹召喚", { pad: "召喚金鷹攻擊力", prop: "自動出擊機率（%）" }],
    5211001: ["章魚砲台", { pad: "召喚章魚攻擊力" }],
    5211002: ["海鷗突擊隊", { pad: "召喚海鷗攻擊力" }],
    // "90%機率發動 ... 敵人的HP為50%以下 ... 10%的機率該敵人會必死".
    3110001: ["致命箭", { prop: "發動機率（%）", x: "敵人 HP 門檻（%）", y: "即死機率（%）" }],
    3210001: ["致命箭", { prop: "發動機率（%）", x: "敵人 HP 門檻（%）", y: "即死機率（%）" }],
    // "恢復量150%, 增加適用時間150%": preserve the source percentage;
    // do not rewrite the ambiguous wording as +150% or perform subtraction.
    4110000: ["藥劑精通", { x: "恢復量（%）", y: "適用時間（%）" }],
    // "恢復中被怪物攻擊所受到的傷害為70%", not outgoing damage.
    4211001: ["血魔轉換", { x: "恢復中承受傷害（%）", y: "恢復力（%）" }],
    // "消耗的楓幣為抵擋傷害的78%", not the amount of damage blocked.
    4211005: ["楓幣護盾", { x: "楓幣消耗占抵擋傷害（%）" }],
    // "20個引爆可能" + description "引爆前方地面上掉落的金錢".
    4211006: ["楓幣炸彈", { attackCount: "可引爆楓幣數", MesoExM: "楓幣炸彈熟練度（%）" }],
    // "以60%的機率，向敵人造成60%的額外殺傷力。" No combo consumption.
    5110000: ["致命暗襲", { xSubHun: "額外殺傷力（%）", prop: "發動機率（%）" }],
    // "生命力恢復量為殺傷力的20%".
    5111004: ["損人利己", { x: "HP 恢復占殺傷力（%）" }],
    // "增加物理、魔法防禦力40"; the single pdd field covers both here.
    5111005: ["鬥神附體", { pdd: "物理／魔法防禦力增加" }],
  };

  function levels(d) {
    return d && Array.isArray(d.levels) ? d.levels : [];
  }

  function labelMap(d) {
    const source = d && d.labels && typeof d.labels === "object" && !Array.isArray(d.labels)
      ? d.labels : {};
    const keys = new Set(Object.keys(source));
    levels(d).forEach((row) => Object.keys((row && row.values) || {}).forEach((key) => keys.add(key)));
    const entry = d && Object.prototype.hasOwnProperty.call(CORRECTIONS, d.id) ? CORRECTIONS[d.id] : null;
    const corrections = entry && entry[0] === d.name ? entry[1] : {};
    return Object.fromEntries([...keys].map((key) => {
      if (Object.prototype.hasOwnProperty.call(corrections, key)) return [key, corrections[key]];
      // These are algebraic source keys, not universal combo semantics. An
      // unreviewed ID/name must display the raw key rather than the misleading
      // global upstream fallback. Never derive semantics from its numeric value.
      if (key === "xAddHun" || key === "xSubHun") return [key, key];
      // Keep other per-skill source labels (including neutral "效果值").
      // Unknown fields without labels keep their raw keys; do not invent units.
      return [key, typeof source[key] === "string" && source[key].trim() ? source[key] : key];
    }));
  }

  function levelNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") return NaN;
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : NaN;
  }

  // effect(d) / effect(d, null): highest actual source level (even if unsorted).
  // effect(d, 1) / effect(d, "1"): that exact level. Invalid/missing levels or
  // missing/unresolved level descriptions return "" for the caller's empty state.
  // Do NOT fall back to formula or d.desc: they may contain placeholders, static
  // Lv.1 examples, different punctuation/units, or omit Chinese-number effects.
  function effect(d, level) {
    const rows = levels(d).filter((row) => row && Number.isFinite(levelNumber(row.level)));
    const wanted = level == null ? Math.max(0, ...rows.map((row) => levelNumber(row.level))) : levelNumber(level);
    const row = rows.find((candidate) => levelNumber(candidate.level) === wanted);
    if (!row || typeof row.desc !== "string") return "";
    const text = row.desc.trim();
    return /#[A-Za-z_][A-Za-z0-9_]*/.test(text) ? "" : text;
  }

  return Object.freeze({ labels: labelMap, effect });
});
