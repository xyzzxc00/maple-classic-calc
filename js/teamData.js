/**
 * teamData.js — 揪團公告板的目標清單資料
 * -----------------------------------------------------------------
 * 「目標」欄位刻意做成下拉選單、不開放自由輸入，理由跟練功地點下拉選單
 * 一樣：擋掉亂打字，也順便防灑水。這裡的野王清單直接複用 legacySpotsData.js
 * 的 LEGACY_BOSSES／LEGACY_BOSS_PREQUESTS，不重新維護一份；組隊任務清單
 * 是另外整理的，因為原始資料裡沒有現成的「哪些任務需要組隊」清單。
 * -----------------------------------------------------------------
 */

// 王團目標＝野王清單（LEGACY_BOSSES）＋ 3 隻需要組隊前置的大頭目
// （LEGACY_BOSS_PREQUESTS），兩份資料的來源見 legacySpotsData.js 開頭說明
const TEAM_BOSS_TARGETS = [
  ...(window.MapleLegacyBosses || []).map((b) => b.monster),
  ...(window.MapleLegacyBossPrequests || []).map((b) => b.boss),
];

// 組隊任務目標：轉職三個階段裡實際需要組隊/時限副本的部分（二轉黑珠試煉
// 單人也能打，但等級到了常常會約人一起衝比較快，一併列入），加上三隻
// 大頭目各自的前置任務（前置流程本身很長，很多步驟玩家會揪團分工）
const TEAM_QUEST_TARGETS = [
  "二轉試煉（黑珠蒐集）",
  "三轉試煉（次元之門）",
  "四轉試煉（秘咒任務）",
  "殘暴炎魔前置任務",
  "闇黑龍王前置任務（6人副本）",
  "拉圖斯前置任務",
];

const TEAM_SERVERS = ["雪吉拉", "菇菇寶貝"];

window.MapleTeamBossTargets = TEAM_BOSS_TARGETS;
window.MapleTeamQuestTargets = TEAM_QUEST_TARGETS;
window.MapleTeamServers = TEAM_SERVERS;
