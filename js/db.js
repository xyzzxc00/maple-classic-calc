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

  // ------------------------------------------------------------ 放大檢視
  // 點底圖把整個圖組（底圖＋標記）複製一份放進全螢幕燈箱。放大不只是看
  // 清楚，也是讓小螢幕上十幾像素的傳送點變得點得到——標記在燈箱裡照樣
  // 可以點，點了收燈箱直接跳過去。比視窗大的部分用拖捲。
  // 世界地圖在燈箱裡切區域要重新放內容，由 world 模組掛 handler 進來
  let lightbox = null;
  let lightboxBody = null;
  let onLightboxRegion = null;

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxBody.innerHTML = "";
    document.body.style.overflow = "";
  }

  function ensureLightbox() {
    if (lightbox) return;
    lightbox = document.createElement("div");
    lightbox.className = "db-lightbox";
    lightbox.hidden = true;
    lightbox.innerHTML =
      '<div class="db-lightbox-pan"><div class="db-lightbox-body"></div></div>' +
      '<button class="db-lightbox-close" type="button" aria-label="關閉放大檢視">✕</button>';
    lightboxBody = lightbox.querySelector(".db-lightbox-body");
    lightbox.addEventListener("click", (e) => {
      const goto = e.target.closest("[data-db-goto]");
      const reg = e.target.closest("[data-world-region]");
      if (goto) {
        closeLightbox();
        openDetail(goto.dataset.dbGoto, goto.dataset.dbId, true);
        return;
      }
      if (reg) {
        if (onLightboxRegion) onLightboxRegion(reg.dataset.worldRegion);
        return;
      }
      // NPC 那類純顯示的標記：點了不做事也不收，避免想看 tooltip 卻把
      // 燈箱關掉
      if (e.target.closest(".db-marker")) return;
      closeLightbox(); // 底圖、背景、右上的 ✕
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLightbox();
    });
    document.body.appendChild(lightbox);
  }

  function openFigureLightbox(figEl, width) {
    if (!figEl) return;
    ensureLightbox();
    const clone = figEl.cloneNode(true);
    clone.style.width = width + "px";
    clone.style.minWidth = "0";
    clone.style.maxWidth = "none";
    // 原圖掛著 lazy 的話，燈箱裡要立刻載
    clone.querySelectorAll("img[loading]").forEach((i) => i.removeAttribute("loading"));
    lightboxBody.innerHTML = "";
    lightboxBody.appendChild(clone);
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    const pan = lightbox.querySelector(".db-lightbox-pan");
    pan.scrollLeft = 0;
    pan.scrollTop = 0;
  }

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
        .catch((err) => {
          // 顯示給使用者的是友善訊息，但原因要留在 console，不然渲染函式
          // 拋錯會跟網路錯誤混在一起，除錯時完全瞎猜
          console.error(`[db] ${cfg.label} 詳情渲染失敗`, err);
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
          // fillFilters 裡的連動選單（分類→類型、地區→區域）在重設下層選單
          // 之後要能重畫，不然畫面會顯示「全部類型」但列表還套著舊的篩選
          if (cfg.fillFilters) cfg.fillFilters(index, filterEls, render);
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

    // 文字搜尋每按一鍵就重建整份列表，道具有 1300 多筆、每列還有一張圖，
    // 手機上會頓；下拉選單則要立即反應，不用延遲
    let typingTimer = null;
    const renderSoon = () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(render, 150);
    };
    Object.keys(filterEls).forEach((k) => {
      const el = filterEls[k];
      if (!el) return;
      if (el.tagName === "SELECT") el.addEventListener("change", render);
      else el.addEventListener("input", renderSoon);
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

    // 圖片載不到就整個藏起來，不要留一個破圖圖示。理論上每一筆都有圖
    // （匯入時就過濾掉沒圖的），這是防呆——資料補得比圖片快的時候不該
    // 整頁看起來像壞掉。error 事件不會冒泡，要用捕獲階段
    [els.list, els.detail].forEach((box) =>
      box.addEventListener(
        "error",
        (e) => {
          if (e.target.tagName === "IMG") e.target.style.visibility = "hidden";
        },
        true
      )
    );

    return {
      load,
      showList,
      showDetail,
      route: cfg.route,
      key: cfg.key,
      label: cfg.label,
      unit: cfg.unit,
      // 全站搜尋要拿索引來找，但不該逼使用者先切到那個子分頁才載得到
      search(q) {
        return (index || []).filter((r) => r.name.toLowerCase().includes(q));
      },
      ensure: load,
      searchRow: cfg.searchRow,
    };
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
    // 跨資料集跳轉（任務→怪物、怪物→道具…）時，目標資料集的索引可能還沒
    // 載過。不補這一下的話，讀者按「回到列表」會看到永遠停在「載入中」的
    // 空列表——詳情本身是各自抓單筆 JSON，所以不會露餡
    if (window.MapleNav) window.MapleNav.switchNav("db");
    showTab(s.key, true);
    s.load();
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
    // 先四捨五入成整數分鐘再拆時分，不然 59.7 分會變成「0 小時 60 分」
    const totalMin = Math.round(minutes);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
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

  // ------------------------------------------------------ 怪物：命中率試算
  // 公式是舊版（Big Bang 前）的社群考據，三個獨立實作（本站參考的資料庫
  // 網站、其上游 a2983456456 的命中計算器、steve07s 的命中計算器）
  // 互相對過，魔法公式另有 2007 年 PTT 引用日本 zaizen 研究站的原始考據：
  //   物理：100% 所需命中 = (55.2 + 2.15×等級差) × 迴避 ÷ 15
  //         命中率 = (面板命中 − 所需÷2) ÷ (所需÷2)，線性
  //   魔法：魔法命中 = ⌊INT÷10⌋ + ⌊LUK÷10⌋
  //         100% 所需 = ⌊(迴避+1) × (1 + 0.04×等級差)⌋，1% 門檻 = 41%×所需
  //         中間用二次曲線內插（SouthPerry 迴歸係數）
  //   等級差 = max(0, 怪物等級 − 角色等級)，比怪高不加成
  // 另有實作把物理係數簡化成 (55 + 2×等級差)，差距在 2% 內——說明欄有註

  const HIT_PREFS_KEY = "maple_classic_db_hit";

  function hitPrefs() {
    try {
      return JSON.parse(localStorage.getItem(HIT_PREFS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function renderHitCalc(d) {
    const eva = (d.stats || {}).eva;
    const mobLv = d.level != null ? d.level : (d.stats || {}).level;
    if (eva == null || mobLv == null) return "";
    const p = hitPrefs();
    const fallback = parseInt(calcPrefs().currentLevel, 10);
    const level = p.level >= 1 ? p.level : fallback >= 1 && fallback <= 199 ? fallback : 30;
    const magic = p.type === "magic";
    return `<section class="db-section" id="dbHitCalc" data-eva="${eva}" data-moblv="${mobLv}">
      <h3 class="db-section-title">命中率試算</h3>
      <div class="db-map-toggles">
        <button class="cm-sort-btn${magic ? "" : " active"}" type="button" data-hit-type="phys">物理攻擊</button>
        <button class="cm-sort-btn${magic ? " active" : ""}" type="button" data-hit-type="magic">魔法攻擊</button>
      </div>
      <div class="cm-filter-row">
        <label class="db-calc-field">你的等級
          <input class="cm-filter-input cm-filter-lv" id="dbHitLevel" type="number"
                 min="1" max="199" value="${level}" inputmode="numeric">
        </label>
        <label class="db-calc-field"${magic ? " hidden" : ""} id="dbHitAccField">面板命中
          <input class="cm-filter-input cm-filter-lv" id="dbHitAcc" type="number"
                 min="0" max="999" value="${p.acc >= 0 ? p.acc : 100}" inputmode="numeric">
        </label>
        <label class="db-calc-field"${magic ? "" : " hidden"} id="dbHitIntField">智力
          <input class="cm-filter-input cm-filter-lv" id="dbHitInt" type="number"
                 min="0" max="999" value="${p.int >= 0 ? p.int : 100}" inputmode="numeric">
        </label>
        <label class="db-calc-field"${magic ? "" : " hidden"} id="dbHitLukField">幸運
          <input class="cm-filter-input cm-filter-lv" id="dbHitLuk" type="number"
                 min="0" max="999" value="${p.luk >= 0 ? p.luk : 4}" inputmode="numeric">
        </label>
      </div>
      <div id="dbHitResult"></div>
    </section>`;
  }

  // 純計算：怪物頁的試算區跟計算工具的獨立分頁共用同一份公式
  function computeHit({ eva, mobLv, level, magic, acc, intv, luk }) {
    const diff = Math.max(0, mobLv - level);
    let ratio;
    let acc100;
    let current;
    if (magic) {
      current = Math.floor((intv || 0) / 10) + Math.floor((luk || 0) / 10);
      acc100 = Math.floor((eva + 1) * (1 + 0.04 * diff));
      const acc1 = Math.round(0.41 * acc100);
      const den = acc100 - acc1 + 1;
      const part = Math.min(1, Math.max(0, den <= 0 ? 1 : (current - acc1 + 1) / den));
      ratio = (-0.7011618132 * part * part + 1.702139835 * part) * 100;
    } else {
      current = acc || 0;
      acc100 = ((55.2 + 2.15 * diff) * eva) / 15;
      ratio = (100 * (current - acc100 * 0.5)) / (acc100 * 0.5);
    }
    return { ratio: Math.max(0, Math.min(100, ratio)), acc100, current, diff };
  }

  function hitResultHtml(r, magic) {
    const gap = Math.max(0, Math.ceil(r.acc100 - r.current));
    const unit = magic ? "魔法命中（⌊智÷10⌋+⌊幸÷10⌋）" : "面板命中";
    return `<dl class="db-stat-grid">
        <div><dt>命中率</dt><dd>${r.ratio.toFixed(1)}%</dd></div>
        <div><dt>你的${magic ? "魔法命中" : "命中"}</dt><dd>${num(r.current)}</dd></div>
        <div><dt>100% 所需</dt><dd>${num(Math.ceil(r.acc100))}</dd></div>
        <div><dt>還差</dt><dd>${gap ? num(gap) : "已達標"}</dd></div>
        <div><dt>等級差</dt><dd>${r.diff}</dd></div>
      </dl>
      <p class="db-section-note">舊版社群考據公式（${unit}），跟多個玩家計算器交叉核對過；等級比怪物高不會再加成。不同玩家工具的物理係數略有出入，結果差距約 2% 內，實際仍以遊戲內為準。</p>`;
  }

  function renderHitResult() {
    const box = document.getElementById("dbHitCalc");
    const out = document.getElementById("dbHitResult");
    if (!box || !out) return;
    const eva = parseInt(box.dataset.eva, 10);
    const mobLv = parseInt(box.dataset.moblv, 10);
    const magic = box.querySelector('[data-hit-type="magic"]').classList.contains("active");
    const level = parseInt(document.getElementById("dbHitLevel").value, 10);
    if (!(level >= 1)) {
      out.innerHTML = '<p class="db-section-note">填入你的等級與能力值就會算出來。</p>';
      return;
    }
    const acc = parseInt(document.getElementById("dbHitAcc").value, 10) || 0;
    const intv = parseInt(document.getElementById("dbHitInt").value, 10) || 0;
    const luk = parseInt(document.getElementById("dbHitLuk").value, 10) || 0;
    localStorage.setItem(HIT_PREFS_KEY, JSON.stringify(
      magic ? { type: "magic", level, int: intv, luk } : { type: "phys", level, acc }
    ));
    out.innerHTML = hitResultHtml(computeHit({ eva, mobLv, level, magic, acc, intv, luk }), magic);
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
    searchRow: (r) => `Lv.${r.level} · ${(r.regions || []).join("、")}`,
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
      // 整列可以點進那張地圖——看完「這隻怪在哪出沒」，下一步一定是想看那張
      // 圖長怎樣。link 是 false 的圖沒有頁面，維持不可點，不要給死連結
      const maps = d.maps.length
        ? `<div class="db-sub-list">${d.maps
            .map((m) => {
              const inner = `<span class="db-sub-name">${esc(m.name)}</span>
                <span class="db-sub-meta">${esc([m.region, m.street].filter(Boolean).join(" · "))}</span>
                <span class="db-sub-num">${m.spawns} 個重生點</span>`;
              return m.link
                ? `<button class="db-sub-item db-sub-item--link" type="button"
                     data-db-goto="map" data-db-id="${esc(m.id)}">${inner}</button>`
                : `<div class="db-sub-item">${inner}</div>`;
            })
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
                  // 未命名道具不在道具資料集裡（沒名字沒圖），照列但不能點，
                  // 不然會開到不存在的頁面
                  const tag = x.link ? "button" : "div";
                  const attrs = x.link
                    ? ` type="button" data-db-goto="item" data-db-id="${esc(x.id)}"`
                    : "";
                  return `<${tag} class="db-drop-item${x.link ? "" : " db-drop-item--plain"}"${attrs}>
                    <img class="db-drop-icon" src="assets/db/items/${encodeURIComponent(x.id)}.png"
                         alt="" loading="lazy" decoding="async" width="32" height="32">
                    <span class="db-drop-text">
                      <span class="db-drop-name">${esc(x.name)}</span>
                      <span class="db-drop-meta">${esc([x.sub, ...bits].filter(Boolean).join(" · "))}</span>
                    </span>
                  </${tag}>`;
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
        ${renderHitCalc(d)}
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
          <p class="db-section-note">遊戲資料檔沒有記錄掉落機率，這裡只列出「會掉什麼」。${
            d.hiddenDrops
              ? `另有 ${d.hiddenDrops} 項在遊戲資料裡沒有名稱與圖示，未列出。`
              : ""
          }</p>
          ${drops}
        </section>
        ${quests}`;
    },
    afterDetail() {
      renderKillResult();
      renderHitResult();
    },
    onDetailClick(e) {
      const hitType = e.target.closest("[data-hit-type]");
      if (hitType) {
        // 切換物理／魔法：換高亮、換要顯示的輸入欄，再重算
        const box = document.getElementById("dbHitCalc");
        box.querySelectorAll("[data-hit-type]").forEach((b) =>
          b.classList.toggle("active", b === hitType)
        );
        const magic = hitType.dataset.hitType === "magic";
        document.getElementById("dbHitAccField").hidden = magic;
        document.getElementById("dbHitIntField").hidden = !magic;
        document.getElementById("dbHitLukField").hidden = !magic;
        renderHitResult();
        return;
      }
      if (e.target.closest("#dbToCalc")) sendToCalculator();
      else if (e.target.closest("#dbToSpots") && window.MapleNav && window.MapleCommunity) {
        window.MapleNav.switchNav("cm");
        window.MapleCommunity.showCmSubtab("suggest");
      }
    },
    onDetailInput(e) {
      if (e.target.id === "dbCalcLevel" || e.target.id === "dbCalcRate") renderKillResult();
      else if (e.target.id === "dbHitLevel" || e.target.id === "dbHitAcc"
               || e.target.id === "dbHitInt" || e.target.id === "dbHitLuk") renderHitResult();
    },
  });

  // ------------------------------------------------------------- 地圖

  const maps = makeSet({
    key: "maps",
    route: "map",
    dir: "maps",
    prefix: "dbMap",
    label: "地圖",
    unit: "張",
    filters: [
      { id: "Search", test: (r, v) => !v || r.name.toLowerCase().includes(v.trim().toLowerCase()) },
      { id: "Region", test: (r, v) => !v || r.region === v },
      { id: "Street", test: (r, v) => !v || r.street === v },
    ],
    sorts: [
      { key: "region", cmp: (a, b) => a.region.localeCompare(b.region, "zh-TW") || a.street.localeCompare(b.street, "zh-TW") || a.name.localeCompare(b.name, "zh-TW") },
      { key: "spawns", cmp: (a, b) => (b.spawns || 0) - (a.spawns || 0) },
      { key: "name", cmp: (a, b) => a.name.localeCompare(b.name, "zh-TW") },
    ],
    searchRow: (r) => [r.region, r.street].filter(Boolean).join(" · "),
    fillFilters(index, els, render) {
      [...new Set(index.map((m) => m.region))].filter(Boolean).sort().forEach((r) => {
        const o = document.createElement("option");
        o.value = r;
        o.textContent = r;
        els.Region.appendChild(o);
      });
      // 區域選單跟著地區連動：維多利亞島底下就有二十幾個城鎮，全部混在一起選不動
      const byStreet = new Map();
      index.forEach((m) => {
        if (!byStreet.has(m.region)) byStreet.set(m.region, new Set());
        byStreet.get(m.region).add(m.street);
      });
      const fill = (rerender) => {
        const region = els.Region.value;
        const streets = region
          ? [...(byStreet.get(region) || [])]
          : [...new Set(index.map((m) => m.street))];
        els.Street.innerHTML = '<option value="">全部區域</option>';
        streets.filter(Boolean).sort().forEach((s) => {
          const o = document.createElement("option");
          o.value = s;
          o.textContent = s;
          els.Street.appendChild(o);
        });
        // 下層選單被重設成「全部區域」了，列表要跟著重畫，不然畫面顯示的
        // 篩選條件跟實際套用的對不起來
        if (rerender) render();
      };
      fill(false);
      els.Region.addEventListener("change", () => fill(true));
    },
    renderRow(m) {
      return `<button class="db-row db-row--text" type="button" data-db-id="${esc(m.id)}">
        <div class="db-row-main">
          <div class="db-row-title">
            <span class="db-row-name">${esc(m.name)}</span>
          </div>
          <div class="db-row-meta">${esc([m.region, m.street].filter(Boolean).join(" · "))}</div>
        </div>
        <dl class="db-row-stats">
          <div><dt>怪物</dt><dd>${m.mobs}</dd></div>
          <div><dt>重生點</dt><dd>${m.spawns}</dd></div>
          <div><dt>傳送</dt><dd>${m.portals}</dd></div>
        </dl>
      </button>`;
    },
    renderDetail(d) {
      // 小地圖上的標記：位置在匯入時就換算成百分比，這裡直接套，畫面縮放
      // 也不會跑掉。原圖只有一百多像素寬，放大時保留鋸齒比糊掉好看。
      // 怪物標記直接用該怪的圖示——一顆紅點只能告訴你「這裡有怪」，圖示
      // 能一眼看出是哪一種，密度分布也更好認
      const markers = d.hasMini
        ? [
            ...d.spawns.map(
              (s) => `<button class="db-marker db-marker--mob" type="button"
                        data-db-goto="monster" data-db-id="${esc(s.id)}"
                        style="left:${s.x}%;top:${s.y}%"
                        title="${esc((d.mobs.find((m) => m.id === s.id) || {}).name || "")}">
                        <img src="assets/db/monsters/${encodeURIComponent(s.id)}.png" alt=""
                             loading="lazy" decoding="async"></button>`
            ),
            ...d.npcs
              .filter((n) => n.x != null)
              .map(
                (n) => `<span class="db-marker db-marker--npc" style="left:${n.x}%;top:${n.y}%"
                          title="${esc(n.name)}"></span>`
              ),
            // 跨地圖傳送點整顆是按鈕，點了直接跳到那張圖——在圖上看到出口就
            // 能一路走下去。同圖傳送沒有目標可跳，維持不可點
            ...d.portals
              .filter((p) => p.x != null)
              .map((p) => {
                const pos = `style="left:${p.x}%;top:${p.y}%"`;
                return p.link
                  ? `<button class="db-marker db-marker--portal db-marker--portal-link" type="button"
                       data-db-goto="map" data-db-id="${esc(p.id)}" ${pos}
                       title="前往 ${esc(p.name)}"></button>`
                  : `<span class="db-marker db-marker--${p.same ? "portal-same" : "portal"}"
                       ${pos} title="${esc(p.same ? "同圖傳送" : p.name)}"></span>`;
              }),
          ].join("")
        : "";

      const hasSame = d.portals.some((p) => p.same && p.x != null);
      const figure = d.hasMini
        ? `<div class="db-map-figure" id="dbMapFigure">
             <img class="db-map-img" src="assets/db/maps/${encodeURIComponent(d.id)}.png"
                  alt="${esc(d.name)} 小地圖" loading="lazy" decoding="async">
             ${markers}
           </div>
           <div class="db-map-legend">
             <span><i class="db-marker db-marker--npc"></i>NPC</span>
             <span><i class="db-marker db-marker--portal"></i>跨地圖傳送</span>
             ${hasSame ? '<span><i class="db-marker db-marker--portal-same"></i>同圖傳送</span>' : ""}
           </div>
           <div class="db-map-toggles">
             ${d.spawns.length ? '<button class="cm-sort-btn active" type="button" data-map-toggle="mob">怪物</button>' : ""}
             ${d.npcs.some((n) => n.x != null) ? '<button class="cm-sort-btn active" type="button" data-map-toggle="npc">NPC</button>' : ""}
             ${d.portals.some((p) => !p.same && p.x != null) ? '<button class="cm-sort-btn active" type="button" data-map-toggle="portal">跨地圖傳送</button>' : ""}
             ${hasSame ? '<button class="cm-sort-btn active" type="button" data-map-toggle="portal-same">同圖傳送</button>' : ""}
           </div>
           <p class="db-section-note">點小地圖上的怪物圖示可以看那隻怪的資料，點紫色的傳送點可以直接前往那張地圖，點地圖空白處可以放大檢視；上面的按鈕可以切換要顯示哪一類標記。</p>`
        : '<p class="cm-empty">這張地圖沒有小地圖資料</p>';

      const mobs = d.mobs.length
        ? `<div class="db-chip-row">${d.mobs
            .map((m) => {
              const name = `${m.name} Lv.${m.level}`;
              return m.link
                ? linkChip("monster", m.id, name, `${m.count} 點`)
                : plainChip(name, `${m.count} 點`);
            })
            .join("")}</div>`
        : '<p class="cm-empty">這張地圖沒有怪物</p>';

      const crossPortals = d.portals.filter((p) => !p.same);
      const portals = crossPortals.length
        ? `<div class="db-chip-row">${crossPortals
            .map((p) => (p.link ? linkChip("map", p.id, p.name) : plainChip(p.name, p.region)))
            .join("")}</div>`
        : "";

      const npcs = d.npcs.filter((n) => n.name).length
        ? `<div class="db-chip-row">${[...new Set(d.npcs.map((n) => n.name))]
            .filter(Boolean)
            .map((n) => plainChip(n))
            .join("")}</div>`
        : "";

      return `<button class="db-back" type="button" data-db-back>← 回到地圖列表</button>
        <div class="db-detail-head">
          <div>
            <div class="db-row-title">
              <h2 class="db-detail-name">${esc(d.name)}</h2>
            </div>
            <p class="db-detail-desc">${esc([d.region, d.street].filter(Boolean).join(" · "))}</p>
          </div>
        </div>
        <section class="db-section">
          <h3 class="db-section-title">小地圖</h3>
          ${figure}
        </section>
        <section class="db-section">
          <h3 class="db-section-title">出沒怪物<span class="db-sub-num">${d.mobs.length} 種</span></h3>
          ${mobs}
        </section>
        <!-- 標記切換：純顯示控制，交給下面的 onDetailClick 處理 -->
        ${portals ? `<section class="db-section">
          <h3 class="db-section-title">通往<span class="db-sub-num">${crossPortals.length}</span></h3>
          ${portals}
        </section>` : ""}
        ${npcs ? `<section class="db-section">
          <h3 class="db-section-title">NPC</h3>
          ${npcs}
        </section>` : ""}`;
    },
    onDetailClick(e) {
      if (e.target.classList && e.target.classList.contains("db-map-img")) {
        // 像素圖放 4 倍以內，夠攤開標記又不會全是格子
        const w = Math.min((e.target.naturalWidth || 320) * 4, 1600);
        openFigureLightbox(document.getElementById("dbMapFigure"), w);
        return;
      }
      const toggle = e.target.closest("[data-map-toggle]");
      if (!toggle) return;
      const kind = toggle.dataset.mapToggle;
      const on = toggle.classList.toggle("active");
      document
        .querySelectorAll(`#dbMapFigure .db-marker--${kind}`)
        .forEach((el) => (el.hidden = !on));
    },
  });

  // ------------------------------------------------------------- 道具

  const EQUIP_REQ = [
    ["reqLevel", "等級"], ["reqSTR", "力量"], ["reqDEX", "敏捷"],
    ["reqINT", "智力"], ["reqLUK", "幸運"], ["reqPOP", "人氣"],
  ];
  const EQUIP_INC = [
    ["incPAD", "物理攻擊"], ["incMAD", "魔法攻擊"],
    ["incPDD", "物理防禦"], ["incMDD", "魔法防禦"],
    ["incSTR", "力量"], ["incDEX", "敏捷"], ["incINT", "智力"], ["incLUK", "幸運"],
    ["incMHP", "HP"], ["incMMP", "MP"],
    ["incACC", "命中"], ["incEVA", "迴避"], ["incSpeed", "移動速度"],
    ["tuc", "可升級次數"],
  ];
  // reqJob 是位元旗標，0 代表所有職業都能用
  const JOB_BITS = [[1, "劍士"], [2, "法師"], [4, "弓箭手"], [8, "盜賊"], [16, "海盜"]];

  function jobText(bits) {
    if (!bits) return "全職業";
    const names = JOB_BITS.filter(([b]) => bits & b).map(([, n]) => n);
    return names.length ? names.join("、") : "全職業";
  }

  function itemImg(id, size) {
    return `<img class="db-row-icon db-row-icon--skill" src="assets/db/items/${encodeURIComponent(id)}.png"
      alt="" loading="lazy" decoding="async" width="${size}" height="${size}">`;
  }

  const items = makeSet({
    key: "items",
    route: "item",
    dir: "items",
    prefix: "dbItem",
    label: "道具",
    unit: "個",
    filters: [
      { id: "Search", test: (r, v) => !v || r.name.toLowerCase().includes(v.trim().toLowerCase()) },
      { id: "Cat", test: (r, v) => !v || r.cat === v },
      { id: "Sub", test: (r, v) => !v || r.sub === v },
      { id: "LvMin", test: (r, v) => !v || (r.lv || 0) >= parseInt(v, 10) },
      { id: "LvMax", test: (r, v) => !v || (r.lv || 0) <= parseInt(v, 10) },
    ],
    sorts: [
      { key: "cat", cmp: (a, b) => a.cat.localeCompare(b.cat, "zh-TW") || a.sub.localeCompare(b.sub, "zh-TW") || a.name.localeCompare(b.name, "zh-TW") },
      { key: "level", cmp: (a, b) => (b.lv || 0) - (a.lv || 0) },
      { key: "sell", cmp: (a, b) => (b.sell || 0) - (a.sell || 0) },
    ],
    searchRow: (r) =>
      [r.cat, r.sub, r.lv ? `需求 Lv.${r.lv}` : ""].filter(Boolean).join(" · "),
    fillFilters(index, els, render) {
      [...new Set(index.map((i) => i.cat))].filter(Boolean).sort().forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        els.Cat.appendChild(o);
      });
      // 類型選單跟著分類連動，不然「裝備」的三十幾種子類會跟藥水混在一起
      const bySub = new Map();
      index.forEach((i) => {
        if (!bySub.has(i.cat)) bySub.set(i.cat, new Set());
        bySub.get(i.cat).add(i.sub);
      });
      const fillSub = (rerender) => {
        const cat = els.Cat.value;
        const subs = cat
          ? [...(bySub.get(cat) || [])]
          : [...new Set(index.map((i) => i.sub))];
        els.Sub.innerHTML = '<option value="">全部類型</option>';
        subs.filter(Boolean).sort().forEach((s) => {
          const o = document.createElement("option");
          o.value = s;
          o.textContent = s;
          els.Sub.appendChild(o);
        });
        // 同上：類型被重設了，列表要重畫才不會停在舊的篩選結果
        if (rerender) render();
      };
      fillSub(false);
      els.Cat.addEventListener("change", () => fillSub(true));
    },
    renderRow(i) {
      return `<button class="db-row" type="button" data-db-id="${esc(i.id)}">
        ${itemImg(i.id, 44)}
        <div class="db-row-main">
          <div class="db-row-title">
            <span class="db-row-name">${esc(i.name)}</span>
            ${i.lv ? `<span class="db-row-level">Lv.${i.lv}</span>` : ""}
            <span class="db-tag">${esc(i.sub || i.cat)}</span>
          </div>
          <div class="db-row-meta">${esc(i.cat)}</div>
        </div>
        <dl class="db-row-stats">
          <div><dt>賣店</dt><dd>${i.sell ? shortNum(i.sell) : "—"}</dd></div>
          <div><dt>來源</dt><dd>${i.from}</dd></div>
        </dl>
      </button>`;
    },
    renderDetail(d) {
      const eq = d.equip || {};
      const reqs = EQUIP_REQ.filter(([k]) => eq[k]).map(
        ([k, label]) => `<div><dt>${label}</dt><dd>${num(eq[k])}</dd></div>`
      );
      if (eq.reqJob != null) reqs.push(`<div><dt>職業</dt><dd>${jobText(eq.reqJob)}</dd></div>`);
      // 會浮動的欄位在基準值旁邊帶出範圍（例如 +72（67~77））
      const fl = d.float || {};
      const incs = EQUIP_INC.filter(([k]) => eq[k]).map(([k, label]) => {
        const r = fl[k];
        const range = r ? ` <span class="db-float-range">(${num(r[0])}~${num(r[1])})</span>` : "";
        return `<div><dt>${label}</dt><dd>+${num(eq[k])}${range}</dd></div>`;
      });
      const floatNote = Object.keys(fl).length
        ? `<p class="db-section-note">標示範圍的欄位：由${esc((d.floatFrom || []).join("或"))}拿到時，數值會在括號範圍內隨機浮動；商店購買與任務獎勵固定是基準值。</p>`
        : "";

      const sourceSection = (title, bits) =>
        bits.length
          ? `<section class="db-section">
              <h3 class="db-section-title">${title}<span class="db-sub-num">${bits.length}</span></h3>
              <div class="db-chip-row">${bits.join("")}</div>
            </section>`
          : "";

      const dropBits = (d.drops || []).map((m) =>
        linkChip("monster", m.id, m.name, m.level ? `Lv.${m.level}` : "")
      );
      const questBits = (d.quests || []).map((q) =>
        linkChip("quest", q.id, q.name, q.kind + (q.count ? ` ×${q.count}` : ""))
      );
      const shopRows = (d.shops || []).map(
        (s) => `<div class="db-sub-item">
          <span class="db-sub-name">${esc(s.npc)}</span>
          <span class="db-sub-meta">${esc(s.maps.join("、"))}</span>
          <span class="db-sub-num">${num(s.price)} ${esc(s.currency)}</span>
        </div>`
      );

      // 製作：材料點得進各自的道具頁（材料本身也是道具，多半在收錄範圍內；
      // 不在的就維持純文字）
      const crafts = (d.crafts || []).length
        ? `<section class="db-section">
            <h3 class="db-section-title">怎麼做<span class="db-sub-num">${d.crafts.length}</span></h3>
            ${d.crafts
              .map(
                (c) => `<div class="db-craft">
                  <div class="db-craft-head">${esc(c.npc)}
                    <span class="db-sub-meta">${esc(c.maps.join("、"))}</span>
                    ${c.meso ? `<span class="db-sub-num">${num(c.meso)} 楓幣</span>` : ""}</div>
                  <div class="db-chip-row">${c.materials
                    .map((m) => linkChip("item", m.id, m.name, m.count ? `×${m.count}` : ""))
                    .join("")}</div>
                </div>`
              )
              .join("")}
          </section>`
        : "";
      const usedInBits = (d.usedIn || []).map((u) => linkChip("item", u.id, u.name));

      return `<button class="db-back" type="button" data-db-back>← 回到道具列表</button>
        <div class="db-detail-head">
          ${itemImg(d.id, 64)}
          <div>
            <div class="db-row-title">
              <h2 class="db-detail-name">${esc(d.name)}</h2>
              <span class="db-tag">${esc(d.sub || d.cat)}</span>
            </div>
            <p class="db-detail-desc">${esc(d.cat)}${d.sell ? ` · 賣店價 ${num(d.sell)}` : ""}</p>
            ${d.desc ? `<p class="db-detail-desc">${esc(d.desc)}</p>` : ""}
          </div>
        </div>
        ${reqs.length ? `<section class="db-section">
          <h3 class="db-section-title">裝備需求</h3>
          <dl class="db-stat-grid">${reqs.join("")}</dl>
        </section>` : ""}
        ${incs.length ? `<section class="db-section">
          <h3 class="db-section-title">裝備加成</h3>
          <dl class="db-stat-grid">${incs.join("")}</dl>
          ${floatNote}
        </section>` : ""}
        ${sourceSection("哪些怪會掉", dropBits)}
        ${shopRows.length ? `<section class="db-section">
          <h3 class="db-section-title">哪裡買得到<span class="db-sub-num">${shopRows.length}</span></h3>
          <div class="db-sub-list">${shopRows.join("")}</div>
        </section>` : ""}
        ${sourceSection("相關任務", questBits)}
        ${crafts}
        ${sourceSection("拿來做什麼", usedInBits)}`;
    },
  });

  // ------------------------------------------------------------- NPC

  function npcImg(id, size) {
    return `<img class="db-row-icon db-row-icon--skill" src="assets/db/npcs/${encodeURIComponent(id)}.png"
      alt="" loading="lazy" decoding="async" width="${size}" height="${size}">`;
  }

  const npcs = makeSet({
    key: "npcs",
    route: "npc",
    dir: "npcs",
    prefix: "dbNpc",
    label: "NPC",
    unit: "個",
    filters: [
      { id: "Search", test: (r, v) => !v || r.name.toLowerCase().includes(v.trim().toLowerCase()) },
      { id: "Region", test: (r, v) => !v || r.region === v },
      { id: "Has", test: (r, v) => !v || (v === "quests" ? r.quests > 0 : r.shop > 0) },
    ],
    sorts: [
      { key: "region", cmp: (a, b) => a.region.localeCompare(b.region, "zh-TW") || a.where.localeCompare(b.where, "zh-TW") || a.name.localeCompare(b.name, "zh-TW") },
      { key: "quests", cmp: (a, b) => (b.quests || 0) - (a.quests || 0) },
      { key: "name", cmp: (a, b) => a.name.localeCompare(b.name, "zh-TW") },
    ],
    searchRow: (r) => [r.region, r.where].filter(Boolean).join(" · "),
    fillFilters(index, els) {
      [...new Set(index.map((n) => n.region))].filter(Boolean).sort().forEach((r) => {
        const o = document.createElement("option");
        o.value = r;
        o.textContent = r;
        els.Region.appendChild(o);
      });
    },
    renderRow(n) {
      return `<button class="db-row" type="button" data-db-id="${esc(n.id)}">
        ${npcImg(n.id, 44)}
        <div class="db-row-main">
          <div class="db-row-title"><span class="db-row-name">${esc(n.name)}</span></div>
          <div class="db-row-meta">${esc([n.region, n.where].filter(Boolean).join(" · "))}</div>
        </div>
        <dl class="db-row-stats">
          <div><dt>任務</dt><dd>${n.quests}</dd></div>
          <div><dt>商品</dt><dd>${n.shop}</dd></div>
        </dl>
      </button>`;
    },
    renderDetail(d) {
      const where = d.maps.length
        ? `<div class="db-chip-row">${d.maps
            .map((m) => linkChip("map", m.id, m.label, m.region))
            .join("")}</div>`
        : '<p class="cm-empty">沒有出沒地圖資料</p>';
      const quests = d.quests.length
        ? `<section class="db-section">
            <h3 class="db-section-title">任務<span class="db-sub-num">${d.quests.length}</span></h3>
            <div class="db-chip-row">${d.quests
              .map((q) => linkChip("quest", q.id, q.name, q.role))
              .join("")}</div>
          </section>`
        : "";
      const shop = d.shop.length
        ? `<section class="db-section">
            <h3 class="db-section-title">商店<span class="db-sub-num">${d.shop.length} 項</span></h3>
            <div class="db-sub-list">${d.shop
              .map(
                (s) => `<button class="db-sub-item db-sub-item--link" type="button"
                          data-db-goto="item" data-db-id="${esc(s.id)}">
                  <span class="db-sub-name">${esc(s.name)}</span>
                  <span class="db-sub-meta"></span>
                  <span class="db-sub-num">${num(s.price)} ${esc(s.currency)}</span>
                </button>`
              )
              .join("")}</div>
          </section>`
        : "";
      const crafts = (d.crafts || []).length
        ? `<section class="db-section">
            <h3 class="db-section-title">可以製作<span class="db-sub-num">${d.crafts.length} 種</span></h3>
            <div class="db-chip-row">${d.crafts
              .map((c) => linkChip("item", c.id, c.name, c.meso ? `${num(c.meso)} 楓幣` : ""))
              .join("")}</div>
          </section>`
        : "";
      const empty = !d.quests.length && !d.shop.length && !(d.crafts || []).length;
      return `<button class="db-back" type="button" data-db-back>← 回到 NPC 列表</button>
        <div class="db-detail-head">
          ${npcImg(d.id, 64)}
          <div>
            <div class="db-row-title"><h2 class="db-detail-name">${esc(d.name)}</h2></div>
          </div>
        </div>
        <section class="db-section">
          <h3 class="db-section-title">出沒地圖<span class="db-sub-num">${d.maps.length}</span></h3>
          ${where}
        </section>
        ${quests}
        ${shop}
        ${crafts}
        ${empty
          ? '<p class="db-section-note">這個 NPC 在遊戲資料裡沒有任務、商店或製作功能。</p>'
          : ""}`;
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
    searchRow: (r) =>
      [r.cat, r.lv ? `Lv.${r.lv}` : "", r.npc ? `NPC：${r.npc}` : ""].filter(Boolean).join(" · "),
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

      // 未命名道具不在道具資料集裡，照列但不做成連結
      const itemChip = (i) =>
        i.link
          ? linkChip("item", i.id, i.name, i.count ? `×${i.count}` : "")
          : plainChip(i.name, i.count ? `×${i.count}` : "");
      const startBits = [];
      if (d.start.level) startBits.push(plainChip(`Lv.${d.start.level} 以上`));
      (d.start.items || []).forEach((i) => startBits.push(itemChip(i)));
      (d.start.quests || []).forEach((q) =>
        startBits.push(
          q.link ? linkChip("quest", q.id, q.name, q.state) : plainChip(q.name, q.state)
        )
      );

      const compBits = [];
      (d.complete.items || []).forEach((i) => compBits.push(itemChip(i)));
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
      (rw.items || []).forEach((i) => rwBits.push(itemChip(i)));
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
    searchRow: (r) => [r.group, r.job, r.adv].filter(Boolean).join(" · "),
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

  // ------------------------------------------------------------- 世界地圖
  // 跟其他資料集不同：不是「列表＋詳情」，是四塊區域各一張手繪大圖，圖上的
  // 節點直接連到地圖詳情。節點座標是匯入時算好的百分比，連線用一層 SVG 畫
  // （viewBox 0~100 配 preserveAspectRatio="none"，跟節點同一套座標）。
  // 圖上文字很多，手機塞不下也不該縮到看不清——外層給橫向捲動，圖保持
  // 讀得了字的最小寬度
  const world = (() => {
    const view = document.getElementById("dbWorldView");
    const tabsBox = document.getElementById("dbWorldTabs");
    const box = document.getElementById("dbWorldBox");
    const countEl = document.getElementById("dbWorldCount");
    if (!view || !tabsBox || !box) return null;

    const REGION_KEY = "maple_classic_db_world_region";
    let regions = null;
    let loading = null;
    let current = null;

    function render() {
      const r = regions.find((x) => x.key === current) || regions[0];
      current = r.key;
      tabsBox.innerHTML = regions
        .map(
          (x) => `<button class="cm-sort-btn${x.key === r.key ? " active" : ""}" type="button"
                    role="tab" aria-selected="${x.key === r.key}"
                    data-world-region="${esc(x.key)}">${esc(x.name)}</button>`
        )
        .join("");
      if (countEl) countEl.textContent = `${r.nodes.length} 張地圖`;

      const pos = new Map(r.nodes.map((n) => [n.id, n]));
      const lines = r.edges
        .map(([a, b]) => {
          const na = pos.get(a);
          const nb = pos.get(b);
          return `<line x1="${na.x}" y1="${na.y}" x2="${nb.x}" y2="${nb.y}"/>`;
        })
        .join("");
      const nodes = r.nodes
        .map((n) => {
          const at = `style="left:${n.x}%;top:${n.y}%"`;
          const dot = "<i></i>";
          return n.link
            ? `<button class="db-wnode" type="button" data-db-goto="map"
                 data-db-id="${esc(n.id)}" ${at}
                 title="${esc([n.street, n.name].filter(Boolean).join(" / "))}">${dot}${esc(n.name)}</button>`
            : `<span class="db-wnode db-wnode--plain" ${at}>${dot}${esc(n.name)}</span>`;
        })
        .join("");
      const proxies = r.proxies
        .map(
          (p) => `<button class="db-wnode db-wnode--region" type="button"
                    data-world-region="${esc(p.region)}"
                    style="left:${p.x}%;top:${p.y}%">前往 ${esc(p.name)} →</button>`
        )
        .join("");

      // 藥丸的字不跟著圖縮放，節點一多就會互相蓋住——維多利亞島 129 個節點
      // 需要比其他三塊大得多的畫布，字才攤得開。超出面板寬度就橫向捲動
      const minW = r.nodes.length > 80 ? 1200 : 760;
      box.innerHTML = `<div class="db-world-scroll">
          <div class="db-world-figure" style="min-width:${minW}px">
            <img class="db-world-img" src="assets/db/worldmaps/${esc(r.key)}.png"
                 alt="${esc(r.name)} 世界地圖" decoding="async">
            <svg class="db-world-lines" viewBox="0 0 100 100" preserveAspectRatio="none"
                 aria-hidden="true">${lines}</svg>
            ${nodes}${proxies}
          </div>
        </div>
        <p class="db-section-note">點地圖上的名字可以看那張地圖的資料；「前往◯◯」切到相鄰的區域。點地圖底圖可以放大檢視，名字攤得更開、更好點。</p>`;
      const scroller = box.querySelector(".db-world-scroll");
      if (scroller) scroller.scrollLeft = 0;
    }

    // 燈箱裡的畫布再放大一級：藥丸的字是固定大小，畫布越大攤得越開
    function zoomWidth() {
      const r = regions && (regions.find((x) => x.key === current) || regions[0]);
      return r && r.nodes.length > 80 ? 1700 : 1100;
    }

    function zoom() {
      openFigureLightbox(box.querySelector(".db-world-figure"), zoomWidth());
    }

    function show(key, skipSave) {
      current = key;
      if (!skipSave) localStorage.setItem(REGION_KEY, key);
      if (regions) render();
    }

    function load() {
      if (regions || loading) return loading || Promise.resolve();
      loading = getJson("data/db/worldmaps.json")
        .then((data) => {
          regions = Array.isArray(data) ? data : [];
          if (!current) {
            const saved = localStorage.getItem(REGION_KEY);
            current = regions.some((x) => x.key === saved) ? saved : regions[0] && regions[0].key;
          }
          render();
        })
        .catch(() => {
          if (countEl) countEl.textContent = "—";
          box.innerHTML = LOAD_ERROR;
        })
        .finally(() => {
          loading = null;
        });
      return loading;
    }

    view.addEventListener("click", (e) => {
      const reg = e.target.closest("[data-world-region]");
      const goto = e.target.closest("[data-db-goto]");
      if (reg) show(reg.dataset.worldRegion);
      else if (goto) openDetail(goto.dataset.dbGoto, goto.dataset.dbId, true);
      else if (e.target.classList.contains("db-world-img")) zoom();
    });

    // 在燈箱裡按「前往◯◯」：切區域並把燈箱換成新區域的圖，不用先關再開
    onLightboxRegion = (key) => {
      show(key);
      zoom();
    };

    return { key: "world", load, show };
  })();

  // ------------------------------------------------------------- 組裝

  const SETS = [monsters, maps, items, npcs, quests, skills].filter(Boolean);

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

  // 世界地圖不是列表＋詳情的資料集，不進 SETS（全站搜尋、網址路由都與它
  // 無關），只註冊成一個子分頁
  if (world) {
    const btn = document.getElementById("dbSubWorld");
    const view = document.getElementById("dbWorldView");
    if (btn && view) {
      tabs.push({ key: "world", btn, view });
      btn.addEventListener("click", () => {
        showTab("world");
        world.load();
        if (currentRoute()) history.replaceState({}, "", routeUrl(null));
        SETS.forEach((x) => x.showList());
      });
    }
  }

  // ------------------------------------------------------------- 全站搜尋

  const searchEls = {
    input: document.getElementById("dbGlobalSearch"),
    results: document.getElementById("dbGlobalResults"),
  };
  const SEARCH_MIN = 1; // 中文一個字就有意義，不用等到兩個字
  const PER_SET = 6; // 每個資料集先列幾筆，太多會把其他類別擠掉

  function runGlobalSearch() {
    const q = (searchEls.input.value || "").trim().toLowerCase();
    if (q.length < SEARCH_MIN) {
      searchEls.results.innerHTML = "";
      return;
    }
    // 索引各自才幾十 KB，搜尋時才一次全載；載完就留著
    Promise.all(SETS.map((s) => s.ensure())).then(() => {
      const blocks = SETS.map((s) => {
        const hits = s.search(q);
        if (!hits.length) return "";
        const rows = hits
          .slice(0, PER_SET)
          .map(
            (r) => `<button class="db-search-hit" type="button"
                      data-db-goto="${s.route}" data-db-id="${esc(r.id)}">
              <span class="db-search-name">${esc(r.name)}</span>
              <span class="db-search-meta">${esc(s.searchRow ? s.searchRow(r) : "")}</span>
            </button>`
          )
          .join("");
        const more =
          hits.length > PER_SET
            ? `<p class="db-section-note">還有 ${hits.length - PER_SET} 筆，到「${esc(s.label)}」子分頁用同樣的關鍵字可以看完整清單。</p>`
            : "";
        return `<div class="db-search-group">
          <div class="db-drop-cat">${esc(s.label)}<span class="db-sub-num">${hits.length} ${esc(s.unit)}</span></div>
          ${rows}${more}
        </div>`;
      }).filter(Boolean);

      searchEls.results.innerHTML = blocks.length
        ? blocks.join("")
        : '<p class="cm-empty">找不到符合的資料</p>';
    });
  }

  if (searchEls.input) {
    let searchTimer = null;
    searchEls.input.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runGlobalSearch, 180);
    });
    searchEls.results.addEventListener("click", (e) => {
      const hit = e.target.closest("[data-db-goto]");
      if (hit) openDetail(hit.dataset.dbGoto, hit.dataset.dbId, true);
    });
  }

  window.addEventListener("popstate", () => {
    const route = currentRoute();
    if (route) {
      const s = SETS.find((x) => x.route === route.set);
      if (s) {
        // 使用者可能已經切到別的主分頁了（例如去了練等計算再按上一頁），
        // 只切子分頁的話網址變了但畫面還停在原地，看起來像上一頁壞掉
        if (window.MapleNav) window.MapleNav.switchNav("db");
        showTab(s.key, true);
        s.load();
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

  // 決定初始子分頁：詳情網址（?db=…）最優先，其次錨點（#db-skills，guides/
  // 文章頁的側邊欄連的就是這種），再來才是記住的，最後預設第一個。
  // 錨點要在 nav.js 把它從網址列抹掉之前讀——nav.js 是先呼叫 switchNav
  // （會觸發這裡的 load）才抹，所以讀得到
  function load() {
    const route = currentRoute();
    const routed = route && SETS.find((s) => s.route === route.set);
    const hashSub = location.hash.slice(1).split("-")[1];
    // 世界地圖不在 SETS 裡，錨點（#db-world）與記住的子分頁要另外認得它
    const isWorld = (k) => world && k === "world";
    const hashed = SETS.find((s) => s.key === hashSub);
    const saved = localStorage.getItem(TAB_KEY);
    const initial = routed
      ? routed.key
      : hashed
      ? hashed.key
      : isWorld(hashSub)
      ? "world"
      : SETS.some((s) => s.key === saved) || isWorld(saved)
      ? saved
      : SETS[0] && SETS[0].key;
    if (initial) showTab(initial, true);
    if (isWorld(initial)) world.load();
    const target = SETS.find((s) => s.key === initial);
    if (target) target.load();
  }

  // showSet 給外部（首頁卡片、sidebar.js 的 [data-nav-subtab]）用：切子分頁
  // 順便把該資料集的索引載起來，不然會看到空列表
  function showSet(key) {
    showTab(key);
    if (world && key === "world") {
      world.load();
      return;
    }
    const s = SETS.find((x) => x.key === key);
    if (s) s.load();
  }

  window.MapleDb = { load, showTab: showSet };

  // ---------------------------------- 計算工具：獨立版命中率計算
  // 跟怪物頁的試算區共用 computeHit / hitResultHtml / HIT_PREFS_KEY，差別
  // 只在怪物不是從詳情頁帶入，而是自己搜。索引檔小（含迴避欄位），選了
  // 怪立即能算，不用再抓詳情
  (function initCalcHit() {
    const view = document.getElementById("calcHitView");
    if (!view) return;
    const searchEl = document.getElementById("hitMobSearch");
    const listEl = document.getElementById("hitMobList");
    const formEl = document.getElementById("hitCalcForm");
    const outEl = document.getElementById("hitCalcResult");
    const PICK_KEY = "maple_classic_hit_mob";
    let index = null;
    let picked = null;

    function ensureIndex() {
      if (index) return Promise.resolve(index);
      return getJson("data/db/monsters.json").then((rows) => {
        index = rows.filter((r) => r.eva != null && r.level != null);
        return index;
      });
    }

    function renderList() {
      const q = searchEl.value.trim().toLowerCase();
      const rows = index
        .filter((r) => !q || r.name.toLowerCase().includes(q))
        .slice(0, 24);
      listEl.innerHTML = rows.length
        ? rows
            .map(
              (r) => `<button class="db-chip${picked && picked.id === r.id ? " db-chip--on" : ""}"
                        type="button" data-hit-mob="${esc(r.id)}">
                ${esc(r.name)}<span class="db-sub-num">Lv.${r.level}</span>
              </button>`
            )
            .join("")
        : '<p class="cm-empty">找不到符合的怪物</p>';
    }

    function renderForm() {
      if (!picked) {
        formEl.innerHTML = "";
        outEl.innerHTML = '<p class="db-section-note">先從上面選一隻怪物。</p>';
        return;
      }
      const p = hitPrefs();
      const magic = p.type === "magic";
      const level = p.level >= 1 ? p.level : 30;
      formEl.innerHTML = `
        <p class="db-detail-desc">目標：<strong>${esc(picked.name)}</strong>
          Lv.${picked.level} · 迴避 ${picked.eva}
          <button class="db-inline-link" type="button" id="hitMobDetail">看這隻怪的資料 →</button></p>
        <div class="db-map-toggles">
          <button class="cm-sort-btn${magic ? "" : " active"}" type="button" data-hit2-type="phys">物理攻擊</button>
          <button class="cm-sort-btn${magic ? " active" : ""}" type="button" data-hit2-type="magic">魔法攻擊</button>
        </div>
        <div class="cm-filter-row">
          <label class="db-calc-field">你的等級
            <input class="cm-filter-input cm-filter-lv" id="hit2Level" type="number"
                   min="1" max="199" value="${level}" inputmode="numeric">
          </label>
          <label class="db-calc-field"${magic ? " hidden" : ""} id="hit2AccField">面板命中
            <input class="cm-filter-input cm-filter-lv" id="hit2Acc" type="number"
                   min="0" max="999" value="${p.acc >= 0 ? p.acc : 100}" inputmode="numeric">
          </label>
          <label class="db-calc-field"${magic ? "" : " hidden"} id="hit2IntField">智力
            <input class="cm-filter-input cm-filter-lv" id="hit2Int" type="number"
                   min="0" max="999" value="${p.int >= 0 ? p.int : 100}" inputmode="numeric">
          </label>
          <label class="db-calc-field"${magic ? "" : " hidden"} id="hit2LukField">幸運
            <input class="cm-filter-input cm-filter-lv" id="hit2Luk" type="number"
                   min="0" max="999" value="${p.luk >= 0 ? p.luk : 4}" inputmode="numeric">
          </label>
        </div>`;
      renderResult();
    }

    function renderResult() {
      if (!picked) return;
      const magic = formEl
        .querySelector('[data-hit2-type="magic"]')
        .classList.contains("active");
      const level = parseInt(document.getElementById("hit2Level").value, 10);
      if (!(level >= 1)) {
        outEl.innerHTML = '<p class="db-section-note">填入你的等級與能力值就會算出來。</p>';
        return;
      }
      const acc = parseInt(document.getElementById("hit2Acc").value, 10) || 0;
      const intv = parseInt(document.getElementById("hit2Int").value, 10) || 0;
      const luk = parseInt(document.getElementById("hit2Luk").value, 10) || 0;
      localStorage.setItem(HIT_PREFS_KEY, JSON.stringify(
        magic ? { type: "magic", level, int: intv, luk } : { type: "phys", level, acc }
      ));
      outEl.innerHTML = hitResultHtml(
        computeHit({ eva: picked.eva, mobLv: picked.level, level, magic, acc, intv, luk }),
        magic
      );
    }

    // 首次切到這個子分頁才載索引（跟資料庫分頁同一個檔，之後互相吃快取）
    const btn = document.getElementById("calcSubHit");
    let loadedOnce = false;
    function activate() {
      if (loadedOnce) return;
      loadedOnce = true;
      ensureIndex()
        .then(() => {
          const savedId = localStorage.getItem(PICK_KEY);
          picked = index.find((r) => r.id === savedId) || null;
          renderList();
          renderForm();
        })
        .catch(() => {
          listEl.innerHTML = LOAD_ERROR;
        });
    }
    if (btn) btn.addEventListener("click", activate);
    // 直接用 #calc-hit 錨點或記住的子分頁進來時，按鈕不會被「點」到
    if (!view.hidden) activate();
    new MutationObserver(() => {
      if (!view.hidden) activate();
    }).observe(view, { attributes: true, attributeFilter: ["hidden"] });

    searchEl.addEventListener("input", () => {
      if (index) renderList();
    });
    view.addEventListener("click", (e) => {
      const mob = e.target.closest("[data-hit-mob]");
      if (mob) {
        picked = index.find((r) => r.id === mob.dataset.hitMob) || picked;
        localStorage.setItem(PICK_KEY, picked ? picked.id : "");
        renderList();
        renderForm();
        return;
      }
      const type = e.target.closest("[data-hit2-type]");
      if (type) {
        formEl.querySelectorAll("[data-hit2-type]").forEach((b) =>
          b.classList.toggle("active", b === type)
        );
        const magic = type.dataset.hit2Type === "magic";
        document.getElementById("hit2AccField").hidden = magic;
        document.getElementById("hit2IntField").hidden = !magic;
        document.getElementById("hit2LukField").hidden = !magic;
        renderResult();
        return;
      }
      if (e.target.closest("#hitMobDetail") && picked) {
        openDetail("monster", picked.id, true);
      }
    });
    view.addEventListener("input", (e) => {
      if (/^hit2(Level|Acc|Int|Luk)$/.test(e.target.id)) renderResult();
    });
  })();
})();
