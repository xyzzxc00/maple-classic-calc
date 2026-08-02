/**
 * theme.js — 亮色 / 暗色模式切換
 */
(function () {
  const STORAGE_KEY = "maple_classic_theme";
  const btn = document.getElementById("themeToggle");
  const themeMetas = document.querySelectorAll('meta[name="theme-color"]');

  // 單色線條圖示（不用 emoji——emoji 在各平台長相不一、也跟整站的
  // 單色調性不合），顏色跟著按鈕文字色 currentColor 走
  const ICON_MOON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const ICON_SUN =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  function applyLabel() {
    const isDark = document.body.classList.contains("dark");
    // 圖示代表「按下去會切到哪個模式」，不是目前模式本身：暗色模式下顯示
    // 太陽（點了變亮），亮色模式下顯示月亮（點了變暗）
    btn.innerHTML = isDark ? ICON_SUN : ICON_MOON;
    btn.setAttribute("aria-label", isDark ? "切換成亮色模式" : "切換成暗色模式");
    // 兩個 theme-color meta 原本靠 media 跟 OS 深淺色連動；手動切換主題後
    // 直接覆蓋 content，讓手機瀏覽器上緣顏色跟頁面實際主題一致
    themeMetas.forEach((m) => m.setAttribute("content", isDark ? "#1C1D19" : "#F6F5F1"));
  }

  btn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");
    applyLabel();
  });

  applyLabel();
})();
