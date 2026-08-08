/**
 * attackData.js — 攻擊力計算機資料（舊楓之谷 Big Bang 前公式）
 * -----------------------------------------------------------------
 * 物理攻擊公式／武器係數表：交叉核對過 SouthPerry 公式彙整（Ayumilove/
 * exoot.blogspot.com 轉載版本一致）、巴哈姆特舊制討論串、PTT 楓之谷板
 * 2010年大改版前夕的討論文，三個獨立來源數字一致，信心度高：
 *   最大攻擊 = (主屬性 × coefMax + 副屬性) × 攻擊力 ÷ 100
 *   最小攻擊 = (主屬性 × coefMin × 0.9 × 熟練度 + 副屬性) × 攻擊力 ÷ 100
 * 「攻擊力」= 武器攻擊力＋彈藥攻擊力（飛鏢/箭矢/子彈，見 ammoLabel）。
 * 熟練度是小數（例如 60% 熟練度代入 0.6），未點技能時基礎值是 10%。
 * 二轉精通技能逐級表（Lv1=15%…Lv19=60%）已與經典版拆包資料逐字核對一致。
 *
 * 法師的魔法攻擊力採用 SouthPerry 公式彙整串（t=855，Russt 2008-07 發文，
 * Wayback 2009-03 存檔）的原式；巴哈 2008 年〈魔法攻擊力計算公式〉文
 * （bsn=7650&sn=2754939，抄自虛華計算機）的 3.3／0.003365 是同一條式子
 * 的 ±1% 近似擬合，兩版結果差距不到 1%，採證據鏈較強的 SouthPerry 版：
 *   最大攻擊 = ((魔攻²/1000 + 魔攻)/30 + 智力/200) × 技能攻擊力 × 加成%
 *              - 怪物魔防×0.5×(1 + 0.01×等級差)
 *   最小攻擊 = ((魔攻²/1000 + 魔攻×熟練度×0.9)/30 + 智力/200) × 技能攻擊力
 *              × 加成% - 怪物魔防×0.6×(1 + 0.01×等級差)
 * 熟練度×0.9 只作用在線性魔攻項（SouthPerry 與巴哈原文寫法一致）；
 * 等級差 = max(0, 怪物等級 - 角色等級)。魔防扣法兩版不同（巴哈版是
 * 「-魔防/3」且最大最小扣同一數），SouthPerry 版有實測掛名與兩個時間點
 * 版本互證，證據較強，故採之。「魔攻」直接用角色資訊視窗顯示的數值
 * （巴哈原文算例與 2008 年官服實測文都是這樣代入）。
 * 加成% = 屬性相剋(剋屬150%／被抵抗50%) × 魔力激發(140%，三轉火毒/冰雷
 * 限定技能；經典版客戶端拆包 Lv30=魔攻140%，採用的是後期 pre-BB 數值，
 * 不是 2008 年代文獻寫的 135%) × 屬性杖(全符合
 * 125%／部分符合110%／不符合75%——不符合檔有 2008 年官服實測 70% 的
 * 出入紀錄，暫採巴哈版 75%)。加成都是選用，沒有就是 100%，乘算在扣
 * 魔防之前。小數點只在最後算完一次無條件捨去。
 * -----------------------------------------------------------------
 */
