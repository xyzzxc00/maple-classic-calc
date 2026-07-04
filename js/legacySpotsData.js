/**
 * legacySpotsData.js — 舊版練功地點參考資料
 * -----------------------------------------------------------------
 * 這裡整理的是「Big Bang 大改版之前」舊版楓之谷的練功地點，不是台版
 * 經典版的即時回報（那個在「建議練功地點」分頁，讀的是玩家在社群資料
 * 庫回報的真實效率）。Lv.1~115 的怪物/地點資料是對照巴哈姆特新楓之谷
 * 精華區的「怪物分布地區」整理文核對的，同一隻怪常常會出現在好幾張
 * 地圖，這裡盡量把查得到的地圖都列出來，讓玩家多一些選擇，不是只給
 * 一個地方。Lv.135 以後的資料點是私服攻略站交叉比對的（跟 Lv.1~115
 * 不同來源），這個區間本身也是以王級怪物為主，可選地圖本來就比較少。
 * 職業別的效率差異來源沒有特別標注，所以這裡故意不寫「這裡適合哪個
 * 職業」，避免比等級/地圖本身更容易出錯的猜測。
 * -----------------------------------------------------------------
 */
const LEGACY_SPOTS = [
  {
    levelRange: "1～3",
    entries: [
      { level: "1", monster: "嫩寶", locations: "維多利亞港郊外、海岸草叢I" },
      { level: "2", monster: "菇菇仔", locations: "菇菇山、弓箭手訓練場I、弓箭手村東部小山" },
      { level: "2", monster: "藍寶", locations: "海岸草叢I～III、弓箭手訓練場I、弓箭手村東部小山、勇士之村東入口" },
    ],
  },
  {
    levelRange: "4～7",
    entries: [
      { level: "4", monster: "紅寶", locations: "海岸草叢I～III、魔法森林北郊、大木林I、弓箭手村西部小山、勇士之村西/東入口、東石岩石山I、墮落城市南方工地/北入口" },
      { level: "4", monster: "木妖", locations: "魔法森林南郊、勇士之村西入口/西部/東入口/東部、東石岩石山I&II、岩石路I&II" },
      { level: "6", monster: "綠水靈", locations: "魔法森林南北部訓練場、智慧森林、大木林I&II、弓箭手村西部森林/小山、歷恩森林I、墮落城市南北方工地/北入口、青蛇濕地" },
      { level: "7", monster: "肥肥", locations: "三叉路、海岸狩獵場、肥肥海岸、弓箭手村西部森林/小山、弓箭手訓練場I&II、歷恩森林I" },
    ],
  },
  {
    levelRange: "8～10",
    entries: [
      { level: "8", monster: "菇菇寶貝", locations: "三叉路、弓箭手村西部森林、菇菇山、弓箭手訓練場II&III、歷恩森林I～III、墮落城市南北方工地/北入口" },
      { level: "10", monster: "黑木妖", locations: "魔法森林南部、北部森林訓練場II、大木林II&III、勇士之村西入口/西部/東部、東石岩石山III、岩石路I～III" },
      { level: "10", monster: "緞帶肥肥", locations: "海岸狩獵場、肥肥海岸、弓箭手訓練場II&III、弓箭手村東部森林、歷恩森林II&III、墮落城市森林I" },
    ],
  },
  {
    levelRange: "12～17",
    entries: [
      { level: "12", monster: "三眼章魚", locations: "北部森林訓練場III、墮落城市森林I、墮落城市南方工地、北方工地頂端" },
      { level: "15", monster: "綠菇菇", locations: "北部森林訓練場IV、弓箭手訓練場II&III、西部岩山II、墮落城市森林I&II、大木林III、菇菇山" },
      { level: "15", monster: "藍水靈", locations: "南部森林訓練場III&IV、北部森林訓練場V、墮落城市森林II、北方工地頂端、地鐵一號線" },
      { level: "17", monster: "斧木妖", locations: "北部森林訓練場VI、西部岩石II、西部岩山III、幽深的峽谷I&II、東石岩石山III～V" },
    ],
  },
  {
    levelRange: "19～20",
    entries: [
      { level: "19", monster: "古木妖", locations: "幽深的峽谷I～III、遺跡發掘地I&II" },
      { level: "20", monster: "蝙蝠", locations: "地鐵一號線區域02&03、轉乘區、黑暗通道、蝙蝠洞" },
      { level: "20", monster: "藍菇菇", locations: "藍菇菇森林、石人寺院門外、迷宮通道、弓箭手村迷宮入口、墮落城市森林III" },
    ],
  },
  {
    levelRange: "21～25",
    entries: [
      { level: "21", monster: "青蛇", locations: "沼澤地I～III、青蛇濕地、鱷魚潭I&II、猴子沼澤地I～III、地鐵二號線" },
      { level: "22", monster: "刺菇菇", locations: "北部森林訓練場VII、藍菇菇森林、迷宮通道、黑森林系列、螞蟻洞I～IV、幽深螞蟻洞、螞蟻礦坑" },
      { level: "22", monster: "黑斧木妖", locations: "西部岩山III&IV、勇士之村迷宮入口、幽深的峽谷III、黑肥肥領土II、東石岩石山IV～VI、黑森林西入口" },
      { level: "23～24", monster: "木面怪人／石面怪人", locations: "遺跡發掘地I～III" },
      { level: "24", monster: "黑肥肥", locations: "危險的峽谷I、火焰之地I、黑肥肥領土I&II、東石岩石山VI&VII" },
      { level: "24", monster: "殭屍菇菇", locations: "弓箭手村迷宮入口、西部岩山IV、黑森林系列、螞蟻洞、蘑菇王之墓" },
      { level: "25", monster: "火獨眼獸", locations: "北部森林訓練場VIII、黑森林通道、黑森林狩獵場I、幽深螞蟻洞、螞蟻礦坑、火獨眼獸洞穴I～IV" },
    ],
  },
  {
    levelRange: "30～35",
    entries: [
      { level: "30", monster: "蝴蝶精", locations: "北部森林訓練場III&IV、鋼之肥肥公園III、石人寺院門外～IV" },
      { level: "32", monster: "火肥肥", locations: "危險的峽谷I&II、火焰之地I&II" },
      { level: "32", monster: "鱷魚", locations: "沼澤地I～III、鱷魚潭I" },
      { level: "35", monster: "小幽靈", locations: "地鐵一號線區02&03、地鐵二號線區01&02" },
      { level: "35", monster: "幼魔精靈", locations: "黑肥肥領土I、幽深螞蟻洞I、蘑菇王之墓、火獨眼獸洞穴I～IV" },
      { level: "35", monster: "風獨眼獸", locations: "北部森林訓練場IX、黑森林狩獵場I&II" },
      { level: "35", monster: "樹妖王", locations: "東方岩石山V" },
    ],
  },
  {
    levelRange: "37～40",
    entries: [
      { level: "37", monster: "紅螃蟹", locations: "熱帶沙灘、紅螃蟹海灘I&II、青螃蟹海灘I&II、海龜沙灘" },
      { level: "37", monster: "猴子", locations: "熱帶沙灘、紅螃蟹海灘I、樹林底層、猴子森林I&II、猴子迷宮I、猴子沼澤地I&II、迷宮森林I" },
      { level: "40", monster: "天使猴", locations: "猴子森林I&II、猴子迷宮II、巫婆森林I、猴子沼澤地II&III、迷宮森林II" },
      { level: "40", monster: "冰獨眼獸", locations: "迷宮森林III、寺院入口、魔龍領土、龍族之地、寺院通道I～IV" },
      { level: "21～30", monster: "超級綠水靈（組隊任務）", locations: "墮落城市" },
    ],
  },
  {
    levelRange: "42～48",
    entries: [
      { level: "42", monster: "鋼之肥肥", locations: "肥肥海岸、鋼之肥肥公園I～III、火焰之地II～IV" },
      { level: "44", monster: "骷髏犬", locations: "遺跡之墓I～III" },
      { level: "45", monster: "土龍", locations: "冰獨眼獸洞穴I、龍族狩獵場" },
      { level: "45", monster: "鋼之黑肥肥", locations: "火焰之地III～V、鋼之黑肥肥領土" },
      { level: "46", monster: "烏龜", locations: "青螃蟹海灘II、海龜沙灘" },
      { level: "47", monster: "木乃伊犬", locations: "遺跡之墓I～III" },
      { level: "48", monster: "大幽靈", locations: "地鐵一號線區03&04、地鐵二號線區02&03" },
      { level: "48", monster: "青螃蟹", locations: "青螃蟹海灘I&II、海龜沙灘" },
    ],
  },
  {
    levelRange: "50～60",
    entries: [
      { level: "50", monster: "青龍", locations: "冰獨眼獸洞穴I&II、龍族狩獵場、龍族之地" },
      { level: "50", monster: "殭屍猴王", locations: "巫婆森林I" },
      { level: "52", monster: "黑鱷魚", locations: "鱷魚潭I&II" },
      { level: "55", monster: "巨居蟹", locations: "海龜沙灘" },
      { level: "55", monster: "石巨人", locations: "石人寺院門外～I、迷宮森林IV&V" },
      { level: "55", monster: "巫婆", locations: "巫婆森林I&II" },
      { level: "57", monster: "骷髏士兵", locations: "遺跡之墓II～IV、第一～三軍營" },
      { level: "58", monster: "黑曜石巨人", locations: "石人寺院I～III、迷宮森林IV&V、巨人之林" },
      { level: "59", monster: "混種石巨人", locations: "石人寺院III&IV、巨人之林" },
      { level: "60", monster: "赤龍", locations: "冰獨眼獸洞穴II、龍穴" },
      { level: "60（王）", monster: "蘑菇王", locations: "鋼之肥肥公園III" },
    ],
  },
  {
    levelRange: "62～70",
    entries: [
      { level: "62", monster: "魔龍", locations: "龍穴、魔龍領土" },
      { level: "63", monster: "骷髏士官", locations: "遺跡之墓IV、遺跡之峭壁、第一～三軍營" },
      { level: "64", monster: "冰龍", locations: "龍族之地、冰冷的搖籃、龍族之巢" },
      { level: "65", monster: "沼澤巨鱷", locations: "鱷魚潭I&II" },
      { level: "65（王）", monster: "殭屍菇菇王", locations: "蘑菇王之墓" },
      { level: "68", monster: "黑龍", locations: "冰冷的搖籃、龍族之巢" },
      { level: "70（王）", monster: "月牙牛魔王", locations: "寺院通道I～IV" },
    ],
  },
  {
    levelRange: "73～115",
    entries: [
      { level: "73", monster: "骷髏指揮官", locations: "遺跡之峭壁" },
      { level: "75（王）", monster: "長槍牛魔王", locations: "寺院通道III&IV" },
      { level: "80（王）", monster: "巴洛古", locations: "被詛咒的寺廟" },
      { level: "100（王）", monster: "地獄巴洛古", locations: "魔法森林往天空之城的船" },
      { level: "115（王）", monster: "惡靈13", locations: "威廉古堡第5階段" },
    ],
  },
  {
    levelRange: "135～200",
    entries: [
      { level: "135～200", monster: "骨龍、生化戰士、時間神殿怪物", locations: "冰原雪域周邊" },
      { level: "135～200", monster: "殘暴炎魔、樹王", locations: "冰原雪域高階區域" },
      { level: "155以上（王）", monster: "闇黑龍王", locations: "冰原雪域高階區域" },
    ],
    note: "這個區間資料來源跟前面不同（私服攻略站交叉比對），可選地圖本來就比較少，通常需要組隊挑戰。",
  },
];

window.MapleLegacySpots = LEGACY_SPOTS;
