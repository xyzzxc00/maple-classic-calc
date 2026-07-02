/**
 * theme.js — 亮色 / 暗色模式切換
 */
(function () {
  const STORAGE_KEY = "maple_classic_theme";
  const btn = document.getElementById("themeToggle");
  const themeMetas = document.querySelectorAll('meta[name="theme-color"]');

  function applyLabel() {
    const isDark = document.body.classList.contains("dark");
    btn.textContent = isDark ? "☀️ 亮色" : "🌙 暗色";
    // 兩個 theme-color meta 原本靠 media 跟 OS 深淺色連動；手動切換主題後
    // 直接覆蓋 content，讓手機瀏覽器上緣顏色跟頁面實際主題一致
    themeMetas.forEach((m) => m.setAttribute("content", isDark ? "#0E1A2B" : "#5EC4E8"));
  }

  btn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");
    applyLabel();
  });

  applyLabel();
})();
