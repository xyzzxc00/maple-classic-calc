/**
 * attackData.js — 攻擊力計算機資料（舊楓之谷 Big Bang 前公式）
 * -----------------------------------------------------------------
 * 物理攻擊公式／武器係數表：交叉核對過 SouthPerry 公式彙整（Ayumilove/
 * exoot.blogspot.com 轉載版本一致）、巴哈姆特舊制討論串、PTT 楓之谷板
 * 2010年大改版前夕的討論文，三個獨立來源數字一致，信心度高：
 *   最大攻擊 = (主屬性 × 武器係數 + 副屬性) × 武器攻擊力 ÷ 100
 *   最小攻擊 = (主屬性 × 武器係數 × 0.9 × 熟練度 + 副屬性) × 武器攻擊力 ÷ 100
 * 熟練度是小數（例如 60% 熟練度代入 0.6），未點技能時基礎值是 10%。
 *
 * 法師的魔法攻擊力採用巴哈姆特新楓之谷哈啦板 2008 年文章公佈的公式
 * （文章發表時間確認在 2008 年，早於 2010 年 Big Bang 大改版，且是台版
 * 資料，故採信度優先於英文 SouthPerry 版本）：
 *   最大攻擊 = (魔攻×3.3 + 魔攻²×0.003365 + 智力×0.5) × 技能攻擊力/100
 *              × 加成% - 怪物魔防/3
 *   最小攻擊 = (魔攻×3.3×熟練度×0.9 + 魔攻²×0.003365 + 智力×0.5)
 *              × 技能攻擊力/100 × 加成% - 怪物魔防/3
 * 加成% = 屬性相剋加成(150%) × 魔力激發(135%) × 屬性杖加成(75~125%)，
 * 三種都是選用的加成，沒有的話就是 100%。小數點無條件捨去（只在最後
 * 算完一次取整數，中間步驟不提前捨去，這點跟原文的算例核對過)。
 * -----------------------------------------------------------------
 */
const ATTACK_WEAPON_TYPES = [
  { id: "sword1h", branch: "劍士系", label: "單手劍", type: "physical", mainStat: "str", coef: 4.0, subStats: ["dex"] },
  { id: "axe1h_swing", branch: "劍士系", label: "單手斧（揮砍）", type: "physical", mainStat: "str", coef: 4.4, subStats: ["dex"] },
  { id: "axe1h_stab", branch: "劍士系", label: "單手斧（穿刺）", type: "physical", mainStat: "str", coef: 3.2, subStats: ["dex"] },
  { id: "mace1h_swing", branch: "劍士系", label: "單手棍（揮砍）", type: "physical", mainStat: "str", coef: 4.4, subStats: ["dex"] },
  { id: "mace1h_stab", branch: "劍士系", label: "單手棍（穿刺）", type: "physical", mainStat: "str", coef: 3.2, subStats: ["dex"] },
  { id: "sword2h", branch: "劍士系", label: "雙手劍", type: "physical", mainStat: "str", coef: 4.6, subStats: ["dex"] },
  { id: "axe2h_swing", branch: "劍士系", label: "雙手斧（揮砍）", type: "physical", mainStat: "str", coef: 4.8, subStats: ["dex"] },
  { id: "axe2h_stab", branch: "劍士系", label: "雙手斧（穿刺）", type: "physical", mainStat: "str", coef: 3.4, subStats: ["dex"] },
  { id: "mace2h_swing", branch: "劍士系", label: "雙手棍（揮砍）", type: "physical", mainStat: "str", coef: 4.8, subStats: ["dex"] },
  { id: "mace2h_stab", branch: "劍士系", label: "雙手棍（穿刺）", type: "physical", mainStat: "str", coef: 3.4, subStats: ["dex"] },
  { id: "spear_swing", branch: "劍士系", label: "槍（揮砍）", type: "physical", mainStat: "str", coef: 3.0, subStats: ["dex"] },
  { id: "spear_stab", branch: "劍士系", label: "槍（穿刺）", type: "physical", mainStat: "str", coef: 5.0, subStats: ["dex"] },
  { id: "polearm_swing", branch: "劍士系", label: "矛（揮砍）", type: "physical", mainStat: "str", coef: 5.0, subStats: ["dex"] },
  { id: "polearm_stab", branch: "劍士系", label: "矛（穿刺）", type: "physical", mainStat: "str", coef: 3.0, subStats: ["dex"] },
  { id: "bow", branch: "弓箭手系", label: "弓", type: "physical", mainStat: "dex", coef: 3.4, subStats: ["str"] },
  { id: "crossbow", branch: "弓箭手系", label: "弩", type: "physical", mainStat: "dex", coef: 3.6, subStats: ["str"] },
  { id: "dagger_thief", branch: "盜賊系", label: "短劍／飛鏢／拳套（爪）", type: "physical", mainStat: "luk", coef: 3.6, subStats: ["str", "dex"] },
  { id: "knuckle", branch: "海盜系", label: "拳套（格鬥）", type: "physical", mainStat: "str", coef: 4.8, subStats: ["dex"] },
  { id: "gun", branch: "海盜系", label: "火槍", type: "physical", mainStat: "dex", coef: 3.6, subStats: ["str"] },
  { id: "staff_wand", branch: "法師系", label: "法杖／魔杖", type: "magic" },
];

// 熟練度技能等級對照（1轉武器熟練技能：劍術/斧術/弓術/弩術/短劍/拳套熟練），
// 給使用者輸入熟練度%時參考用，不是計算機自動代入的資料——4轉的「達人」
// 系技能會再往上加，數字查證上沒有一次到位，讓使用者照自己技能視窗
// 顯示的熟練度直接輸入比較不會出錯。
const MASTERY_REFERENCE_TABLE = [
  { level: 0, pct: 10 },
  { level: 2, pct: 15 },
  { level: 4, pct: 20 },
  { level: 6, pct: 25 },
  { level: 8, pct: 30 },
  { level: 10, pct: 35 },
  { level: 12, pct: 40 },
  { level: 14, pct: 45 },
  { level: 16, pct: 50 },
  { level: 18, pct: 55 },
  { level: 20, pct: 60 },
];

window.MapleAttackWeaponTypes = ATTACK_WEAPON_TYPES;
window.MapleMasteryReferenceTable = MASTERY_REFERENCE_TABLE;
