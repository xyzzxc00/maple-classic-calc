/**
 * countdown.js — 事前預約截止倒數
 * -----------------------------------------------------------------
 * 官方 beanfun 活動頁寫的是「事前預約活動時間：2026/07/01(三)-2026/07/28(二)
 * 23:59止」，目前沒有公布正式開服日期，所以這裡倒數的是「預約截止」，
 * 不是「開服」——兩者搞混會誤導玩家。
 * -----------------------------------------------------------------
 */
(function () {
  const DEADLINE = new Date("2026-07-28T23:59:00+08:00").getTime();
  const el = document.getElementById("countdownTime");
  if (!el) return;

  function render() {
    const diff = DEADLINE - Date.now();
    if (diff <= 0) {
      el.textContent = "事前預約已截止";
      return;
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    el.textContent = `${days} 天 ${hours} 時 ${mins} 分 ${secs} 秒`;
  }

  render();
  setInterval(render, 1000);
})();
