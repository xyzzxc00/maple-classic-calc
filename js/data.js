/**
 * data.js — 資料層
 * -----------------------------------------------------------------
 * 重要說明：
 * 這裡的數值目前是「佔位用的估算公式」，不是官方真實數據。
 * 楓之谷經典版的正式經驗值表，要等官方公告或封測玩家測出來才能確定。
 *
 * 你只需要在封測/上線後，把下面 EXP_TABLE 換成真實數值（陣列或公式皆可），
 * 其他計算邏輯（calculator.js）完全不用改，UI 也不用改。
 * 這就是「資料層 / 計算層分離」的好處。
 * -----------------------------------------------------------------
 */

// ===== 1. 等級所需經驗值表 =====
// 真實數據確定後，建議直接整張表貼上去（index 0 = Lv.1 升 Lv.2 所需經驗）
// 目前先用近似舊楓之谷曲線的公式產生 1~200 等的佔位數值。
function generatePlaceholderExpTable(maxLevel = 300) {
  const table = [];
  for (let lv = 1; lv <= maxLevel; lv++) {
    // 簡單的遞增曲線，僅供畫面/邏輯測試用，非真實數值
    const base = Math.round(20 * Math.pow(lv, 2.2) + 50 * lv);
    table.push(base);
  }
  return table;
}

const EXP_TABLE = generatePlaceholderExpTable(300);
// 之後要換真實表時，範例：
// const EXP_TABLE = [15, 34, 57, 92, 135, ...]; // index 0 對應 Lv.1

// ===== 2. 練等地點 / 怪物效率資料（佔位）=====
// 等封測資料出來後，把每個地點的怪物 EXP、建議等級填進去即可。
const GRINDING_SPOTS = [
  {
    id: "spot_placeholder_1",
    name: "（待補）楓葉村周邊",
    levelRange: [1, 15],
    monsterExp: null,   // 單隻怪物 EXP，待補
    expPerHour: null,   // 預估每小時經驗，待補
    note: "封測開始後更新真實怪物與地圖資訊",
  },
  {
    id: "spot_placeholder_2",
    name: "（待補）中階練功地圖",
    levelRange: [15, 35],
    monsterExp: null,
    expPerHour: null,
    note: "封測開始後更新",
  },
  {
    id: "spot_placeholder_3",
    name: "（待補）高階練功地圖",
    levelRange: [35, 70],
    monsterExp: null,
    expPerHour: null,
    note: "封測開始後更新",
  },
];

// ===== 3. 任務一次性經驗（佔位）=====
// 經典版常見的「新手引導任務」「轉職任務」會給一次性大量經驗，先留空位之後填。
const QUEST_EXP = [
  { id: "quest_first_job", name: "（待補）一轉任務", exp: null },
  { id: "quest_second_job", name: "（待補）二轉任務", exp: null },
];

// 匯出（純瀏覽器環境用全域變數，不使用 ES module，避免要架建置流程）
window.MapleData = {
  EXP_TABLE,
  GRINDING_SPOTS,
  QUEST_EXP,
};
