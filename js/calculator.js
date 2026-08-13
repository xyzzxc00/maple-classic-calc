/**
 * calculator.js — 計算層
 * -----------------------------------------------------------------
 * 這裡只放「純計算」函式：輸入數字，回傳數字/物件。
 * 完全不碰 DOM、不管畫面長怎樣。
 * 好處：之後資料表換成真的，這層幾乎不用改；
 *       而且這些函式可以直接寫單元測試。
 * -----------------------------------------------------------------
 */

const MapleCalculator = (() => {
  /**
   * 計算從目前等級(含目前經驗)升到目標等級，總共還需要多少經驗值
   * 目前等級/目標等級會被夾在 [1, expTable.length + 1] 範圍內，避免超出資料表
   * 範圍時 expTable[i] 讀到 undefined、被 ?? 0 吃掉，靜默算出偏低的錯誤結果。
   * @param {number} currentLevel
   * @param {number} currentExp - 目前等級內已累積的經驗
   * @param {number} targetLevel
   * @param {number[]} expTable - index 0 = Lv.1 升 Lv.2 所需經驗
   * @returns {{ totalExpNeeded: number, levelsToGo: number }}
   */
  function calcExpNeeded(currentLevel, currentExp, targetLevel, expTable) {
    const maxLevel = expTable.length + 1;
    currentLevel = Math.min(Math.max(currentLevel, 1), maxLevel);
    targetLevel = Math.min(Math.max(targetLevel, 1), maxLevel);

    if (targetLevel <= currentLevel) {
      return { totalExpNeeded: 0, levelsToGo: 0 };
    }

    let total = 0;

    // 目前等級還缺的經驗
    const currentLevelNeed = expTable[currentLevel - 1] ?? 0;
    total += Math.max(currentLevelNeed - currentExp, 0);

    // 中間每一等所需經驗
    for (let lv = currentLevel + 1; lv < targetLevel; lv++) {
      total += expTable[lv - 1] ?? 0;
    }

    return {
      totalExpNeeded: total,
      levelsToGo: targetLevel - currentLevel,
    };
  }

  /**
   * 解析經驗輸入字串，支援 W／萬（×1萬）與 億（×1億）當單位。
   *
   * 一定要整串都解析得了才回傳數字，不能用裸的 parseFloat——parseFloat
   * 對「數字開頭、後面接垃圾」的字串會靜默截斷：「5萬」會變成 5（差一萬
   * 倍！）、「50000k」會變成 50000。這種輸入以前不會報錯、直接用錯的數字
   * 算下去，還可能被回報進社群資料庫污染大家的參考值。整串驗證失敗就回
   * NaN，讓各呼叫端的「看不懂這個數值」訊息接手。
   */
  function parseExpVal(val) {
    if (!val || !String(val).trim()) return NaN;
    const s = String(val).trim().toUpperCase().replace(/[,，\s]/g, "");
    const m = s.match(/^(\d*\.?\d+)(W|萬|億)?$/);
    if (!m) return NaN;
    const unit = m[2] === "億" ? 1e8 : m[2] ? 1e4 : 1;
    return parseFloat(m[1]) * unit;
  }

  /**
   * 把分鐘數格式化成「X天 Y小時 Z分」的可讀文字
   */
  function formatDuration(minutes) {
    if (!isFinite(minutes) || minutes <= 0) return null;
    const m = Math.ceil(minutes);
    if (m < 60) return m + " 分鐘";
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 24) return h + " 小時" + (rm ? " " + rm + " 分" : "");
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return d + " 天 " + rh + " 小時" + (rm ? " " + rm + " 分" : "");
  }

  /**
   * 用每分鐘經驗值（未加倍）算出不加倍/加倍後所需時間、省下的時間
   * @param {number} totalExpNeeded
   * @param {number} expPerMin - 未加倍時每分鐘經驗
   * @param {number} mult - 加倍倍率
   */
  function calcTimes(totalExpNeeded, expPerMin, mult) {
    if (!expPerMin || expPerMin <= 0) {
      return { minutesNo: null, minutesMult: null, savedMinutes: null, displayNo: "尚無效率資料", displayMult: "尚無效率資料", displaySaved: "—" };
    }
    const minutesNo = totalExpNeeded / expPerMin;
    const minutesMult = totalExpNeeded / (expPerMin * mult);
    const savedMinutes = minutesNo - minutesMult;
    return {
      minutesNo,
      minutesMult,
      savedMinutes,
      displayNo: formatDuration(minutesNo) || "已達成",
      displayMult: formatDuration(minutesMult) || "已達成",
      displaySaved: formatDuration(savedMinutes) || "—",
    };
  }

  /**
   * 加倍卷計算（每張固定 30 分鐘）
   */
  function calcCoupons(minutesMult, mult, ownedCoupons) {
    if (minutesMult == null || mult <= 1) {
      return { couponsNeeded: 0, hasOwned: false, enough: false, shortBy: 0 };
    }
    const couponsNeeded = Math.ceil(minutesMult / 30);
    const hasOwned = Number.isFinite(ownedCoupons) && ownedCoupons >= 0;
    const enough = hasOwned && ownedCoupons >= couponsNeeded;
    const shortBy = hasOwned && !enough ? couponsNeeded - ownedCoupons : 0;
    return { couponsNeeded, hasOwned, enough, shortBy };
  }

  /**
   * 每天打 X 小時，估算加倍後／不加倍各要幾天練完
   */
  function calcDailyDays(minutesNo, minutesMult, dailyHours) {
    // minutesNo <= 0（已達成目標）也回 null——不然會算出 Math.ceil(0)=0，
    // 畫面顯示奇怪的「0 天／0 天」，同列其他欄位都是顯示「已達成」/「—」
    if (!dailyHours || dailyHours <= 0 || minutesNo == null || minutesNo <= 0) return null;
    const dailyMinutes = dailyHours * 60;
    return {
      daysNo: Math.ceil(minutesNo / dailyMinutes),
      daysMult: Math.ceil(minutesMult / dailyMinutes),
    };
  }

  /**
   * 轉義字串裡的 HTML 特殊字元，避免使用者輸入內容被當成標籤解析（XSS）
   */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /**
   * 把目前的查詢條件編碼成可分享的 URL 參數
   */
  function encodeShareParams({ currentLevel, currentExp, targetLevel, expPerMin, mult, dailyHours, ownedCoupons }) {
    const params = new URLSearchParams();
    params.set("cl", currentLevel);
    params.set("ce", currentExp);
    params.set("tl", targetLevel);
    if (expPerMin) params.set("epm", expPerMin);
    if (mult) params.set("mult", mult);
    if (dailyHours) params.set("daily", dailyHours);
    if (ownedCoupons) params.set("owned", ownedCoupons);
    return params.toString();
  }

  function decodeShareParams(search) {
    const params = new URLSearchParams(search);
    const cl = parseInt(params.get("cl"), 10);
    const ce = parseInt(params.get("ce"), 10);
    const tl = parseInt(params.get("tl"), 10);
    const epm = parseFloat(params.get("epm"));
    const mult = parseFloat(params.get("mult"));
    const daily = parseFloat(params.get("daily"));
    const owned = parseInt(params.get("owned"), 10);
    return {
      currentLevel: Number.isFinite(cl) ? cl : null,
      currentExp: Number.isFinite(ce) ? ce : null,
      targetLevel: Number.isFinite(tl) ? tl : null,
      expPerMin: Number.isFinite(epm) ? epm : null,
      mult: Number.isFinite(mult) ? mult : null,
      dailyHours: Number.isFinite(daily) ? daily : null,
      ownedCoupons: Number.isFinite(owned) ? owned : null,
    };
  }

  return {
    calcExpNeeded,
    parseExpVal,
    escHtml,
    formatDuration,
    calcTimes,
    calcCoupons,
    calcDailyDays,
    encodeShareParams,
    decodeShareParams,
  };
})();

window.MapleCalculator = MapleCalculator;
