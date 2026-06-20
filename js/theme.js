/**
 * theme.js — 亮色 / 暗色模式切換
 */
(function () {
  const STORAGE_KEY = "maple_classic_theme";
  const btn = document.getElementById("themeToggle");

  function applyLabel() {
    const isDark = document.body.classList.contains("dark");
    btn.textContent = isDark ? "☀️ 亮色" : "🌙 暗色";
  }

  btn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");
    applyLabel();
  });

  applyLabel();
})();
