/**
 * db.js — 資料庫分頁（怪物）
 * -----------------------------------------------------------------
 * 資料放在 data/db/ 底下，切到資料庫分頁才抓（初次載入由 nav.js 觸發，
 * 見那邊的註解）。索引檔只有 9 KB，但沒來看資料庫的人不該為它付流量，
 * 所以不進主 bundle。
 *
 * 這裡只負責列表；單隻怪的詳情是另一份檔案（data/db/monsters/<id>.json），
 * 點開才抓。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    list: document.getElementById("dbMonsterList"),
    count: document.getElementById("dbMonsterCount"),
    search: document.getElementById("dbMonsterSearch"),
    region: document.getElementById("dbMonsterRegion"),
    lvMin: document.getElementById("dbMonsterLvMin"),
    lvMax: document.getElementById("dbMonsterLvMax"),
  };
  if (!els.list) return;

  let monsters = null; // null = 還沒載，[] = 載了但空的
  let loading = null; // 進行中的 fetch，避免快速切換分頁時重複抓
  let sortKey = "level";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  // 12345 → 1.2 萬：怪物 HP 動輒五位數，滿版數字在手機上會把整列擠爆
  function shortNum(n) {
    if (n == null) return "—";
    if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + " 億";
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + " 萬";
    return n.toLocaleString("zh-TW");
  }

  function renderRow(m) {
    // 屬性標籤只在「有弱點或抗性」時才出現——全部「一般」的怪佔多數，
    // 每列都掛一顆「一般」只是噪音
    const el = m.el && m.el !== "一般"
      ? `<span class="db-tag">${esc(m.el)}</span>`
      : "";
    return `<div class="db-row">
      <img class="db-row-icon" src="assets/db/monsters/${encodeURIComponent(m.id)}.png"
           alt="" loading="lazy" decoding="async" width="44" height="44">
      <div class="db-row-main">
        <div class="db-row-title">
          <span class="db-row-name">${esc(m.name)}</span>
          <span class="db-row-level">Lv.${m.level}</span>
          ${el}
        </div>
        <div class="db-row-meta">${esc((m.regions || []).join("、"))}</div>
      </div>
      <dl class="db-row-stats">
        <div><dt>HP</dt><dd>${shortNum(m.hp)}</dd></div>
        <div><dt>EXP</dt><dd>${shortNum(m.exp)}</dd></div>
        <div><dt>地圖</dt><dd>${m.maps}</dd></div>
        <div><dt>掉落</dt><dd>${m.drops}</dd></div>
      </dl>
    </div>`;
  }

  function currentFilters() {
    const q = (els.search.value || "").trim().toLowerCase();
    const region = els.region.value || "";
    const min = parseInt(els.lvMin.value, 10);
    const max = parseInt(els.lvMax.value, 10);
    return { q, region, min, max };
  }

  function render() {
    if (!monsters) return;
    const { q, region, min, max } = currentFilters();
    let rows = monsters.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (region && !(m.regions || []).includes(region)) return false;
      if (!isNaN(min) && m.level < min) return false;
      if (!isNaN(max) && m.level > max) return false;
      return true;
    });

    // 等級由低到高（練功查表的順序）；經驗值與 HP 由高到低（找目標的順序）
    rows = rows.slice().sort((a, b) =>
      sortKey === "level" ? a.level - b.level || a.name.localeCompare(b.name, "zh-TW")
        : (b[sortKey] || 0) - (a[sortKey] || 0)
    );

    els.count.textContent = `${rows.length} 隻`;
    els.list.innerHTML = rows.length
      ? rows.map(renderRow).join("")
      : '<p class="cm-empty">沒有符合條件的怪物</p>';
  }

  function fillRegionOptions() {
    const all = new Set();
    monsters.forEach((m) => (m.regions || []).forEach((r) => all.add(r)));
    [...all].sort().forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      els.region.appendChild(opt);
    });
  }

  function load() {
    if (monsters || loading) return loading || Promise.resolve();
    loading = fetch("data/db/monsters.json")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        monsters = Array.isArray(data) ? data : [];
        fillRegionOptions();
        render();
      })
      .catch(() => {
        // 跟站上其他載入失敗一樣講清楚是「載入失敗」，不要留一片空白讓人
        // 以為資料就是這樣
        monsters = null;
        els.count.textContent = "—";
        els.list.innerHTML =
          '<p class="cm-empty cm-empty--error">資料載入失敗，請重新整理頁面</p>';
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  els.search.addEventListener("input", render);
  els.region.addEventListener("change", render);
  els.lvMin.addEventListener("input", render);
  els.lvMax.addEventListener("input", render);

  document.querySelectorAll("[data-db-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sortKey = btn.dataset.dbSort;
      document
        .querySelectorAll("[data-db-sort]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });

  window.MapleDb = { load };
})();
