/**
 * legacySpotsData.js — 舊版資料參考：練功地點資料
 * -----------------------------------------------------------------
 * 這裡整理的是「Big Bang 大改版之前」舊版楓之谷的練功地點，不是台版
 * 經典版的即時回報（那個在「建議練功地點」分頁，讀的是玩家在社群資料
 * 庫回報的真實效率）。Lv.1~115 的怪物/地點資料是對照巴哈姆特新楓之谷
 * 精華區的「怪物分布地區」整理文核對的，同一隻怪常常會出現在好幾張
 * 地圖，這裡盡量把查得到的地圖都列出來，讓玩家多一些選擇，不是只給
 * 一個地方。這裡是給人練等用的參考名單，故意不收王級頭目——打王要組隊、
 * 前置任務、道具，練功效率跟一般練等地點不是同一回事，收進來只會誤導。
 * 職業別的效率差異來源沒有特別標注，所以這裡故意不寫「這裡適合哪個
 * 職業」，避免比等級/地圖本身更容易出錯的猜測。
 * -----------------------------------------------------------------
 */
const LEGACY_SPOTS = [
  {
    levelRange: "1～10",
    entries: [],
    note: "這個區間大致上照著新手村的任務走就能練到，不太需要特地找地方打指定的怪，所以這裡不逐一列怪物/地點了。",
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
      { level: "27", monster: "火獨眼獸", locations: "北部森林訓練場VIII、黑森林通道、黑森林狩獵場I、幽深螞蟻洞、螞蟻礦坑、火獨眼獸洞穴I～IV" },
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
    ],
  },
  {
    levelRange: "37～40",
    entries: [
      { level: "37", monster: "紅螃蟹", locations: "熱帶沙灘、紅螃蟹海灘I&II、青螃蟹海灘I&II、海龜沙灘" },
      { level: "37", monster: "猴子", locations: "熱帶沙灘、紅螃蟹海灘I、樹林底層、猴子森林I&II、猴子迷宮I、猴子沼澤地I&II、迷宮森林I" },
      { level: "40", monster: "天使猴", locations: "猴子森林I&II、猴子迷宮II、巫婆森林I、猴子沼澤地II&III、迷宮森林II" },
      { level: "40", monster: "冰獨眼獸", locations: "迷宮森林III、寺院入口、魔龍領土、龍族之地、寺院通道I～IV" },
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
      { level: "52", monster: "黑鱷魚", locations: "鱷魚潭I&II" },
      { level: "55", monster: "石巨人", locations: "石人寺院門外～I、迷宮森林IV&V" },
      { level: "55", monster: "巫婆", locations: "巫婆森林I&II" },
      { level: "57", monster: "骷髏士兵", locations: "遺跡之墓II～IV、第一～三軍營" },
      { level: "58", monster: "黑曜石巨人", locations: "石人寺院I～III、迷宮森林IV&V、巨人之林" },
      { level: "59", monster: "混種石巨人", locations: "石人寺院III&IV、巨人之林" },
      { level: "60", monster: "赤龍", locations: "冰獨眼獸洞穴II、龍穴" },
    ],
  },
  {
    levelRange: "62～68",
    entries: [
      { level: "62", monster: "魔龍", locations: "龍穴、魔龍領土" },
      { level: "63", monster: "骷髏士官", locations: "遺跡之墓IV、遺跡之峭壁、第一～三軍營" },
      { level: "64", monster: "冰龍", locations: "龍族之地、冰冷的搖籃、龍族之巢" },
      { level: "65", monster: "沼澤巨鱷", locations: "鱷魚潭I&II" },
      { level: "68", monster: "黑龍", locations: "冰冷的搖籃、龍族之巢" },
    ],
  },
  {
    levelRange: "73～113",
    entries: [
      { level: "70", monster: "萊西", locations: "米納爾森林" },
      { level: "72", monster: "橡木甲蟲", locations: "米納爾森林" },
      { level: "72", monster: "侏儒怪", locations: "米納爾森林" },
      { level: "73", monster: "骷髏指揮官", locations: "遺跡之峭壁" },
      { level: "74", monster: "暗黑萊西", locations: "米納爾森林" },
      { level: "76", monster: "邪惡侏儒怪", locations: "米納爾森林" },
      { level: "76", monster: "金屬甲蟲", locations: "米納爾森林" },
      { level: "78", monster: "變種侏儒怪", locations: "米納爾森林" },
      { level: "80", monster: "哈維", locations: "米納爾森林 天空之巢路口" },
      { level: "83", monster: "血腥哈維", locations: "米納爾森林" },
      { level: "85", monster: "邪惡綿羊", locations: "米納爾森林" },
      { level: "88", monster: "寒冰半人馬", locations: "米納爾森林 寒冰半人馬領土" },
      { level: "88", monster: "火焰半人馬", locations: "米納爾森林 冰火戰場" },
      { level: "88", monster: "暗黑半人馬", locations: "米納爾森林" },
      { level: "88", monster: "惡魔綿羊", locations: "米納爾森林" },
      { level: "101", monster: "藍翼龍", locations: "米納爾森林 藍翼龍巢穴" },
      { level: "103", monster: "黑翼龍", locations: "米納爾森林 黑翼龍巢穴（需 140 命中）" },
      { level: "105", monster: "洞穴幼年龍", locations: "米納爾森林 被遺留的龍之巢穴" },
      { level: "110", monster: "幼龍保護者", locations: "米納爾森林 被遺留的龍之巢穴" },
      { level: "110", monster: "化石龍", locations: "神木村、被遺留的龍之巢穴" },
      { level: "113", monster: "化石龍長老", locations: "被遺留的龍之巢穴" },
    ],
  },
];

