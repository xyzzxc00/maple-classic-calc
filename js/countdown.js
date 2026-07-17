/**
 * countdown.js — 事前預約截止／開服倒數
 * -----------------------------------------------------------------
 * 官方 beanfun 活動頁寫的是「事前預約活動時間：2026/07/01(三)-2026/07/28(二)
 * 23:59止」，預約期間倒數的是「預約截止」，不是「開服」——兩者搞混會誤導玩家。
 * 開服日期已確定為 2026/07/29，但官方尚未公布正式開服「時刻」。
 *
 * ★ 官方公布開服時間後，只要把下面的 LAUNCH_TS 從 null 改成該時刻
 *   （例如 "2026-07-29T10:00:00+08:00"），預約截止後就會自動接著倒數開服，
 *   其他什麼都不用改。LAUNCH_TS 保持 null 的話，截止後顯示靜態文字。
 * -----------------------------------------------------------------
 */
(function () {
  const DEADLINE = new Date("2026-07-28T23:59:00+08:00").getTime();
  // 官方確切開服時刻（未公布前保持 null，公布後填入 ISO 字串）
  const LAUNCH_TS = null;

  const el = document.getElementById("countdownTime");
  const labelEl = document.querySelector("#preregCountdown .countdown-label");
  if (!el) return;

  const launchAt = LAUNCH_TS ? new Date(LAUNCH_TS).getTime() : null;

  function formatDiff(diff) {
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${days} 天 ${hours} 時 ${mins} 分 ${secs} 秒`;
  }

  function render() {
    const now = Date.now();

    // 階段一：事前預約還沒截止 → 倒數預約截止（HTML 預設的 label 就是這個）
    if (now < DEADLINE) {
      el.textContent = formatDiff(DEADLINE - now);
      return;
    }

    // 階段二：預約截止後，官方開服時刻已公布且還沒到 → 倒數開服
    if (launchAt && now < launchAt) {
      if (labelEl) labelEl.textContent = "距離 7/29 正式開服還有";
      el.textContent = formatDiff(launchAt - now);
      return;
    }

    // 階段三：開服時刻已過（或未公布確切時刻）→ 靜態文字
    if (labelEl) labelEl.textContent = "新楓之谷經典版";
    el.textContent = launchAt && now >= launchAt
      ? "已經開服，楓之谷見！"
      : "事前預約已截止，經典版確定 7/29 上線！";
  }

  render();
  setInterval(render, 1000);
})();
