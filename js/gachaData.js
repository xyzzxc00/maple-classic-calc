/**
 * gachaData.js — 轉蛋模擬的道具池資料
 * -----------------------------------------------------------------
 * 資料來源：官方「機率商品說明」頁面公告的機率，非玩家推測值。等級標示
 * S/A/B/C 為官方原始分級，數字為官方公布的中獎機率（已四捨五入取小數
 * 後兩位，故單一箱總和不一定剛好等於 100%，這是官方公告本身的特性，
 * 不是這裡的計算誤差）。
 *
 * 部分道具為角色性別鎖定的成對道具（例如男/女泳裝），官方說明：無法
 * 獲得該性別道具時，機率會均等分配到其他獎勵——這裡仍照官方表格原始
 * 數字條列，不特別處理性別互斥邏輯。
 *
 * weight 直接採用官方公布的機率數字（不用剛好加總 100，抽取邏輯會自己
 * 按比例算）。之後有新一期轉蛋上架，比照這個結構加新的 box 進
 * GACHA_BOXES，gacha.js 的邏輯不用改。
 *
 * 2026-08-13 更新：換到 08/13～08/27 這一期，id 沿用舊的（gacha.js
 * 用 box.id 當模擬統計的 key），只換 period 跟 items。官方這期公告裡
 * 「彗星碎片」兌換表（S=10、A=5、B=3、C=1，部分道具不能換、碎片會過期）
 * 目前沒有對應到站上任何功能，純資訊沒有漏收——只是還沒有模擬這塊。
 * -----------------------------------------------------------------
 */