window.MapleLegacySpots = LEGACY_SPOTS;

/**
 * 舊版野王出沒地點（Big Bang 大改版之前，約 2007～2009 年）——僅供參考，
 * 不是台版新楓之谷經典版的正式資料，經典版上線／封測後會換成官方資料。
 * 地點/等級對照巴哈姆特新楓之谷精華區的怪物分布整理，重生時間優先採用
 * 2009 年前後的玩家記錄；樹妖王／殭屍猴王／巨居蟹這 3 隻查不到當年記錄，
 * 只查得到近年整理資料，各自在 respawn 欄位裡註明了，可能跟原始舊版數字
 * 有落差。
 */
const LEGACY_BOSSES = [
  { level: "20", monster: "紅寶王", locations: "維多利亞 海岸叢林III（從維多利亞港一直往右走，約第 3～4 張地圖）", respawn: "資料不一致（私服記錄 3 小時、近年整理另有 23～30 分鐘的說法），沒查到 2009 年代的直接記錄" },
  { level: "35", monster: "樹妖王", locations: "維多利亞 東方岩石山V", respawn: "約 3 小時（僅查到近年整理資料，2007～2009 年代記錄不足）" },
  { level: "38", monster: "仙人長老", locations: "納西沙漠 乾旱沙漠（地圖上方一帶，沒看到就換頻）", respawn: "3 小時" },
  { level: "50", monster: "殭屍猴王", locations: "地點資料不一致：有來源說「維多利亞 巫婆森林I」，也有來源說「魔法森林 被汙染的樹木」或「殭屍猴的森林I&II」，尚未查到能互相印證的版本", respawn: "約 3 小時（僅查到近年整理資料，2007～2009 年代記錄不足）" },
  { level: "55", monster: "巨居蟹", locations: "維多利亞 海龜沙灘（等級資料不一致，另有來源標示 Lv.42／黃金海岸暖沙灘，可能是不同怪物混在一起，先以 Lv.55／海龜沙灘為準）", respawn: "約 3 小時（僅查到近年整理資料，2007～2009 年代記錄不足）" },
  { level: "56", monster: "冥界幽靈", locations: "墮落城市 地鐵2號線3區段（需開啟地圖上的路燈才能對它造成傷害）", respawn: "沒查到可靠的重生時間記錄" },
  { level: "59", monster: "咕咕鐘", locations: "玩具城 遺失的時間<2>", respawn: "3 小時" },
  { level: "59", monster: "仙人娃娃", locations: "桃花仙境 上級修練場", respawn: "2 小時 38 分～3 小時" },
  { level: "59", monster: "喵怪仙人", locations: "桃花仙境 妖怪之林 → 妖怪之林2（進妖怪之林後點兩下頭上燈泡，由中間上方標示牌傳點進妖怪之林2，再從右上角隱藏傳點進入）", respawn: "2 小時 30 分～2 小時 50 分" },
  { level: "60", monster: "蘑菇王", locations: "維多利亞 鋼之肥肥公園Ⅲ", respawn: "約 45 分～1 小時（2009 年玩家記錄）" },
  { level: "62", monster: "書生幽靈", locations: "童話村 鬼屋（從深山凶宅右方進入）", respawn: "沒查到可靠的重生時間記錄" },
  { level: "63", monster: "紅藍雙怪", locations: "瑪迦提亞城 蒙特鳩協會 研究所103號房", respawn: "1 小時 53 分～2 小時 15 分" },
  { level: "64", monster: "雪山魔女", locations: "冰原雪域 寒冰平原", respawn: "沒查到可靠的重生時間記錄" },
  { level: "65", monster: "殭屍蘑菇王", locations: "奇幻村 蘑菇王之墓", respawn: "約 45 分～1 小時（2009 年玩家記錄，跟蘑菇王共用同批重生資料）" },
  { level: "65", monster: "厄運死神", locations: "冰原雪域 亡者之林IV", respawn: "沒查到可靠的重生時間記錄" },
  { level: "70", monster: "九尾妖狐", locations: "桃花仙境 九尾妖狐山坡（左下方洞穴進入）", respawn: "3 小時" },
  { level: "71", monster: "肯德熊", locations: "武陵 流浪熊的領土", respawn: "3 小時" },
  { level: "80", monster: "巴洛古", locations: "巴洛古之谷（從魔法森林進入）", respawn: "4～6 小時（2009 年玩家記錄）" },
  { level: "80", monster: "迪特和洛依", locations: "瑪迦提亞城 研究所C-3區", respawn: "2 小時 30 分～2 小時 45 分" },
  { level: "83", monster: "艾利傑", locations: "天空之城 艾利傑的庭園（天空階梯II左上方進入）", respawn: "3 小時" },
  { level: "85", monster: "黑輪王", locations: "隱藏地圖夜市徒步區7或7-1，需完成「尋找項鍊」前置任務系列、找阿勇伯進場", respawn: "3～4 小時" },
  { level: "85", monster: "奇美拉", locations: "瑪迦提亞城 研究所地底秘密通道（需完成任務才能進入）", respawn: "2～2 小時 15 分" },
  { level: "90", monster: "雪毛怪人", locations: "冰原雪域 雪人之谷（雪城 冰雪峽谷I 右方公告欄進入隱藏地圖）", respawn: "45 分～1 小時" },
  { level: "105", monster: "噴火龍", locations: "神木村 噴火龍棲息地", respawn: "4～6 小時" },
  { level: "105", monster: "格瑞芬多（鳥王）", locations: "神木村 格瑞芬多森林", respawn: "4～6 小時" },
  { level: "110～120", monster: "海怒斯", locations: "水世界 海怒斯洞穴", respawn: "BB 大改版前：右海怒斯約 12 小時、左海怒斯約 24 小時（重生時間官方調整過很多次，此為 BB 前的週期，跟現在版本的週期不同）" },
  { level: "120", monster: "寒霜冰龍", locations: "神木村 深山凶屋（翼龍峽谷左下進入）", respawn: "4～12 小時" },
];