// 斧/棍/槍/矛有揮砍、穿刺兩種出招動作、各用各的係數（普攻隨機出招）。
// 遊戲內資訊視窗顯示的攻擊力範圍是合併值：上限取兩係數中較高的、下限取
// 較低的，所以這裡每種武器只列一個選項，用 coefMax/coefMin 分別對應
// （玩家不會知道自己下一下是砍還是戳，分開列反而對不上視窗數字）。
// 單一出招的武器兩個係數相同。
// ammoLabel：拳套（飛鏢）、弓弩（箭矢）、火槍（子彈）的彈藥本身有攻擊力，
// 計算時和武器攻擊力相加，UI 依此欄位顯示對應的選填輸入框。
const ATTACK_WEAPON_TYPES = [
  { id: "sword1h", branch: "劍士系", label: "單手劍", type: "physical", mainStat: "str", coefMax: 4.0, coefMin: 4.0, subStats: ["dex"] },
  { id: "axe1h", branch: "劍士系", label: "單手斧", type: "physical", mainStat: "str", coefMax: 4.4, coefMin: 3.2, subStats: ["dex"] },
  { id: "mace1h", branch: "劍士系", label: "單手棍", type: "physical", mainStat: "str", coefMax: 4.4, coefMin: 3.2, subStats: ["dex"] },
  { id: "sword2h", branch: "劍士系", label: "雙手劍", type: "physical", mainStat: "str", coefMax: 4.6, coefMin: 4.6, subStats: ["dex"] },
  { id: "axe2h", branch: "劍士系", label: "雙手斧", type: "physical", mainStat: "str", coefMax: 4.8, coefMin: 3.4, subStats: ["dex"] },
  { id: "mace2h", branch: "劍士系", label: "雙手棍", type: "physical", mainStat: "str", coefMax: 4.8, coefMin: 3.4, subStats: ["dex"] },
  { id: "spear", branch: "劍士系", label: "槍", type: "physical", mainStat: "str", coefMax: 5.0, coefMin: 3.0, subStats: ["dex"] },
  { id: "polearm", branch: "劍士系", label: "矛", type: "physical", mainStat: "str", coefMax: 5.0, coefMin: 3.0, subStats: ["dex"] },
  { id: "bow", branch: "弓箭手系", label: "弓", type: "physical", mainStat: "dex", coefMax: 3.4, coefMin: 3.4, subStats: ["str"], ammoLabel: "箭矢攻擊力" },
  { id: "crossbow", branch: "弓箭手系", label: "弩", type: "physical", mainStat: "dex", coefMax: 3.6, coefMin: 3.6, subStats: ["str"], ammoLabel: "箭矢攻擊力" },
  { id: "dagger", branch: "盜賊系", label: "短劍", type: "physical", mainStat: "luk", coefMax: 3.6, coefMin: 3.6, subStats: ["str", "dex"] },
  { id: "claw", branch: "盜賊系", label: "拳套／飛鏢", type: "physical", mainStat: "luk", coefMax: 3.6, coefMin: 3.6, subStats: ["str", "dex"], ammoLabel: "飛鏢攻擊力" },
  { id: "knuckle", branch: "海盜系", label: "指虎", type: "physical", mainStat: "str", coefMax: 4.8, coefMin: 4.8, subStats: ["dex"] },
  { id: "gun", branch: "海盜系", label: "火槍", type: "physical", mainStat: "dex", coefMax: 3.6, coefMin: 3.6, subStats: ["str"], ammoLabel: "子彈攻擊力" },
  { id: "staff_wand", branch: "法師系", label: "法杖／魔杖", type: "magic" },
];

// 熟練度技能等級對照（二轉武器熟練技能：劍/斧/棍/槍矛/弓/弩/標飛/短劍熟練等），
// 給使用者輸入熟練度%時參考用，不是計算機自動代入的資料——4轉的「達人」
// 系技能會再往上加，數字查證上沒有一次到位，讓使用者照自己技能視窗
// 顯示的熟練度直接輸入比較不會出錯。
// 熟練度% = 10 + 5×⌈技能等級/2⌉（奇數級就跳升：Lv1=15%、Lv19=60%），
// 巴哈攻略百科舊版計算公式頁與 Ayumilove 2008 技能表逐級核對一致。
const MASTERY_REFERENCE_TABLE = [
  { level: 0, pct: 10 },
  { level: 1, pct: 15 },
  { level: 3, pct: 20 },
  { level: 5, pct: 25 },
  { level: 7, pct: 30 },
  { level: 9, pct: 35 },
  { level: 11, pct: 40 },
  { level: 13, pct: 45 },
  { level: 15, pct: 50 },
  { level: 17, pct: 55 },
  { level: 19, pct: 60 },
];

window.MapleAttackWeaponTypes = ATTACK_WEAPON_TYPES;
window.MapleMasteryReferenceTable = MASTERY_REFERENCE_TABLE;