const GACHA_BOXES = [
  {
    id: "shining-comet",
    name: "閃亮彗星",
    period: "2026/08/13 09:00 ～ 2026/08/27 08:00",
    items: [
      { name: "黑暗音樂人耳機", rarity: "A", weight: 1.60 },
      { name: "黑暗音樂人套裝", rarity: "A", weight: 1.50 },
      { name: "黑暗音樂人披風", rarity: "A", weight: 1.70 },
      { name: "黑暗音樂人靴子", rarity: "A", weight: 1.80 },
      { name: "青春搖滾", rarity: "A", weight: 1.20 },
      { name: "超級之星M", rarity: "A", weight: 1.20 },
      { name: "獨裁者貝雷帽", rarity: "B", weight: 1.80 },
      { name: "獨裁者套服", rarity: "B", weight: 1.90 },
      { name: "施瓦茲靴子", rarity: "B", weight: 1.90 },
      { name: "獨裁者風衣", rarity: "B", weight: 1.80 },
      { name: "白兔髮夾", rarity: "B", weight: 1.80 },
      { name: "白兔禮服", rarity: "B", weight: 1.90 },
      { name: "白兔長靴", rarity: "B", weight: 1.90 },
      { name: "軍帽", rarity: "C", weight: 4.59 },
      { name: "勤奮小蜜蜂帽子", rarity: "C", weight: 4.59 },
      { name: "黑鑽石", rarity: "C", weight: 4.59 },
      { name: "高音名牌戒指", rarity: "C", weight: 4.59 },
      { name: "高音聊天戒指", rarity: "C", weight: 4.59 },
      { name: "大聖裝", rarity: "C", weight: 4.59 },
      { name: "聖戰士披風裝", rarity: "C", weight: 4.59 },
      { name: "黑色紅線外套", rarity: "C", weight: 4.59 },
      { name: "嘻皮酒紅色外套", rarity: "C", weight: 4.59 },
      { name: "彩虹天藍褲", rarity: "C", weight: 4.59 },
      { name: "繽紛嘻哈褲", rarity: "C", weight: 4.59 },
      { name: "武陵道場運動鞋", rarity: "C", weight: 4.59 },
      { name: "亮色系街頭潮鞋", rarity: "C", weight: 4.59 },
      { name: "彩色圍巾", rarity: "C", weight: 4.59 },
      { name: "貓咪降落傘", rarity: "C", weight: 4.59 },
      { name: "花蝴蝶之杖", rarity: "C", weight: 4.59 },
      { name: "醜小鴨", rarity: "C", weight: 4.59 },
    ],
  },
  {
    id: "brilliant-comet",
    name: "璀璨彗星",
    period: "2026/08/13 09:00 ～ 2026/08/27 08:00",
    items: [
      { name: "血腥守護者帽", rarity: "S", weight: 1.10 },
      { name: "血腥新娘面紗", rarity: "S", weight: 1.10 },
      { name: "血腥守護者", rarity: "S", weight: 1.00 },
      { name: "血腥新娘", rarity: "S", weight: 1.00 },
      { name: "血腥中筒靴", rarity: "S", weight: 1.30 },
      { name: "血腥高跟鞋", rarity: "S", weight: 1.30 },
      { name: "血腥薔薇", rarity: "S", weight: 1.20 },
      { name: "血腥童話", rarity: "S", weight: 1.00 },
      { name: "冷冽之痕", rarity: "A", weight: 1.23 },
      { name: "冷豔之心", rarity: "A", weight: 1.23 },
      { name: "冷豔之服", rarity: "A", weight: 1.23 },
      { name: "冷冽之服", rarity: "A", weight: 1.23 },
      { name: "冷豔的步伐", rarity: "A", weight: 1.30 },
      { name: "冷冽的步伐", rarity: "A", weight: 1.30 },
      { name: "冷冽的束縛", rarity: "A", weight: 1.16 },
      { name: "冷冽的希望", rarity: "A", weight: 1.02 },
      { name: "五顏六色冰淇淋", rarity: "B", weight: 2.73 },
      { name: "海上男人的海灘褲(男)", rarity: "B", weight: 2.73 },
      { name: "海灘辣妹的泳裝(女)", rarity: "B", weight: 2.73 },
      { name: "海上男人的夾腳拖(男)", rarity: "B", weight: 2.87 },
      { name: "海灘辣妹的夾腳拖(女)", rarity: "B", weight: 2.87 },
      { name: "枝仔冰", rarity: "B", weight: 2.73 },
      { name: "請給我冰淇淋", rarity: "B", weight: 2.66 },
      { name: "漂漂帽T", rarity: "A", weight: 1.30 },
      { name: "呼喵喵藍色衣袖", rarity: "A", weight: 1.26 },
      { name: "呼喵喵膝上襪", rarity: "A", weight: 1.43 },
      { name: "黑貓娃娃武器", rarity: "A", weight: 1.20 },
      { name: "黑色水手服帽子", rarity: "B", weight: 2.73 },
      { name: "黑色水手服緞帶帽子", rarity: "B", weight: 2.73 },
      { name: "黑色水軍服", rarity: "B", weight: 2.66 },
      { name: "黑色水手服", rarity: "B", weight: 2.66 },
      { name: "黑色水手鞋", rarity: "B", weight: 2.87 },
      { name: "綠豬帽", rarity: "A", weight: 1.33 },
      { name: "可愛豬豬男生套組", rarity: "A", weight: 1.23 },
      { name: "可愛豬豬女生套組", rarity: "A", weight: 1.23 },
      { name: "可愛豬豬武器", rarity: "A", weight: 1.20 },
      { name: "寶貝貓咪帽", rarity: "B", weight: 2.73 },
      { name: "男生寶貝貓咪套裝", rarity: "B", weight: 2.70 },
      { name: "女生寶貝貓咪套裝", rarity: "B", weight: 2.70 },
      { name: "寶貝貓咪圍巾", rarity: "B", weight: 2.80 },
      { name: "喵嗚拳套", rarity: "B", weight: 2.87 },
      { name: "寶貝貓咪臉飾", rarity: "B", weight: 2.90 },
      { name: "寶貝貓咪鞋", rarity: "B", weight: 2.73 },
      { name: "雪月花・雪", rarity: "A", weight: 1.33 },
      { name: "雪月花・月", rarity: "A", weight: 1.16 },
      { name: "雪月花・花", rarity: "A", weight: 1.43 },
      { name: "白夜叉角", rarity: "A", weight: 1.23 },
      { name: "白夜叉套服", rarity: "A", weight: 1.16 },
      { name: "白夜叉斗篷", rarity: "A", weight: 1.26 },
      { name: "白夜叉木屐", rarity: "A", weight: 1.43 },
      { name: "白夜叉刺青", rarity: "A", weight: 1.33 },
      { name: "櫻花刀", rarity: "A", weight: 1.23 },
      { name: "過度沉迷者的帽子", rarity: "B", weight: 2.56 },
      { name: "過度沉迷者T恤", rarity: "B", weight: 2.46 },
      { name: "過度沉迷者褲", rarity: "B", weight: 2.46 },
      { name: "過度沉迷者書包", rarity: "B", weight: 2.87 },
      { name: "過度沉迷者鞋", rarity: "B", weight: 2.39 },
    ],
  },
  // 皇家美容院是「美髮券／整形券」各自獨立販售，男女、髮型/整形各是
  // 獨立一份 100% 機率表（不是合在一起抽），所以拆成 4 個獨立 box，
  // 不是 1 個 box 裡分 4 組
  {
    id: "royal-salon-hair-m",
    name: "皇家美容院・皇家美髮(男)",
    period: "2026/08/13 00:00 ～ 2026/08/26 23:59",
    items: [
      { name: "黑色花花公子造型", weight: 2.50 },
      { name: "黑色帥氣蒼龍造型", weight: 2.50 },
      { name: "黑色飄揚幻影造型", weight: 2.50 },
      { name: "黑色塔樓王子造型", weight: 2.50 },
      { name: "黑色克勞烏造型", weight: 7.50 },
      { name: "黑色瀏海飛揚造型", weight: 7.50 },
      { name: "黑色蓬鬆有型造型", weight: 7.50 },
      { name: "黑色綿密泡沫造型", weight: 7.50 },
      { name: "黑色羅馬捲造型", weight: 15.00 },
      { name: "黑色動力髮型", weight: 15.00 },
      { name: "黑色迎風飄揚造型", weight: 15.00 },
      { name: "黑色韓系偶像造型", weight: 15.00 },
    ],
  },
  {
    id: "royal-salon-hair-f",
    name: "皇家美容院・皇家美髮(女)",
    period: "2026/08/13 00:00 ～ 2026/08/26 23:59",
    items: [
      { name: "黑色雙結羽毛造型", weight: 2.50 },
      { name: "黑色短翹造型", weight: 2.50 },
      { name: "黑色女神髮辮造型", weight: 2.50 },
      { name: "黑色蝴蝶少女造型", weight: 2.50 },
      { name: "黑色蓬鬆束髮造型", weight: 7.50 },
      { name: "黑色雪莉造型", weight: 7.50 },
      { name: "黑色捲翹馬尾造型", weight: 7.50 },
      { name: "黑色迷人短剪造型", weight: 7.50 },
      { name: "黑色俐落盤髮造型", weight: 15.00 },
      { name: "黑色自然短髮造型", weight: 15.00 },
      { name: "黑色魅力上捲造型", weight: 15.00 },
      { name: "黑色日式小僮造型", weight: 15.00 },
    ],
  },
  {
    id: "royal-salon-face-m",
    name: "皇家美容院・皇家整形(男)",
    period: "2026/08/13 00:00 ～ 2026/08/26 23:59",
    items: [
      { name: "閃星光臉型", weight: 10.00 },
      { name: "小嘟嘴臉型", weight: 10.00 },
      { name: "甜蜜的臉型", weight: 10.00 },
      { name: "很不屑臉型", weight: 7.78 },
      { name: "粗眉毛臉型", weight: 7.78 },
      { name: "漫畫眼臉型", weight: 7.78 },
      { name: "狼角色臉型", weight: 7.78 },
      { name: "大眼珠臉型", weight: 7.78 },
      { name: "生氣的臉型", weight: 7.78 },
      { name: "很專心臉型", weight: 7.78 },
      { name: "看仔細臉型", weight: 7.78 },
      { name: "好時髦臉型", weight: 7.78 },
    ],
  },
  {
    id: "royal-salon-face-f",
    name: "皇家美容院・皇家整形(女)",
    period: "2026/08/13 00:00 ～ 2026/08/26 23:59",
    items: [
      { name: "星光眼臉孔", weight: 10.00 },
      { name: "小嘟嘴臉型", weight: 10.00 },
      { name: "甜蜜的臉型", weight: 10.00 },
      { name: "漫畫眼臉型", weight: 7.78 },
      { name: "無神的臉型", weight: 7.78 },
      { name: "平靜的臉型", weight: 7.78 },
      { name: "生氣的臉型", weight: 7.78 },
      { name: "很專心臉型", weight: 7.78 },
      { name: "看仔細臉型", weight: 7.78 },
      { name: "懷疑的臉型", weight: 7.78 },
      { name: "鬥雞眼臉型", weight: 7.78 },
      { name: "很鎮定臉型", weight: 7.78 },
    ],
  },
];

window.MapleGachaBoxes = GACHA_BOXES;
