/**
 * db.js — 資料庫分頁
 * -----------------------------------------------------------------
 * 資料放在 data/db/ 底下，切到資料庫分頁才抓（初次載入由 nav.js 觸發，
 * 見那邊的註解）。索引檔只有幾十 KB，但沒來看資料庫的人不該為它付流量，
 * 所以不進主 bundle。
 *
 * 每個資料集（怪物／技能／…）都是「索引 + 逐筆詳情」兩層：索引供列表與
 * 篩選用、要夠小；詳情點開才抓、抓過就留著。列表與詳情是同一個子分頁裡
 * 互相取代的兩個狀態。
 *
 * 詳情有自己的網址（?db=monster&id=…）才能分享、重整、加書籤——這點跟
 * #calc-scroll 那類「開哪個分頁」的一次性錨點不同，那種用完就抹掉。
 * -----------------------------------------------------------------
 */
(function () {
  const page = document.getElementById("pageDb");
  if (!page) return;

  // ---------------------------------------------------------------- 共用

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

  function num(n) {
    return n == null ? "—" : n.toLocaleString("zh-TW");
  }

  function getJson(url) {
    return fetch(url).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  const LOAD_ERROR = '<p class="cm-empty cm-empty--error">資料載入失敗，請重新整理頁面</p>';

  // ---------------------------------------------------------- 資料集框架

  /**
   * 把一個資料集接起來：載索引 → 篩選排序渲染列表 → 點開詳情 → 網址路由。
   * 各資料集只需要提供自己的 renderRow / renderDetail 與篩選設定。
   */
  function makeSet(cfg) {
    const els = {
      listPanel: document.getElementById(cfg.prefix + "ListPanel"),
      detail: document.getElementById(cfg.prefix + "Detail"),
      list: document.getElementById(cfg.prefix + "List"),
      count: document.getElementById(cfg.prefix + "Count"),
    };
    if (!els.list || !els.detail) return null;

    const filterEls = {};
    (cfg.filters || []).forEach((f) => {
      filterEls[f.id] = document.getElementById(cfg.prefix + f.id);
    });

    let index = null;
    let loading = null;
    let sortKey = (cfg.sorts && cfg.sorts[0] && cfg.sorts[0].key) || null;
    const cache = new Map();

    function filterValues() {
      const out = {};
      Object.keys(filterEls).forEach((k) => {
        out[k] = filterEls[k] ? filterEls[k].value : "";
      });
      return out;
    }

    function render() {
      if (!index) return;
      const v = filterValues();
      let rows = index.filter((row) => (cfg.filters || []).every((f) => f.test(row, v[f.id])));
      const sorter = (cfg.sorts || []).find((s) => s.key === sortKey);
      if (sorter) rows = rows.slice().sort(sorter.cmp);
      if (els.count) els.count.textContent = `${rows.length} ${cfg.unit}`;
      els.list.innerHTML = rows.length
        ? rows.map(cfg.renderRow).join("")
        : `<p class="cm-empty">沒有符合條件的${cfg.label}</p>`;
    }

    function showList() {
      els.detail.hidden = true;
      els.detail.innerHTML = "";
      els.listPanel.hidden = false;
    }

    function showDetail(id) {
      els.listPanel.hidden = true;
      els.detail.hidden = false;
      const cached = cache.get(String(id));
      if (cached) {
        els.detail.innerHTML = cfg.renderDetail(cached);
        if (cfg.afterDetail) cfg.afterDetail(cached);
        return Promise.resolve();
      }
      els.detail.innerHTML = '<p class="cm-loading">載入中...</p>';
      return getJson(`data/db/${cfg.dir}/${encodeURIComponent(id)}.json`)
        .then((d) => {
          cache.set(String(id), d);
          els.detail.innerHTML = cfg.renderDetail(d);
          if (cfg.afterDetail) cfg.afterDetail(d);
        })
        .catch(() => {
          els.detail.innerHTML =
            '<button class="db-back" type="button" data-db-back>← 回到列表</button>' +
            `<p class="cm-empty cm-empty--error">這筆${cfg.label}資料載入失敗</p>`;
        });
    }

    function load() {
      if (index || loading) return loading || Promise.resolve();
      loading = getJson(`data/db/${cfg.dir}.json`)
        .then((data) => {
          index = Array.isArray(data) ? data : [];
          if (cfg.fillFilters) cfg.fillFilters(index, filterEls);
          render();
          const route = currentRoute();
          if (route && route.set === cfg.route) showDetail(route.id);
        })
        .catch(() => {
          index = null;
          if (els.count) els.count.textContent = "—";
          els.list.innerHTML = LOAD_ERROR;
        })
        .finally(() => {
          loading = null;
        });
      return loading;
    }

    Object.keys(filterEls).forEach((k) => {
      const el = filterEls[k];
      if (el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", render);
    });
    page.querySelectorAll(`[data-db-sort][data-db-set="${cfg.route}"]`).forEach((btn) => {
      btn.addEventListener("click", () => {
        sortKey = btn.dataset.dbSort;
        page
          .querySelectorAll(`[data-db-sort][data-db-set="${cfg.route}"]`)
          .forEach((b) => b.classList.toggle("active", b === btn));
        render();
      });
    });
    els.list.addEventListener("click", (e) => {
      const row = e.target.closest("[data-db-id]");
      if (row) openDetail(cfg.route, row.dataset.dbId, true);
    });
    els.detail.addEventListener("click", (e) => {
      const goto = e.target.closest("[data-db-goto]");
      if (e.target.closest("[data-db-back]")) closeDetail(true);
      // 詳情裡跨資料集的連結（任務→怪物、任務→技能…）：只有本站真的收錄
      // 那一筆時才會產生這種元素，不然點了會開到 404
      else if (goto) openDetail(goto.dataset.dbGoto, goto.dataset.dbId, true);
      else if (cfg.onDetailClick) cfg.onDetailClick(e);
    });
    if (cfg.onDetailInput) els.detail.addEventListener("input", cfg.onDetailInput);

    return { load, showList, showDetail, route: cfg.route, key: cfg.key };
  }

  // ------------------------------------------------------------- 網址路由

  function currentRoute() {
    const p = new URLSearchParams(location.search);
    const set = p.get("db");
    const id = p.get("id");
    return set && id ? { set, id } : null;
  }

  function routeUrl(set, id) {
    return set && id
      ? `${location.pathname}?db=${encodeURIComponent(set)}&id=${encodeURIComponent(id)}`
      : location.pathname;
  }

  function openDetail(set, id, push) {
    const s = SETS.find((x) => x.route === set);
    if (!s) return;
    showTab(s.key, true);
    if (push) history.pushState({ db: set, id: String(id) }, "", routeUrl(set, id));
    s.showDetail(id).then(() => window.scrollTo(0, 0));
  }

  function closeDetail(push) {
    if (push) history.pushState({}, "", routeUrl(null));
    SETS.forEach((s) => s.showList());
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------- 子分頁

  const TAB_KEY = "maple_classic_db_subtab";
  const tabs = [];

  function showTab(key, skipSave) {
    tabs.forEach((t) => {
      const active = t.key === key;
      t.view.hidden = !active;
      t.btn.classList.toggle("active", active);
      t.btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (!skipSave) localStorage.setItem(TAB_KEY, key);
  }

  // ------------------------------------------------------ 怪物：練等試算

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
    return Array.isArray(table) && level >= 1 && level <= table.length ? table[level - 1] : null;
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
        <div><dt>升到 Lv.${level + 1} 要打</dt><dd>${num(kills)} 隻</dd></div>
        <div><dt>大約耗時</dt><dd>${hh ? hh + " 小時 " : ""}${mm} 分</dd></div>
        <div><dt>每 10 分鐘經驗</dt><dd>${num(per10)}</dd></div>
      </dl>
      <p class="db-section-note">純理論值：只算怪物經驗，沒有扣掉移動、補血、撿裝備的時間，也沒有計入加倍卷。想要含加倍卷、每日時數的完整估算，用下面的按鈕把數字帶進練等計算機。</p>
      <button class="btn btn-ghost" type="button" id="dbToCalc">把每 10 分鐘 ${num(per10)} EXP 帶進練等計算機 →</button>`;
  }

  // 把算出來的效率寫進計算機的欄位、跑一次計算，再切過去。用 MapleApp
  // 現成的 runCalculation（它內部會存 prefs），不另外碰 localStorage
  function sendToCalculator() {
    const box = document.getElementById("dbKillCalc");
    if (!box) return;
    const exp = parseInt(box.dataset.exp, 10);
    const rate = parseInt(document.getElementById("dbCalcRate").value, 10);
    const level = parseInt(document.getElementById("dbCalcLevel").value, 10);
    const lvInput = document.getElementById("currentLevel");
    const expInput = document.getElementById("expPer10Min");
    if (!lvInput || !expInput) return;
    if (level >= 1 && level <= 199) lvInput.value = level;
    expInput.value = exp * rate * 10;
    if (window.MapleApp) window.MapleApp.runCalculation();
    if (window.MapleNav) {
      window.MapleNav.switchNav("calc");
      window.MapleNav.showCalcSubtab("exp");
    }
  }

  // ------------------------------------------------------------- 怪物

  const EL_NAME = { fire: "火", ice: "冰", lightning: "雷", poison: "毒", holy: "聖" };
  const EL_LABEL = { normal: "一般", weak: "弱點", resist: "抗性", immune: "免疫" };
  const DROP_ORDER = ["裝備", "消耗", "其他", "裝飾"];
  // 只標我確定語意的欄位。拆包資料還有 pushed／elemAttr／rareItemDropLevel
  // 這些欄位，語意沒把握就不要猜著標——標錯比不標更糟
  const STAT_LABELS = [
    ["maxHP", "HP"], ["maxMP", "MP"], ["exp", "經驗值"],
    ["PADamage", "物理攻擊"], ["PDDamage", "物理防禦"],
    ["MADamage", "魔法攻擊"], ["MDDamage", "魔法防禦"],
    ["acc", "命中"], ["eva", "迴避"], ["speed", "移動速度"],
  ];
  const FLAGS = [
    ["boss", "BOSS"], ["undead", "不死系"],
    ["firstAttack", "主動攻擊"], ["bodyAttack", "碰撞傷害"],
  ];

  function monsterImg(id, size) {
    return `<img class="db-row-icon" src="assets/db/monsters/${encodeURIComponent(id)}.png"
      alt="" loading="lazy" decoding="async" width="${size}" height="${size}">`;
  }

  const monsters = makeSet({
    key: "monsters",
    route: "monster",
    dir: "monsters",
    prefix: "dbMonster",
    label: "怪物",
    unit: "隻",
    filters: [
      { id: "Search", test: (r, v) => !v || r.name.toLowerCase().includes(v.trim().toLowerCase()) },
      { id: "Region", test: (r, v) => !v || (r.regions || []).includes(v) },
      { id: "LvMin", test: (r, v) => !v || r.level >= parseInt(v, 10) },
      { id: "LvMax", test: (r, v) => !v || r.level <= parseInt(v, 10) },
    ],
    sorts: [
      // 等級由低到高（練功查表的順序）；經驗值與 HP 由高到低（找目標的順序）
      { key: "level", cmp: (a, b) => a.level - b.level || a.name.localeCompare(b.name, "zh-TW") },
      { key: "exp", cmp: (a, b) => (b.exp || 0) - (a.exp || 0) },
      { key: "hp", cmp: (a, b) => (b.hp || 0) - (a.hp || 0) },
    ],
    fillFilters(index, els) {
      const all = new Set();
      index.forEach((m) => (m.regions || []).forEach((r) => all.add(r)));
      [...all].sort().forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        els.Region.appendChild(opt);
      });
    },
    renderRow(m) {
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
    },
    renderDetail(d) {
      const flags = FLAGS.filter(([k]) => d.stats[k])
        .map(([, label]) => `<span class="db-tag">${label}</span>`)
        .join("");
      const stats = STAT_LABELS.filter(([k]) => d.stats[k] != null)
        .map(([k, label]) => `<div><dt>${label}</dt><dd>${num(d.stats[k])}</dd></div>`)
        .join("");
      const elems = Object.keys(EL_NAME)
        .map((k) => {
          const v = (d.elemental.values || {})[k] || "normal";
          return `<div class="db-el db-el--${v}">
            <span class="db-el-name">${EL_NAME[k]}</span>
            <span class="db-el-value">${EL_LABEL[v] || v}</span>
          </div>`;
        })
        .join("");
      const maps = d.maps.length
        ? `<div class="db-sub-list">${d.maps
            .map(
              (m) => `<div class="db-sub-item">
                <span class="db-sub-name">${esc(m.name)}</span>
                <span class="db-sub-meta">${esc([m.region, m.street].filter(Boolean).join(" · "))}</span>
                <span class="db-sub-num">${m.spawns} 個重生點</span>
              </div>`
            )
            .join("")}</div>`
        : '<p class="cm-empty">沒有出沒地圖資料</p>';

      let drops = '<p class="cm-empty">沒有掉落資料</p>';
      if (d.drops.length) {
        const groups = new Map();
        d.drops.forEach((x) => {
          if (!groups.has(x.cat)) groups.set(x.cat, []);
          groups.get(x.cat).push(x);
        });
        drops = [...groups.keys()]
          .sort((a, b) => (DROP_ORDER.indexOf(a) + 1 || 99) - (DROP_ORDER.indexOf(b) + 1 || 99))
          .map((cat) => {
            const items = groups.get(cat);
            return `<div class="db-drop-group">
              <div class="db-drop-cat">${esc(cat)}<span class="db-sub-num">${items.length}</span></div>
              <div class="db-drop-grid">${items
                .map((x) => {
                  const bits = [];
                  if (x.equip && x.equip.reqLevel) bits.push(`需求 Lv.${x.equip.reqLevel}`);
                  if (x.sell) bits.push(`賣店 ${num(x.sell)}`);
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

      const quests = d.quests.length
        ? `<section class="db-section">
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
          </section>`
        : "";

      const meso =
        d.meso && d.meso.max
          ? `<section class="db-section">
               <h3 class="db-section-title">楓幣掉落</h3>
               <p class="db-meso">${d.meso.min === d.meso.max ? num(d.meso.min) : `${num(d.meso.min)} ~ ${num(d.meso.max)}`}
                 ${d.meso.note ? `<span class="db-sub-meta">（${esc(d.meso.note)}）</span>` : ""}</p>
             </section>`
          : "";

      return `<button class="db-back" type="button" data-db-back>← 回到怪物列表</button>
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
          <dl class="db-stat-grid">${stats}</dl>
        </section>
        ${renderKillCalc(d)}
        <section class="db-section">
          <h3 class="db-section-title">屬性抗性</h3>
          <div class="db-el-row">${elems}</div>
        </section>
        ${meso}
        <section class="db-section">
          <h3 class="db-section-title">出沒地圖<span class="db-sub-num">${d.maps.length}</span></h3>
          ${maps}
          <p class="db-section-note">上面是遊戲資料檔記錄的重生點數量，不等於實際練功效率。
            <button class="db-inline-link" type="button" id="dbToSpots">看玩家實測的練功效率 →</button></p>
        </section>
        <section class="db-section">
          <h3 class="db-section-title">掉落物品<span class="db-sub-num">${d.drops.length}</span></h3>
          <p class="db-section-note">遊戲資料檔沒有記錄掉落機率，這裡只列出「會掉什麼」。</p>
          ${drops}
        </section>
        ${quests}`;
    },
    afterDetail: renderKillResult,
    onDetailClick(e) {
      if (e.target.closest("#dbToCalc")) sendToCalculator();
      else if (e.target.closest("#dbToSpots") && window.MapleNav && window.MapleCommunity) {
        window.MapleNav.switchNav("cm");
        window.MapleCommunity.showCmSubtab("suggest");
      }
    },
    onDetailInput(e) {
      if (e.target.id === "dbCalcLevel" || e.target.id === "dbCalcRate") renderKillResult();
    },
  });

  // ------------------------------------------------------------- 任務

  function linkChip(set, id, name, extra) {
    const tail = extra ? `<span class="db-sub-num">${esc(extra)}</span>` : "";
    return `<button class="db-chip" type="button" data-db-goto="${set}" data-db-id="${esc(id)}">
      ${esc(name)}${tail}</button>`;
  }

  function plainChip(name, extra) {
    const tail = extra ? `<span class="db-sub-num">${esc(extra)}</span>` : "";
    return `<span class="db-chip db-chip--plain">${esc(name)}${tail}</span>`;
  }

  const quests = makeSet({
    key: "quests",
    route: "quest",
    dir: "quests",
    prefix: "dbQuest",
    label: "任務",
    unit: "個",
    filters: [
      { id: "Search", test: (r, v) => !v || r.name.toLowerCase().includes(v.trim().toLowerCase()) },
      { id: "Cat", test: (r, v) => !v || r.cat === v },
      { id: "LvMin", test: (r, v) => !v || (r.lv || 0) >= parseInt(v, 10) },
      { id: "LvMax", test: (r, v) => !v || (r.lv || 0) <= parseInt(v, 10) },
    ],
    sorts: [
      { key: "level", cmp: (a, b) => (a.lv || 0) - (b.lv || 0) || a.name.localeCompare(b.name, "zh-TW") },
      { key: "exp", cmp: (a, b) => (b.exp || 0) - (a.exp || 0) },
      { key: "name", cmp: (a, b) => a.name.localeCompare(b.name, "zh-TW") },
    ],
    fillFilters(index, els) {
      [...new Set(index.map((q) => q.cat))].filter(Boolean).sort().forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        els.Cat.appendChild(o);
      });
    },
    renderRow(q) {
      return `<button class="db-row db-row--text" type="button" data-db-id="${esc(q.id)}">
        <div class="db-row-main">
          <div class="db-row-title">
            <span class="db-row-name">${esc(q.name)}</span>
            ${q.lv ? `<span class="db-row-level">Lv.${q.lv}</span>` : ""}
            <span class="db-tag">${esc(q.cat)}</span>
          </div>
          <div class="db-row-meta">${esc([q.parent, q.npc && "NPC：" + q.npc].filter(Boolean).join(" · "))}</div>
        </div>
        <dl class="db-row-stats">
          <div><dt>EXP</dt><dd>${q.exp ? shortNum(q.exp) : "—"}</dd></div>
        </dl>
      </button>`;
    },
    renderDetail(d) {
      const npcLine = (n, label) =>
        n && n.name
          ? `<div class="db-sub-item">
              <span class="db-sub-name">${label}</span>
              <span class="db-sub-meta">${esc(n.name)}${n.maps.length ? "（" + esc(n.maps.map((m) => m.label).join("、")) + "）" : ""}</span>
            </div>`
          : "";

      const startBits = [];
      if (d.start.level) startBits.push(plainChip(`Lv.${d.start.level} 以上`));
      (d.start.items || []).forEach((i) =>
        startBits.push(plainChip(i.name, i.count ? `×${i.count}` : ""))
      );
      (d.start.quests || []).forEach((q) =>
        startBits.push(
          q.link ? linkChip("quest", q.id, q.name, q.state) : plainChip(q.name, q.state)
        )
      );

      const compBits = [];
      (d.complete.items || []).forEach((i) =>
        compBits.push(plainChip(i.name, i.count ? `×${i.count}` : ""))
      );
      (d.complete.monsters || []).forEach((m) =>
        compBits.push(
          m.link
            ? linkChip("monster", m.id, m.name, m.count ? `×${m.count}` : "")
            : plainChip(m.name, m.count ? `×${m.count}` : "")
        )
      );

      const rw = d.rewards;
      const rwBits = [];
      if (rw.exp) rwBits.push(plainChip("經驗值", num(rw.exp)));
      if (rw.money) rwBits.push(plainChip("楓幣", num(rw.money)));
      if (rw.pop) rwBits.push(plainChip("人氣", num(rw.pop)));
      (rw.items || []).forEach((i) => rwBits.push(plainChip(i.name, i.count ? `×${i.count}` : "")));
      (rw.skills || []).forEach((s) =>
        rwBits.push(s.link ? linkChip("skill", s.id, s.name || "技能") : plainChip(s.name || "技能"))
      );

      const section = (title, bits) =>
        bits.length
          ? `<section class="db-section">
              <h3 class="db-section-title">${title}</h3>
              <div class="db-chip-row">${bits.join("")}</div>
            </section>`
          : "";

      // nextQuest 通常也會出現在 dependentQuests 裡，同一筆列兩次很奇怪
      const nextBits = [];
      const seenNext = new Set();
      [d.next, ...(d.deps || [])].filter(Boolean).forEach((q) => {
        if (seenNext.has(q.id)) return;
        seenNext.add(q.id);
        nextBits.push(q.link ? linkChip("quest", q.id, q.name) : plainChip(q.name));
      });

      return `<button class="db-back" type="button" data-db-back>← 回到任務列表</button>
        <div class="db-detail-head">
          <div>
            <div class="db-row-title">
              <h2 class="db-detail-name">${esc(d.name)}</h2>
              ${d.minLevel ? `<span class="db-row-level">Lv.${d.minLevel}</span>` : ""}
              <span class="db-tag">${esc(d.category)}</span>
            </div>
            ${d.parent ? `<p class="db-detail-desc">系列：${esc(d.parent)}</p>` : ""}
          </div>
        </div>
        <section class="db-section">
          <h3 class="db-section-title">接取與繳交</h3>
          <div class="db-sub-list">
            ${npcLine(d.startNpc, "接取")}
            ${npcLine(d.endNpc, "繳交")}
          </div>
        </section>
        ${section("接取條件", startBits)}
        ${section("完成條件", compBits)}
        ${section("獎勵", rwBits)}
        ${section("後續任務", nextBits)}
        ${d.texts.length
          ? `<section class="db-section">
              <h3 class="db-section-title">任務說明</h3>
              <div class="db-sub-list">${d.texts
                .map(
                  (t) => `<div class="db-text-block">
                    <div class="db-text-label">${esc(t.label)}</div>
                    <p class="db-text-body">${esc(t.text)}</p>
                  </div>`
                )
                .join("")}</div>
            </section>`
          : ""}`;
    },
  });

  // ------------------------------------------------------------- 技能

  function skillImg(id, size) {
    return `<img class="db-row-icon db-row-icon--skill" src="assets/db/skills/${encodeURIComponent(id)}.png"
      alt="" loading="lazy" decoding="async" width="${size}" height="${size}">`;
  }

  const skills = makeSet({
    key: "skills",
    route: "skill",
    dir: "skills",
    prefix: "dbSkill",
    label: "技能",
    unit: "個",
    filters: [
      { id: "Search", test: (r, v) => !v || r.name.toLowerCase().includes(v.trim().toLowerCase()) },
      { id: "Group", test: (r, v) => !v || r.group === v },
      { id: "Adv", test: (r, v) => !v || r.adv === v },
    ],
    sorts: [
      { key: "job", cmp: (a, b) => a.group.localeCompare(b.group, "zh-TW") || a.job.localeCompare(b.job, "zh-TW") || a.name.localeCompare(b.name, "zh-TW") },
      { key: "name", cmp: (a, b) => a.name.localeCompare(b.name, "zh-TW") },
    ],
    fillFilters(index, els) {
      const groups = [...new Set(index.map((s) => s.group))].filter(Boolean);
      const advs = [...new Set(index.map((s) => s.adv))].filter(Boolean);
      // 轉職階段照遊戲順序排，不要照字母
      const ORDER = ["零轉", "一轉", "二轉", "三轉", "四轉"];
      groups.forEach((g) => {
        const o = document.createElement("option");
        o.value = g;
        o.textContent = g;
        els.Group.appendChild(o);
      });
      advs
        .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))
        .forEach((a) => {
          const o = document.createElement("option");
          o.value = a;
          o.textContent = a;
          els.Adv.appendChild(o);
        });
    },
    renderRow(s) {
      return `<button class="db-row" type="button" data-db-id="${esc(s.id)}">
        ${skillImg(s.id, 44)}
        <div class="db-row-main">
          <div class="db-row-title">
            <span class="db-row-name">${esc(s.name)}</span>
            <span class="db-tag">${esc(s.adv)}</span>
          </div>
          <div class="db-row-meta">${esc(s.group)} · ${esc(s.job)}</div>
        </div>
        <dl class="db-row-stats">
          <div><dt>上限</dt><dd>Lv.${s.maxLevel}</dd></div>
        </dl>
      </button>`;
    },
    renderDetail(d) {
      const labels = d.labels || {};
      const keys = [...new Set(d.levels.flatMap((l) => Object.keys(l.values || {})))];
      // 每級數值攤成表格：欄位就是這個技能實際用到的那幾個值（消耗 MP、
      // 持續時間、傷害…），欄名用遊戲自己的標籤，不自己翻譯
      const head = keys.map((k) => `<th>${esc(labels[k] || k)}</th>`).join("");
      const rows = d.levels
        .map(
          (l) => `<tr>
            <th scope="row">${l.level}</th>
            ${keys.map((k) => `<td>${l.values && l.values[k] != null ? num(l.values[k]) : "—"}</td>`).join("")}
          </tr>`
        )
        .join("");
      const table = keys.length
        ? `<div class="db-table-scroll"><table class="db-level-table">
             <thead><tr><th scope="col">Lv</th>${head}</tr></thead>
             <tbody>${rows}</tbody>
           </table></div>`
        : `<div class="db-sub-list">${d.levels
            .map(
              (l) => `<div class="db-sub-item">
                <span class="db-sub-name">Lv.${l.level}</span>
                <span class="db-sub-meta">${esc(l.desc)}</span>
              </div>`
            )
            .join("")}</div>`;

      return `<button class="db-back" type="button" data-db-back>← 回到技能列表</button>
        <div class="db-detail-head">
          ${skillImg(d.id, 64)}
          <div>
            <div class="db-row-title">
              <h2 class="db-detail-name">${esc(d.name)}</h2>
              <span class="db-tag">${esc(d.adv)}</span>
              <span class="db-row-level">上限 Lv.${d.maxLevel}</span>
            </div>
            <p class="db-detail-desc">${esc(d.group)} · ${esc(d.job)}</p>
            ${d.desc ? `<p class="db-detail-desc">${esc(d.desc)}</p>` : ""}
          </div>
        </div>
        ${d.formula ? `<section class="db-section">
          <h3 class="db-section-title">效果</h3>
          <p class="db-detail-desc">${esc(d.formula)}</p>
        </section>` : ""}
        <section class="db-section">
          <h3 class="db-section-title">每級數值<span class="db-sub-num">${d.levels.length} 級</span></h3>
          ${table}
        </section>`;
    },
  });

  // ------------------------------------------------------------- 組裝

  const SETS = [monsters, quests, skills].filter(Boolean);

  SETS.forEach((s) => {
    const btn = document.getElementById("dbSub" + s.key.charAt(0).toUpperCase() + s.key.slice(1));
    const view = document.getElementById("db" + s.key.charAt(0).toUpperCase() + s.key.slice(1) + "View");
    if (btn && view) {
      tabs.push({ key: s.key, btn, view });
      btn.addEventListener("click", () => {
        showTab(s.key);
        s.load();
        // 從詳情狀態切子分頁時，網址要跟著還原
        if (currentRoute()) history.replaceState({}, "", routeUrl(null));
        SETS.forEach((x) => x.showList());
      });
    }
  });

  window.addEventListener("popstate", () => {
    const route = currentRoute();
    if (route) {
      const s = SETS.find((x) => x.route === route.set);
      if (s) {
        showTab(s.key, true);
        s.showDetail(route.id);
        return;
      }
    }
    SETS.forEach((s) => s.showList());
  });

  // 切到別的主分頁時把詳情關掉、網址也還原。不這麼做的話，人在「社群資料」
  // 而網址還寫著 ?db=monster&id=…，一重整又被帶回怪物詳情——跟先前錨點
  // 殘留在網址列是同一種毛病
  document.addEventListener("maplenav:pagechange", (e) => {
    if (e.detail && e.detail.page !== "db" && currentRoute()) {
      history.replaceState({}, "", routeUrl(null));
      SETS.forEach((s) => s.showList());
    }
  });

  // 決定初始子分頁：網址指定的優先，其次記住的，最後預設第一個
  function load() {
    const route = currentRoute();
    const routed = route && SETS.find((s) => s.route === route.set);
    const saved = localStorage.getItem(TAB_KEY);
    const initial = routed
      ? routed.key
      : SETS.some((s) => s.key === saved)
      ? saved
      : SETS[0] && SETS[0].key;
    if (initial) showTab(initial, true);
    const target = SETS.find((s) => s.key === initial);
    if (target) target.load();
  }

  window.MapleDb = { load, showTab };
})();
