/**
 * backToTop.js — 右下角「回到最上面」浮動按鈕
 * -----------------------------------------------------------------
 * 主站跟 guides/ 攻略頁共用（跟 theme.js 一樣的載入模式：主站打包進
 * bundle.js，guides 頁面各自用 <script defer> 單獨載入，deploy.yml
 * 會另外壓縮一份 dist/js/backToTop.js 給 guides 用）。
 * 按鈕用 JS 動態建立，不用每個 HTML 都手動加一份標記。
 * -----------------------------------------------------------------
 */
(function () {
  // 捲超過大約一個螢幕高才顯示：還在頁面頂端附近就不用回頂，別讓按鈕
  // 一進頁面就擋在角落
  const SHOW_AFTER_PX = 400;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "回到最上面");
  // SVG 箭頭而不是文字字元：各平台對「↑」的字型渲染差很多，SVG 才能保證
  // 置中與粗細一致
  btn.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
    '<path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";
  document.body.appendChild(btn);

  btn.addEventListener("click", () => {
    // 使用者系統設定「減少動態效果」時直接跳，不播平滑捲動
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });

  // scroll 事件觸發非常頻繁，用 rAF 節流：一個影格內不管捲幾次只判斷一次
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      btn.classList.toggle("visible", window.scrollY > SHOW_AFTER_PX);
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