window.MapleLegacyBosses = LEGACY_BOSSES;

/**
 * LEGACY_BOSS_PREQUESTS — 舊版資料參考：王級頭目前置任務
 * -----------------------------------------------------------------
 * 整理自巴哈姆特新楓之谷哈啦板／精華區玩家攻略，並與其他管道（PTT、
 * 海外 BeforeBigBang 舊版資料庫、私服 wiki）交叉核對過。拉圖斯前置
 * 特別採用 2009 年左右的舊文與海外舊版資料為準，避開近期改版過的
 * 流程（新版跟 BB 前的流程已經不一樣了）。實際流程可能因版本微調
 * 而有出入，正式上線／封測後會再校正。
 * -----------------------------------------------------------------
 */
const LEGACY_BOSS_PREQUESTS = [
  {
    boss: "殘暴炎魔",
    levelReq: "Lv.50+（混沌炎魔前置與普通版相同）",
    steps: [
      {
        title: "觸發任務",
        desc: "冰原雪域－長者公館，找所屬職業的三轉教官，批准進行殘暴炎魔地下城任務。",
      },
      {
        title: "阿杜比斯的任務．第一階段（任務道具：火石母礦碎片）",
        desc: "地點：不知名的廢礦、16區域，共需蒐集 7 把鑰匙：不知名的廢礦（9-2左箱、11-1左箱、14-1左箱、4-2右岩）、16區域（16-2左箱、16-3右箱、16-5唯一岩石）。另有 30 張廢礦卷可解，只是額外加經驗，不是前置必需項目。",
      },
      {
        title: "阿杜比斯的任務．第二階段",
        desc: "跳兩張忍耐（跳台）地圖，取得「火山的心臟」。這階段連原文攻略都表示沒有固定教學，只能自己跳。",
      },
      {
        title: "阿杜比斯的任務．第三階段（任務道具：火焰之眼）",
        desc: "打不知名的廢礦裡的挖礦殭屍（戴安全帽那種）收集 30 個金牙，連同火石母礦碎片＋火山的心臟一起交給阿杜比斯，完成後取得火焰之眼，即可進殘暴炎魔祭壇挑戰。",
      },
    ],
  },
  {
    boss: "闇黑龍王",
    levelReq: "Lv.80+（龍的戰爭，全職業共通，無前置任務即可開始）",
    steps: [
      {
        title: "前置準備．變身秘藥",
        desc: "神木村，生命之穴入口找摩伊拉。材料：龍族戰士的精隨（短刀龍戰士掉落，雙刀龍戰士也有機率但更低）、骷髏肩護帶（雙刀龍戰士）、噴火龍的集音器×3（一隻必掉3個）、堅韌的龍皮（藍/紅/黑翼龍或維多利亞龍族掉落）、惡龍短刀（神木村武器合成NPC用損壞的短刀＋鋰礦石＋鋼鐵製作）。完成後回任會直接變身成短刀龍戰士。",
      },
      {
        title: "注意事項",
        desc: "變身後要實際使用／打過才能再次回任，不然會浪費一次任務道具。",
      },
      {
        title: "進入方式（二選一）",
        desc: "① 有「敢死隊榮譽隊員的象徵」→ 直接點生命之穴右上方的石碑進入龍王入口，免關卡。② 沒有象徵 → 從里程碑開始解一整串關卡（需組隊 6 人，經過第一～五迷宮室、光明洞穴、洞穴小徑，過程需蒐集鑰匙，其中一人要在生命樹待命轉交鑰匙），最後一樣抵達龍王入口。",
      },
      {
        title: "象徵取得",
        desc: "迷宮室或光明洞穴內的怪都有機率掉「象徵1、2、3」，收集齊後之後就能靠石碑直接進，不用每次重跑關卡。",
      },
    ],
    note: "生命之穴／龍王洞穴入口換頻或斷線不會被傳出洞穴；但進入打王地圖後斷線會直接送回神木村，點水晶則正常出來。",
  },
  {
    boss: "拉圖斯",
    levelReq: "Lv.60+起（死守玩具城可接取），整體前置建議 Lv.80+ 再進行",
    steps: [
      {
        title: "死守玩具城",
        desc: "時間通道找NPC皮耶魯。先打泰可因×10，完成後皮耶魯再要求打泰可因×300＋神秘粉末×100（粉末只在隱藏地圖掉落：黃熊、大女巫、綠船、巨人維京），回報完成。",
      },
      {
        title: "時空裂縫的碎片",
        desc: "找NPC福樂，收集碎片A、B、C（各一，形狀不同；怨靈女巫、巨人維京都會掉），三個收齊後向福樂回報取得碎片D，再把碎片D交給皮耶魯。",
      },
      {
        title: "進入拉圖斯房間",
        desc: "打倒通道守門人或達納托斯取得獎牌，同時攜帶獎牌＋碎片D進入時間塔之根源，將碎片D放在地圖中間偏右小平台缺口召喚神奇水晶，打倒水晶召喚拉圖斯之鐘，打倒鐘後才能挑戰拉圖斯本體。",
      },
    ],
  },
];

window.MapleLegacyBossPrequests = LEGACY_BOSS_PREQUESTS;
