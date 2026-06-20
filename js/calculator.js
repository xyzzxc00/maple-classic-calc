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
   * @param {number} currentLevel
   * @param {number} currentExp - 目前等級內已累積的經驗
   * @param {number} targetLevel
   * @param {number[]} expTable - index 0 = Lv.1 升 Lv.2 所需經驗
   * @returns {{ totalExpNeeded: number, levelsToGo: number, breakdown: Array }}
   */
  function calcExpNeeded(currentLevel, currentExp, targetLevel, expTable) {
    if (targetLevel <= currentLevel) {
      return { totalExpNeeded: 0, levelsToGo: 0, breakdown: [] };
    }

    let total = 0;
    const breakdown = [];

    // 目前等級還缺的經驗
    const currentLevelNeed = expTable[currentLevel - 1] ?? 0;
    const remainForCurrentLevel = Math.max(currentLevelNeed - currentExp, 0);
    total += remainForCurrentLevel;
    breakdown.push({
      level: currentLevel,
      expNeeded: remainForCurrentLevel,
    });

    // 中間每一等所需經驗
    for (let lv = currentLevel + 1; lv < targetLevel; lv++) {
      const need = expTable[lv - 1] ?? 0;
      total += need;
      breakdown.push({ level: lv, expNeeded: need });
    }

    return {
      totalExpNeeded: total,
      levelsToGo: targetLevel - currentLevel,
      breakdown,
    };
  }

  /**
   * 用每小時經驗值預估時間
   * @param {number} totalExpNeeded
   * @param {number} expPerHour
   * @returns {{ hours: number, days: number, displayText: string }}
   */
  function estimateTime(totalExpNeeded, expPerHour) {
    if (!expPerHour || expPerHour <= 0) {
      return { hours: null, days: null, displayText: "尚無效率資料" };
    }
    const hours = totalExpNeeded / expPerHour;
    const days = hours / 24;
    let displayText;
    if (hours < 1) {
      displayText = `約 ${Math.ceil(hours * 60)} 分鐘`;
    } else if (hours < 24) {
      displayText = `約 ${hours.toFixed(1)} 小時`;
    } else {
      displayText = `約 ${days.toFixed(1)} 天（以每天練等 ${expPerHour ? "持續" : ""}估算）`;
    }
    return { hours, days, displayText };
  }

  /**
   * 找出適合目前等級的練功地點（依 levelRange 篩選）
   */
  function findSuitableSpots(level, spots) {
    return spots.filter(
      (s) => level >= s.levelRange[0] && level <= s.levelRange[1]
    );
  }

  /**
   * 把目前的查詢條件編碼成可分享的 URL 參數
   */
  function encodeShareParams({ currentLevel, currentExp, targetLevel, expPerHour }) {
    const params = new URLSearchParams();
    params.set("cl", currentLevel);
    params.set("ce", currentExp);
    params.set("tl", targetLevel);
    if (expPerHour) params.set("eph", expPerHour);
    return params.toString();
  }

  function decodeShareParams(search) {
    const params = new URLSearchParams(search);
    const cl = parseInt(params.get("cl"), 10);
    const ce = parseInt(params.get("ce"), 10);
    const tl = parseInt(params.get("tl"), 10);
    const eph = parseInt(params.get("eph"), 10);
    return {
      currentLevel: Number.isFinite(cl) ? cl : null,
      currentExp: Number.isFinite(ce) ? ce : null,
      targetLevel: Number.isFinite(tl) ? tl : null,
      expPerHour: Number.isFinite(eph) ? eph : null,
    };
  }

  return {
    calcExpNeeded,
    estimateTime,
    findSuitableSpots,
    encodeShareParams,
    decodeShareParams,
  };
})();

window.MapleCalculator = MapleCalculator;
