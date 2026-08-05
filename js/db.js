/**
 * db.js — 資料庫分頁（怪物）
 * -----------------------------------------------------------------
 * 資料放在 data/db/ 底下，切到資料庫分頁才抓（初次載入由 nav.js 觸發，
 * 見那邊的註解）。索引檔只有 9 KB，但沒來看資料庫的人不該為它付流量，
 * 所以不進主 bundle。
 *
 * 列表與詳情是同一個分頁裡互相取代的兩個狀態。詳情有自己的網址
 * （?db=monster&id=…）才能分享、重整、加書籤——這點跟 #calc-scroll 那類
 * 錨點不同，錨點是用完就抹掉的一次性指令，這裡的網址要留著。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    listPanel: document.getElementById("dbMonsterListPanel"),
    detail: document.getElementById("dbMonsterDetail"),
    list: document.getElementById("dbMonsterList"),
    count: document.getElementById("dbMonsterCount"),
    search: document.getElementById("dbMonsterSearch"),
    region: document.getElementById("dbMonsterRegion"),
    lvMin: document.getElementById("dbMonsterLvMin"),
    lvMax: document.getElementById("dbMonsterLvMax"),
  };
  if (!els.list || !els.detail) return;

  let monsters = null; // null = 還沒載，[] = 載了但空的
  let loading = null; // 進行中的 fetch，避免快速切換分頁時重複抓
  let sortKey = "level";
  const detailCache = new Map();

  // 只標我確定語意的欄位。拆包資料還有 pushed／elemAttr／rareItemDropLevel
  // 這些欄位，語意沒把握就不要猜著標——標錯比不標更糟
  const STAT_LABELS = [
    ["maxHP", "HP"],
    ["maxMP", "MP"],
    ["exp", "經驗值"],
    ["PADamage", "物理攻擊"],
    ["PDDamage", "物理防禦"],
    ["MADamage", "魔法攻擊"],
    ["MDDamage", "魔法防禦"],
    ["acc", "命中"],
    ["eva", "迴避"],
    ["speed", "移動速度"],
  ];
  const FLAGS = [
    ["boss", "BOSS"],
    ["undead", "不死系"],
    ["firstAttack", "主動攻擊"],
    ["bodyAttack", "碰撞傷害"],
  ];
  const EL_NAME = { fire: "火", ice: "冰", lightning: "雷", poison: "毒", holy: "聖" };
  const EL_LABEL = { normal: "一般", weak: "弱點", resist: "抗性", immune: "免疫" };
  const DROP_ORDER = ["裝備", "消耗", "其他", "裝飾"];

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

  function monsterImg(id, size) {
    return `<img class="db-row-icon" src="assets/db/monsters/${encodeURIComponent(id)}.png"
      alt="" loading="lazy" decoding="async" width="${size}" height="${size}">`;
  }

  // ------------------------------------------------------------- 列表

  function renderRow(m) {
    // 屬性標籤只在「有弱點或抗性」時才出現——全部「一般」的怪佔多數，
    // 每列都掛一顆「一般」只是噪音
    const el = m.el && m.el !== "一般" ? `<span class="db-tag">${esc(m.el)}</span>` : "";
    return `<button class="db-row" type="button" data-db-id="${esc(m.id)}">
      ${monsterImg(m.id, 44)}
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
    </button>`;
  }

  function render() {
    if (!monsters) return;
    const q = (els.search.value || "").trim().toLowerCase();
    const region = els.region.value || "";
    const min = parseInt(els.lvMin.value, 10);
    const max = parseInt(els.lvMax.value, 10);

    let rows = monsters.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (region && !(m.regions || []).includes(region)) return false;
      if (!isNaN(min) && m.level < min) return false;
      if (!isNaN(max) && m.level > max) return false;
      return true;
    });

    // 等級由低到高（練功查表的順序）；經驗值與 HP 由高到低（找目標的順序）
    rows = rows.slice().sort((a, b) =>
      sortKey === "level"
        ? a.level - b.level || a.name.localeCompare(b.name, "zh-TW")
        : (b[sortKey] || 0) - (a[sortKey] || 0)
    );

    els.count.textContent = `${rows.length} 隻`;
    els.list.innerHTML = rows.length
      ? rows.map(renderRow).join("")
      : '<p class="cm-empty">沒有符合條件的怪物</p>';
  }

  // ------------------------------------------------------------- 詳情

  function renderStats(d) {
    const cells = STAT_LABELS.filter(([k]) => d.stats[k] != null)
      .map(
        ([k, label]) =>
          `<div><dt>${label}</dt><dd>${(d.stats[k]).toLocaleString("zh-TW")}</dd></div>`
      )
      .join("");
    return `<dl class="db-stat-grid">${cells}</dl>`;
  }

  function renderElemental(d) {
    const vals = d.elemental.values || {};
    const cells = Object.keys(EL_NAME)
      .map((k) => {
        const v = vals[k] || "normal";
        return `<div class="db-el db-el--${v}">
          <span class="db-el-name">${EL_NAME[k]}</span>
          <span class="db-el-value">${EL_LABEL[v] || v}</span>
        </div>`;
      })
      .join("");
    return `<div class="db-el-row">${cells}</div>`;
  }

  function renderMaps(d) {
    if (!d.maps.length) return '<p class="cm-empty">沒有出沒地圖資料</p>';
    return `<div class="db-sub-list">${d.maps
      .map(
        (m) => `<div class="db-sub-item">
          <span class="db-sub-name">${esc(m.name)}</span>
          <span class="db-sub-meta">${esc([m.region, m.street].filter(Boolean).join(" · "))}</span>
          <span class="db-sub-num">${m.spawns} 個重生點</span>
        </div>`
      )
      .join("")}</div>`;
  }

  function renderDrops(d) {
    if (!d.drops.length) return '<p class="cm-empty">沒有掉落資料</p>';
    const groups = new Map();
    d.drops.forEach((x) => {
      if (!groups.has(x.cat)) groups.set(x.cat, []);
      groups.get(x.cat).push(x);
    });
    const order = [...groups.keys()].sort(
      (a, b) => (DROP_ORDER.indexOf(a) + 1 || 99) - (DROP_ORDER.indexOf(b) + 1 || 99)
    );
    return order
      .map((cat) => {
        const items = groups.get(cat);
        return `<div class="db-drop-group">
          <div class="db-drop-cat">${esc(cat)}<span class="db-sub-num">${items.length}</span></div>
          <div class="db-drop-grid">${items
            .map((x) => {
              const bits = [];
              if (x.equip && x.equip.reqLevel) bits.push(`需求 Lv.${x.equip.reqLevel}`);
              if (x.sell) bits.push(`賣店 ${x.sell.toLocaleString("zh-TW")}`);
              return `<div class="db-drop-item">
                <img class="db-drop-icon" src="assets/db/items/${encodeURIComponent(x.id)}.png"
                     alt="" loading="lazy" decoding="async" width="32" height="32">
                <span class="db-drop-text">
                  <span class="db-drop-name">${esc(x.name)}</span>
                  <span class="db-drop-meta">${esc([x.sub, ...bits].filter(Boolean).join(" · "))}</span>
                </span>
              </div>`;
            })
            .join("")}</div>
        </div>`;
      })
      .join("");
  }

  // ---------------------------------------------- 練等試算（接既有計算機）

  const CALC_PREFS_KEY = "maple_classic_v3";
  const DB_RATE_KEY = "maple_classic_db_kill_rate";

  function calcPrefs() {
    try {
      return JSON.parse(localStorage.getItem(CALC_PREFS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function expToNext(level) {
    const table = (window.MapleData || {}).EXP_TABLE;
    // index 0 = Lv.1 升 Lv.2，所以 Lv.N 升級所需在 index N-1
    return Array.isArray(table) && level >= 1 && level <= table.length
      ? table[level - 1]
      : null;
  }

  function renderKillCalc(d) {
    const exp = (d.stats || {}).exp;
    if (!exp) return "";
    const lv = parseInt(calcPrefs().currentLevel, 10);
    const level = lv >= 1 && lv <= 199 ? lv : 1;
    const rate = parseInt(localStorage.getItem(DB_RATE_KEY), 10) || 10;
    return `<section class="db-section" id="dbKillCalc" data-exp="${exp}">
      <h3 class="db-section-title">練等試算</h3>
      <div class="cm-filter-row">
        <label class="db-calc-field">目前等級
          <input class="cm-filter-input cm-filter-lv" id="dbCalcLevel" type="number"
                 min="1" max="199" value="${level}" inputmode="numeric">
        </label>
        <label class="db-calc-field">每分鐘打幾隻
          <input class="cm-filter-input cm-filter-lv" id="dbCalcRate" type="number"
                 min="1" max="999" value="${rate}" inputmode="numeric">
        </label>
      </div>
      <div id="dbKillResult"></div>
    </section>`;
  }

  function renderKillResult() {
    const box = document.getElementById("dbKillCalc");
    const out = document.getElementById("dbKillResult");
    if (!box || !out) return;
    const exp = parseInt(box.dataset.exp, 10);
    const level = parseInt(document.getElementById("dbCalcLevel").value, 10);
    const rate = parseInt(document.getElementById("dbCalcRate").value, 10);
    const need = expToNext(level);
    if (!need || !(rate > 0)) {
      out.innerHTML = '<p class="db-section-note">填入 1~199 的等級與每分鐘隻數就會算出來。</p>';
      return;
    }
    localStorage.setItem(DB_RATE_KEY, String(rate));
    const kills = Math.ceil(need / exp);
    const minutes = kills / rate;
    const per10 = exp * rate * 10;
    const hh = Math.floor(minutes / 60);
    const mm = Math.round(minutes % 60);
    out.innerHTML = `<dl class="db-stat-grid">
        <div><dt>升到 Lv.${level + 1} 要打</dt><dd>${kills.toLocaleString("zh-TW")} 隻</dd></div>
        <div><dt>大約耗時</dt><dd>${hh ? hh + " 小時 " : ""}${mm} 分</dd></div>
        <div><dt>每 10 分鐘經驗</dt><dd>${per10.toLocaleString("zh-TW")}</dd></div>
      </dl>
      <p class="db-section-note">純理論值：只算怪物經驗，沒有扣掉移動、補血、撿裝備的時間，也沒有計入加倍卷。想要含加倍卷、每日時數的完整估算，用下面的按鈕把數字帶進練等計算機。</p>
      <button class="btn btn-ghost" type="button" id="dbToCalc">把每 10 分鐘 ${per10.toLocaleString("zh-TW")} EXP 帶進練等計算機 →</button>`;
  }

  // 把算出來的效率寫進計算機的欄位、跑一次計算，再切過去。用 MapleApp
  // 現成的 runCalculation（它內部會存 prefs），不另外碰 localStorage
  function sendToCalculator() {
    const out = document.getElementById("dbKillResult");
    const box = document.getElementById("dbKillCalc");
    if (!out || !box) return;
    const exp = parseInt(box.dataset.exp, 10);
    const rate = parseInt(document.getElementById("dbCalcRate").value, 10);
    const level = parseInt(document.getElementById("dbCalcLevel").value, 10);
    const per10 = exp * rate * 10;
    const lvInput = document.getElementById("currentLevel");
    const expInput = document.getElementById("expPer10Min");
    if (!lvInput || !expInput) return;
    if (level >= 1 && level <= 199) lvInput.value = level;
    expInput.value = per10;
    if (window.MapleApp) window.MapleApp.runCalculation();
    if (window.MapleNav) {
      window.MapleNav.switchNav("calc");
      window.MapleNav.showCalcSubtab("exp");
    }
  }

  function renderQuests(d) {
    if (!d.quests.length) return "";
    return `<section class="db-section">
      <h3 class="db-section-title">相關任務<span class="db-sub-num">${d.quests.length}</span></h3>
      <div class="db-sub-list">${d.quests
        .map(
          (q) => `<div class="db-sub-item">
            <span class="db-sub-name">${esc(q.name)}</span>
            <span class="db-sub-meta">${esc(q.stage)}</span>
            <span class="db-sub-num">${q.count ? "需要 " + q.count + " 個" : ""}</span>
          </div>`
        )
        .join("")}</div>
    </section>`;
  }

  function renderDetail(d) {
    const flags = FLAGS.filter(([k]) => d.stats[k])
      .map(([, label]) => `<span class="db-tag">${label}</span>`)
      .join("");
    const meso =
      d.meso && d.meso.max
        ? `<section class="db-section">
             <h3 class="db-section-title">楓幣掉落</h3>
             <p class="db-meso">${d.meso.min === d.meso.max
               ? d.meso.min.toLocaleString("zh-TW")
               : `${d.meso.min.toLocaleString("zh-TW")} ~ ${d.meso.max.toLocaleString("zh-TW")}`}
               ${d.meso.note ? `<span class="db-sub-meta">（${esc(d.meso.note)}）</span>` : ""}</p>
           </section>`
        : "";

    return `<button class="db-back" type="button" id="dbBackBtn">← 回到怪物列表</button>
      <div class="db-detail-head">
        ${monsterImg(d.id, 64)}
        <div>
          <div class="db-row-title">
            <h2 class="db-detail-name">${esc(d.name)}</h2>
            <span class="db-row-level">Lv.${d.level}</span>
            ${flags}
          </div>
          ${d.desc ? `<p class="db-detail-desc">${esc(d.desc)}</p>` : ""}
        </div>
      </div>

      <section class="db-section">
        <h3 class="db-section-title">數值</h3>
        ${renderStats(d)}
      </section>

      ${renderKillCalc(d)}

      <section class="db-section">
        <h3 class="db-section-title">屬性抗性</h3>
        ${renderElemental(d)}
      </section>

      ${meso}

      <section class="db-section">
        <h3 class="db-section-title">出沒地圖<span class="db-sub-num">${d.maps.length}</span></h3>
        ${renderMaps(d)}
        <p class="db-section-note">上面是遊戲資料檔記錄的重生點數量，不等於實際練功效率。
          <button class="db-inline-link" type="button" id="dbToSpots">看玩家實測的練功效率 →</button></p>
      </section>

      <section class="db-section">
        <h3 class="db-section-title">掉落物品<span class="db-sub-num">${d.drops.length}</span></h3>
        <p class="db-section-note">遊戲資料檔沒有記錄掉落機率，這裡只列出「會掉什麼」。</p>
        ${renderDrops(d)}
      </section>

      ${renderQuests(d)}`;
  }

  // ------------------------------------------------------------- 切換與網址

  function showList() {
    els.detail.hidden = true;
    els.detail.innerHTML = "";
    els.listPanel.hidden = false;
  }

  function showDetail(id) {
    els.listPanel.hidden = true;
    els.detail.hidden = false;
    const cached = detailCache.get(String(id));
    if (cached) {
      els.detail.innerHTML = renderDetail(cached);
      renderKillResult();
      return Promise.resolve();
    }
    els.detail.innerHTML = '<p class="cm-loading">載入中...</p>';
    return fetch(`data/db/monsters/${encodeURIComponent(id)}.json`)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((d) => {
        detailCache.set(String(id), d);
        els.detail.innerHTML = renderDetail(d);
        renderKillResult();
      })
      .catch(() => {
        els.detail.innerHTML =
          '<button class="db-back" type="button" id="dbBackBtn">← 回到怪物列表</button>' +
          '<p class="cm-empty cm-empty--error">這隻怪的資料載入失敗</p>';
      });
  }

  function routeUrl(id) {
    return id
      ? `${location.pathname}?db=monster&id=${encodeURIComponent(id)}`
      : location.pathname;
  }

  function openDetail(id, push) {
    if (push) history.pushState({ dbMonster: String(id) }, "", routeUrl(id));
    showDetail(id).then(() => window.scrollTo(0, 0));
  }

  function closeDetail(push) {
    if (push) history.pushState({}, "", routeUrl(null));
    showList();
    window.scrollTo(0, 0);
  }

  function currentRouteId() {
    const p = new URLSearchParams(location.search);
    return p.get("db") === "monster" ? p.get("id") : null;
  }

  // ------------------------------------------------------------- 載入

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
        // 直接用詳情網址進站的話，索引載完就接著開那一筆
        const id = currentRouteId();
        if (id) showDetail(id);
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

  // ------------------------------------------------------------- 事件

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

  els.list.addEventListener("click", (e) => {
    const row = e.target.closest("[data-db-id]");
    if (row) openDetail(row.dataset.dbId, true);
  });

  // 詳情是每次重新產生的，所以事件掛在容器上做委派，不逐個綁
  els.detail.addEventListener("click", (e) => {
    if (e.target.closest("#dbBackBtn")) closeDetail(true);
    else if (e.target.closest("#dbToCalc")) sendToCalculator();
    else if (e.target.closest("#dbToSpots") && window.MapleNav && window.MapleCommunity) {
      window.MapleNav.switchNav("cm");
      window.MapleCommunity.showCmSubtab("suggest");
    }
  });

  els.detail.addEventListener("input", (e) => {
    if (e.target.id === "dbCalcLevel" || e.target.id === "dbCalcRate") renderKillResult();
  });

  window.addEventListener("popstate", () => {
    const id = currentRouteId();
    if (id) showDetail(id);
    else showList();
  });

  // 切到別的分頁時把詳情關掉、網址也還原。不這麼做的話，人在「社群資料」
  // 而網址還寫著 ?db=monster&id=…，一重整又被帶回怪物詳情——跟先前錨點
  // 殘留在網址列是同一種毛病
  document.addEventListener("maplenav:pagechange", (e) => {
    const page = e.detail && e.detail.page;
    if (page !== "db" && currentRouteId()) {
      history.replaceState({}, "", routeUrl(null));
      showList();
    }
  });

  window.MapleDb = { load };
})();
