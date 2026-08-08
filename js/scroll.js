/**
 * scroll.js — 卷軸強化模擬
 * -----------------------------------------------------------------
 * 計算邏輯完整對齊經典版拆包計算機（morris 版）：
 * - 從裝備資料庫挑一件（分類/部位/職業/等級篩選、浮動初始屬性可調）
 * - 加入多種卷軸組成策略（張數/目標成功數/單價）
 * - 動態規劃搜尋最低平均成本的使用順序（每衝一張後重新決定下一張，
 *   不可能達標時直接停損重做），輸出精確機率與期望成本
 * - 再用蒙地卡羅模擬跑出實際成本分布（平均/中位數/P90/P95）與過程樣本
 *
 * 資料在 data/db/scroll_sim.json，切到「卷軸強化模擬」子分頁才抓
 * （初次載入由 nav.js 觸發 load()，跟資料庫頁同一套規矩）。
 * -----------------------------------------------------------------
 */
(function () {
  const view = document.getElementById("calcScrollView");
  if (!view) return;

  const SAMPLE_LIMIT = 8;
  const SAMPLE_ATTEMPT_DETAIL_LIMIT = 500;
  const OPTIMIZE_STATE_LIMIT = 1000000;
  const PICKER_EQUIP_LIMIT = 350;
  const PICKER_SCROLL_LIMIT = 400;
  const STAT_LABELS = {
    incSTR: "力量",
    incDEX: "敏捷",
    incINT: "智力",
    incLUK: "幸運",
    incMHP: "MaxHP",
    incMMP: "MaxMP",
    incPAD: "攻擊力",
    incMAD: "魔法攻擊力",
    incPDD: "防禦力",
    incMDD: "魔法防禦力",
    incACC: "命中",
    incEVA: "迴避",
    incSpeed: "移動速度",
    incJump: "跳躍",
    incCraft: "熟練",
    reqLevel: "需求等級",
    reqJob: "職業",
    tuc: "可強化次數",
    price: "賣店價格",
  };
  const STAT_ORDER = ["incPAD", "incMAD", "incSTR", "incDEX", "incINT", "incLUK", "incACC", "incEVA", "incPDD", "incMDD", "incMHP", "incMMP", "incSpeed", "incJump", "incCraft"];
  const WEAPON_TYPES = ["單手劍", "單手斧", "單手棍", "短刀", "短杖", "雙手劍", "雙手斧", "雙手棍", "長杖", "弓", "弩", "拳套", "指虎", "槍", "矛", "火槍"];
  const ONE_HAND_WEAPON_TYPES = ["單手劍", "單手斧", "單手棍", "短刀", "短杖"];
  const TWO_HAND_WEAPON_TYPES = ["雙手劍", "雙手斧", "雙手棍", "長杖", "弓", "弩", "拳套", "指虎", "槍", "矛", "火槍"];
  const ARMOR_TYPES = ["帽子", "上衣", "套服", "褲裙", "手套", "鞋子", "披風", "盾牌"];
  const ACCESSORY_TYPES = ["耳環", "戒指", "墜飾", "腰帶", "眼飾", "臉飾"];
  const EQUIPMENT_GROUP_SUBCATEGORIES = {
    armor: ["上衣", "手套", "盾牌", "套服", "帽子", "披風", "鞋子", "褲裙"],
    weapon: ["弓", "火槍", "矛", "弩", "長杖", "指虎", "拳套", "單手斧", "單手棍", "單手劍", "短刀", "短杖", "槍", "雙手斧", "雙手棍", "雙手劍"],
    accessory: ["耳環", "戒指", "眼飾", "腰帶", "墜飾", "勳章", "臉飾"],
    other: ["裝備", "寵物裝備", "騎寵", "騎寵鞍座"],
  };
  const EQUIPMENT_JOB_BITS = { warrior: 1, magician: 2, bowman: 4, thief: 8, pirate: 16 };
  // 卷軸說明的部位用語跟裝備分類不完全一致（短劍=短刀、頭盔=帽子…），
  // 比對前先把同義詞展開
  const EQUIPMENT_SCROLL_SYNONYMS = {
    上衣: ["上衣"],
    套服: ["套服", "全身盔甲", "全身鎧甲"],
    褲裙: ["褲裙", "褲子", "褲/裙", "褲、裙", "裙"],
    帽子: ["帽子", "頭盔"],
    手套: ["手套"],
    鞋子: ["鞋子"],
    披風: ["披風"],
    盾牌: ["盾牌"],
    單手劍: ["單手劍"],
    單手斧: ["單手斧"],
    單手棍: ["單手棍", "單手鈍器"],
    雙手劍: ["雙手劍"],
    雙手斧: ["雙手斧"],
    雙手棍: ["雙手棍", "雙手鈍器"],
    短刀: ["短刀", "短劍"],
    短杖: ["短杖"],
    長杖: ["長杖"],
    弓: ["弓"],
    弩: ["弩"],
    拳套: ["拳套"],
    指虎: ["指虎"],
    槍: ["槍"],
    矛: ["矛"],
    火槍: ["火槍"],
    耳環: ["耳環"],
    戒指: ["戒指", "戒子"],
    墜飾: ["墜飾", "項鍊"],
    腰帶: ["腰帶"],
    眼飾: ["眼飾", "眼鏡", "龍眼鏡"],
    臉飾: ["臉飾"],
    寵物裝備: ["寵物"],
  };

  let db = null;
  let loadPromise = null;
  let els = null;
  let equipmentById = new Map();
  let scrollById = new Map();

  const state = {
    equipmentQuery: "",
    equipmentGroup: "",
    equipmentPart: "",
    equipmentJob: "",
    equipmentLevelMin: "",
    equipmentLevelMax: "",
    scrollQuery: "",
    scrollSuccess: "",
    selectedEquipmentId: null,
    selectedScrollId: null,
    initialStats: {},
    strategy: [],
  };

  // ------------------------------------------------------------ 小工具

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function norm(value) {
    return String(value || "").toLowerCase().trim();
  }

  function numberValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function integerValue(value, fallback = 0) {
    return Math.max(0, Math.floor(numberValue(value, fallback)));
  }

  function clampInteger(value, min, max, fallback) {
    const number = integerValue(value, fallback);
    return Math.max(min, Math.min(max, number));
  }

  function moneyValue(value, fallback = 0) {
    const text = String(value == null ? "" : value).replace(/[^\d]/g, "");
    if (!text) return fallback;
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
  }

  function formatMoneyInput(value) {
    const raw = String(value == null ? "" : value).replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
    if (!raw) return "";
    return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatChineseMeso(value) {
    const raw = String(value == null ? "" : value).replace(/[^\d]/g, "");
    if (!raw || raw === "0") return "";
    const number = BigInt(raw);
    const yi = number / 100000000n;
    const wan = (number % 100000000n) / 10000n;
    const rest = number % 10000n;
    const parts = [];
    if (yi) parts.push(yi + "億");
    if (wan) parts.push(wan + "萬");
    if (rest || !parts.length) parts.push(String(rest));
    return parts.join("") + "楓幣";
  }

  function setPriceHint(hint, value) {
    if (hint) hint.textContent = formatChineseMeso(value);
  }

  // 千分位即時排版：重排後把游標放回原本數字的位置
  function formatPriceInput(input, hint) {
    if (!input) return 0;
    const before = input.value;
    const selection = input.selectionStart != null ? input.selectionStart : before.length;
    const digitsBeforeCursor = before.slice(0, selection).replace(/[^\d]/g, "").length;
    const formatted = formatMoneyInput(before);
    input.value = formatted;
    if (document.activeElement === input) {
      let seenDigits = 0;
      let nextCursor = formatted.length;
      for (let index = 0; index < formatted.length; index += 1) {
        if (/\d/.test(formatted[index])) seenDigits += 1;
        if (seenDigits >= digitsBeforeCursor) {
          nextCursor = index + 1;
          break;
        }
      }
      try {
        input.setSelectionRange(nextCursor, nextCursor);
      } catch (e) { /* number input 不支援就算了 */ }
    }
    setPriceHint(hint, formatted);
    return moneyValue(formatted, 0);
  }

  function numericLevelText(value) {
    return String(value || "").replace(/[^\d]/g, "").slice(0, 3);
  }

  function levelFilterValue(value) {
    const number = Number(numericLevelText(value));
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function fmt(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("zh-TW") : esc(value);
  }

  function formatSigned(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return esc(value);
    return (number > 0 ? "+" : "") + number.toLocaleString("zh-TW");
  }

  function formatMeso(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number).toLocaleString("zh-TW") + " 楓幣" : "無法估算";
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0%";
    return (number * 100).toFixed(number >= 0.1 ? 2 : 4).replace(/\.?0+$/, "") + "%";
  }

  function formatStatEffects(effects) {
    const rows = Object.entries(effects || {})
      .sort((a, b) => {
        const ai = STAT_ORDER.indexOf(a[0]);
        const bi = STAT_ORDER.indexOf(b[0]);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a[0].localeCompare(b[0]);
      })
      .map(([key, value]) => (STAT_LABELS[key] || key) + formatSigned(value));
    return rows.length ? rows.join("、") : "無效果";
  }

  function itemIcon(item) {
    if (item && item.image) {
      return '<img class="ssim-icon" src="' + esc(item.image) + '" alt="" loading="lazy" width="32" height="32">';
    }
    return '<span class="ssim-icon ssim-icon--empty">' + esc(String((item && item.name) || "?").slice(0, 1)) + "</span>";
  }

  function formatReqJob(value) {
    const mask = Number(value || 0);
    if (!mask) return "全職業";
    const rows = [];
    if (mask & 1) rows.push("劍士");
    if (mask & 2) rows.push("法師");
    if (mask & 4) rows.push("弓箭手");
    if (mask & 8) rows.push("盜賊");
    if (mask & 16) rows.push("海盜");
    return rows.length ? rows.join(" / ") : "職業 " + mask;
  }

  // ---------------------------------------------------- 卷軸↔裝備比對

  function scrollMatchText(scroll) {
    return norm(((scroll && scroll.target) || "") + " " + ((scroll && scroll.name) || "") + " " + ((scroll && scroll.desc) || ""))
      .replace(/短劍/g, "短刀")
      .replace(/頭盔/g, "帽子")
      .replace(/全身盔甲|全身鎧甲/g, "套服")
      .replace(/褲\/裙|褲、裙|褲子/g, "褲裙")
      .replace(/戒子/g, "戒指");
  }

  function scrollMatchesEquipment(scroll, equipment) {
    if (!scroll || !equipment) return true;
    const type = equipment.subcategory || "";
    const text = scrollMatchText(scroll);
    const hasToken = (token) => {
      const normalized = norm(token);
      // 「槍」會撞到「火槍」，火槍卷軸不能配槍
      if (type === "槍" && normalized === "槍" && text.includes("火槍")) return false;
      return text.includes(normalized);
    };
    if (!type) return true;
    if (equipment.name && text.includes(norm(equipment.name))) return true;
    if (text.includes("寵物")) return type === "寵物裝備";
    const mentionsOneHand = text.includes("單手武器");
    const mentionsTwoHand = text.includes("雙手武器");
    if (mentionsOneHand && ONE_HAND_WEAPON_TYPES.includes(type)) return true;
    if (mentionsTwoHand && TWO_HAND_WEAPON_TYPES.includes(type)) return true;
    if (text.includes("武器") && !mentionsOneHand && !mentionsTwoHand && WEAPON_TYPES.includes(type)) return true;
    if (text.includes("防具") && ARMOR_TYPES.includes(type)) return true;
    if ((text.includes("飾品") || text.includes("裝飾品")) && ACCESSORY_TYPES.includes(type)) return true;
    return (EQUIPMENT_SCROLL_SYNONYMS[type] || [type]).some(hasToken);
  }

  // ------------------------------------------------------ 裝備與初始屬性

  function selectedEquipment() {
    return equipmentById.get(Number(state.selectedEquipmentId)) || null;
  }

  function selectedScroll() {
    return scrollById.get(Number(state.selectedScrollId)) || null;
  }

  function maxSlots() {
    const equipment = selectedEquipment();
    return Math.max(0, Number((equipment && equipment.stats && equipment.stats.tuc) || 0));
  }

  function strategySlotCount(excludeIndex = -1) {
    return state.strategy.reduce((sum, row, index) => {
      if (index === excludeIndex) return sum;
      return sum + Math.max(0, integerValue(row.count, 0));
    }, 0);
  }

  function availableSlots(excludeIndex = -1) {
    return Math.max(0, maxSlots() - strategySlotCount(excludeIndex));
  }

  function statBaseValue(equipment, key) {
    const range = equipment && equipment.statRanges && equipment.statRanges[key];
    const value = range && range.base !== undefined ? range.base : equipment && equipment.stats && equipment.stats[key];
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : 0;
  }

  function statInputRange(equipment, key) {
    const range = equipment && equipment.statRanges && equipment.statRanges[key];
    const base = statBaseValue(equipment, key);
    const min = Number(range && range.min);
    const max = Number(range && range.max);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return {
        base,
        min: Math.min(min, max),
        max: Math.max(min, max),
        floating: Math.min(min, max) !== Math.max(min, max),
      };
    }
    return { base, min: base, max: base, floating: false };
  }

  function initialStatKeys(equipment) {
    if (!equipment) return [];
    const ranges = equipment.statRanges || {};
    const stats = equipment.stats || {};
    return STAT_ORDER.filter((key) => ranges[key] || Number(stats[key]));
  }

  function defaultInitialStats(equipment) {
    const rows = {};
    initialStatKeys(equipment).forEach((key) => {
      rows[key] = statInputRange(equipment, key).base;
    });
    return rows;
  }

  function resetInitialStatsForEquipment() {
    state.initialStats = defaultInitialStats(selectedEquipment());
  }

  function configuredInitialStats(equipment = selectedEquipment()) {
    const rows = defaultInitialStats(equipment);
    Object.keys(rows).forEach((key) => {
      const range = statInputRange(equipment, key);
      rows[key] = clampInteger(state.initialStats[key], range.min, range.max, range.base);
    });
    return rows;
  }

  // ------------------------------------------------------------ 篩選

  // 部位選單依「防具→武器→飾品→其他」分組，組內照 EQUIPMENT_GROUP_SUBCATEGORIES
  // 的順序（防具由上而下、武器單手到雙手）。純字母排序會把弓、矛、耳環、
  // 戒指混在一起，看起來像沒整理過
  const PART_GROUP_LABELS = { armor: "防具", weapon: "武器", accessory: "飾品", other: "其他" };

  function equipmentPartGroups() {
    const present = new Set((db.equipment || []).map((item) => item.subcategory).filter(Boolean));
    const keys = state.equipmentGroup
      ? [state.equipmentGroup]
      : ["armor", "weapon", "accessory", "other"];
    const groups = [];
    const seen = new Set();
    keys.forEach((key) => {
      const parts = (EQUIPMENT_GROUP_SUBCATEGORIES[key] || []).filter((part) => present.has(part));
      parts.forEach((part) => seen.add(part));
      if (parts.length) groups.push({ label: PART_GROUP_LABELS[key] || key, parts });
    });
    // 沒被歸到任何一組的部位（資料多了新類型時）也要看得到，不能默默消失
    const rest = [...present].filter((part) => !seen.has(part)).sort();
    if (rest.length) groups.push({ label: "其他", parts: rest });
    return groups;
  }

  function equipmentPartOptions() {
    return equipmentPartGroups().reduce((all, group) => all.concat(group.parts), []);
  }

  function equipmentMatchesGroup(item) {
    if (!state.equipmentGroup) return true;
    return (EQUIPMENT_GROUP_SUBCATEGORIES[state.equipmentGroup] || []).includes(item.subcategory || "");
  }

  function equipmentMatchesJob(item) {
    if (!state.equipmentJob) return true;
    const bit = EQUIPMENT_JOB_BITS[state.equipmentJob];
    if (!bit) return true;
    const rawMask = item.stats && item.stats.reqJob;
    if (rawMask === null || rawMask === undefined || rawMask === "") return false;
    const mask = Number(rawMask);
    if (!Number.isFinite(mask)) return false;
    if (mask <= 0) return true;
    return (mask & bit) === bit;
  }

  function equipmentMatchesLevel(item) {
    const minLevel = levelFilterValue(state.equipmentLevelMin);
    const maxLevel = levelFilterValue(state.equipmentLevelMax);
    if (minLevel === null && maxLevel === null) return true;
    const level = Number(item.stats && item.stats.reqLevel);
    if (!Number.isFinite(level)) return false;
    if (minLevel !== null && level < minLevel) return false;
    if (maxLevel !== null && level > maxLevel) return false;
    return true;
  }

  function filteredEquipment() {
    const query = norm(state.equipmentQuery);
    return (db.equipment || []).filter((item) => {
      if (state.equipmentPart && item.subcategory !== state.equipmentPart) return false;
      if (!equipmentMatchesGroup(item)) return false;
      if (!equipmentMatchesJob(item)) return false;
      if (!equipmentMatchesLevel(item)) return false;
      if (query && !norm(item.id + " " + item.name + " " + (item.subcategory || "")).includes(query)) return false;
      return true;
    });
  }

  function baseCompatibleScrolls() {
    const equipment = selectedEquipment();
    if (!equipment) return [];
    const selectedIds = new Set(state.strategy.map((row) => Number(row.scrollId)));
    return (db.scrolls || []).filter((item) =>
      !selectedIds.has(Number(item.id)) &&
      scrollMatchesEquipment(item, equipment));
  }

  function scrollSuccessOptions() {
    return [...new Set(baseCompatibleScrolls().map((item) => Number(item.successRate)).filter(Number.isFinite))]
      .sort((a, b) => b - a);
  }

  function filteredScrolls() {
    const query = norm(state.scrollQuery);
    const success = Number(state.scrollSuccess);
    return baseCompatibleScrolls().filter((item) => {
      if (Number.isFinite(success) && state.scrollSuccess !== "" && Number(item.successRate) !== success) return false;
      if (query && !norm(item.id + " " + item.name + " " + item.desc).includes(query)) return false;
      return true;
    });
  }

  // ------------------------------------------------------------ 策略

  function normalizeStrategyForEquipment() {
    const equipment = selectedEquipment();
    const slots = maxSlots();
    const seen = new Set();
    let used = 0;
    const normalized = [];
    for (const row of state.strategy) {
      const scroll = scrollById.get(Number(row.scrollId));
      if (!scroll || seen.has(Number(row.scrollId)) || !scrollMatchesEquipment(scroll, equipment) || used >= slots) continue;
      const count = clampInteger(row.count, 1, slots - used, 1);
      const target = clampInteger(row.target != null ? row.target : Math.min(1, count), 0, count, Math.min(1, count));
      normalized.push({
        scrollId: Number(row.scrollId),
        count,
        target,
        price: integerValue(row.price, 0),
      });
      seen.add(Number(row.scrollId));
      used += count;
    }
    state.strategy = normalized;
  }

  function buildStrategyPlan() {
    const rows = [];
    for (const [rowIndex, row] of state.strategy.entries()) {
      const scroll = scrollById.get(Number(row.scrollId));
      if (!scroll) continue;
      const count = Math.max(0, integerValue(row.count, 0));
      if (!count) continue;
      rows.push({
        rowIndex,
        scroll,
        count,
        target: clampInteger(row.target != null ? row.target : 0, 0, count, 0),
        price: Math.max(0, moneyValue(row.price, 0)),
      });
    }
    return {
      rows,
      targets: rows.map((row) => row.target),
      initialRemaining: rows.map((row) => row.count),
      totalCount: rows.reduce((sum, row) => sum + row.count, 0),
    };
  }

  function addToMap(map, key, value) {
    map.set(key, (map.get(key) || 0) + value);
  }

  function successKey(counts) {
    return counts.map((value) => Math.max(0, integerValue(value, 0))).join("|");
  }

  function parseSuccessKey(key) {
    if (!key) return [];
    return String(key).split("|").map((value) => integerValue(value, 0));
  }

  function targetVector() {
    return state.strategy.map((row) => clampInteger(row.target != null ? row.target : 0, 0, integerValue(row.count, 0), 0));
  }

  function formatSuccessCounts(counts, compact = false) {
    if (!state.strategy.length) return "0";
    return state.strategy.map((row, index) => {
      const scroll = scrollById.get(Number(row.scrollId));
      const name = (scroll && scroll.name) || "卷軸";
      return name + " " + fmt(counts[index] || 0);
    }).join(compact ? " / " : "、");
  }

  function formatTargetSummary(targets) {
    return state.strategy.map((row, index) => {
      const scroll = scrollById.get(Number(row.scrollId));
      return ((scroll && scroll.name) || "卷軸") + " 過 " + fmt(targets[index] || 0) + " / " + fmt(row.count || 0);
    }).join(" · ");
  }

  // ------------------------------------------------ 動態規劃最佳策略

  function planStateKey(successes, remaining) {
    return successKey(successes) + ";" + remaining.map((value) => Math.max(0, integerValue(value, 0))).join("|");
  }

  function isPlanTargetMet(successes, plan) {
    return plan.targets.every((target, index) => (successes[index] || 0) >= target);
  }

  function isPlanImpossible(successes, remaining, plan) {
    return plan.targets.some((target, index) => (successes[index] || 0) + (remaining[index] || 0) < target);
  }

  function nextPlanState(successes, remaining, actionIndex, succeeded) {
    const nextSuccesses = successes.slice();
    const nextRemaining = remaining.slice();
    nextRemaining[actionIndex] = Math.max(0, (nextRemaining[actionIndex] || 0) - 1);
    if (succeeded) nextSuccesses[actionIndex] = (nextSuccesses[actionIndex] || 0) + 1;
    return { successes: nextSuccesses, remaining: nextRemaining };
  }

  function estimatePlanStateCount(plan) {
    return plan.rows.reduce((product, row) =>
      product * Math.max(1, (row.count + 1) * (Math.min(row.target, row.count) + 1)), 1);
  }

  // λ 是「達標的價值」：二分搜尋讓「期望成本 − λ×達標機率」歸零的 λ，
  // 得到的策略就是最低「每達標一件的平均成本」的策略
  function evaluateAdjustedPlan(equipmentPrice, plan, lambda) {
    const memo = new Map();
    const actions = new Map();
    function solve(successes, remaining) {
      if (isPlanTargetMet(successes, plan)) return -lambda;
      if (isPlanImpossible(successes, remaining, plan)) return 0;
      const key = planStateKey(successes, remaining);
      if (memo.has(key)) return memo.get(key);
      let best = Infinity;
      let bestAction = -1;
      for (let actionIndex = 0; actionIndex < plan.rows.length; actionIndex += 1) {
        if ((remaining[actionIndex] || 0) <= 0) continue;
        const row = plan.rows[actionIndex];
        const p = Math.max(0, Math.min(1, Number(row.scroll.successRate || 0) / 100));
        const destroyOnFail = Math.max(0, Math.min(1, Number(row.scroll.destroyRate || 0) / 100));
        const successState = nextPlanState(successes, remaining, actionIndex, true);
        const failState = nextPlanState(successes, remaining, actionIndex, false);
        const value = row.price +
          p * solve(successState.successes, successState.remaining) +
          (1 - p) * (1 - destroyOnFail) * solve(failState.successes, failState.remaining);
        if (
          value < best - 1e-9 ||
          (Math.abs(value - best) <= 1e-9 && row.price < ((plan.rows[bestAction] || {}).price != null ? plan.rows[bestAction].price : Infinity))
        ) {
          best = value;
          bestAction = actionIndex;
        }
      }
      if (bestAction < 0) best = 0;
      memo.set(key, best);
      if (bestAction >= 0) actions.set(key, bestAction);
      return best;
    }
    const initialSuccesses = Array.from({ length: plan.rows.length }, () => 0);
    return {
      value: equipmentPrice + solve(initialSuccesses, plan.initialRemaining),
      actions,
    };
  }

  function combineOutcomeMap(target, source, weight) {
    source.forEach((value, key) => addToMap(target, key, value * weight));
  }

  function evaluatePolicyOutcome(equipmentPrice, plan, policy) {
    const memo = new Map();
    function solve(successes, remaining) {
      if (isPlanTargetMet(successes, plan)) {
        return {
          cost: 0,
          successProb: 1,
          stoppedProb: 0,
          destroyedProb: 0,
          successMap: new Map([[successKey(successes), 1]]),
          stoppedMap: new Map(),
          destroyedMap: new Map(),
        };
      }
      if (isPlanImpossible(successes, remaining, plan)) {
        return {
          cost: 0,
          successProb: 0,
          stoppedProb: 1,
          destroyedProb: 0,
          successMap: new Map(),
          stoppedMap: new Map([[successKey(successes), 1]]),
          destroyedMap: new Map(),
        };
      }
      const key = planStateKey(successes, remaining);
      if (memo.has(key)) return memo.get(key);
      const actionIndex = policy.actions.get(key);
      if (actionIndex === undefined || (remaining[actionIndex] || 0) <= 0) {
        const fallback = {
          cost: 0,
          successProb: 0,
          stoppedProb: 1,
          destroyedProb: 0,
          successMap: new Map(),
          stoppedMap: new Map([[successKey(successes), 1]]),
          destroyedMap: new Map(),
        };
        memo.set(key, fallback);
        return fallback;
      }
      const row = plan.rows[actionIndex];
      const p = Math.max(0, Math.min(1, Number(row.scroll.successRate || 0) / 100));
      const destroyOnFail = Math.max(0, Math.min(1, Number(row.scroll.destroyRate || 0) / 100));
      const successState = nextPlanState(successes, remaining, actionIndex, true);
      const failState = nextPlanState(successes, remaining, actionIndex, false);
      const success = solve(successState.successes, successState.remaining);
      const fail = solve(failState.successes, failState.remaining);
      const result = {
        cost: row.price + p * success.cost + (1 - p) * (1 - destroyOnFail) * fail.cost,
        successProb: p * success.successProb + (1 - p) * (1 - destroyOnFail) * fail.successProb,
        stoppedProb: p * success.stoppedProb + (1 - p) * (1 - destroyOnFail) * fail.stoppedProb,
        destroyedProb: (1 - p) * destroyOnFail + p * success.destroyedProb + (1 - p) * (1 - destroyOnFail) * fail.destroyedProb,
        successMap: new Map(),
        stoppedMap: new Map(),
        destroyedMap: new Map([[successKey(successes), (1 - p) * destroyOnFail]]),
      };
      combineOutcomeMap(result.successMap, success.successMap, p);
      combineOutcomeMap(result.successMap, fail.successMap, (1 - p) * (1 - destroyOnFail));
      combineOutcomeMap(result.stoppedMap, success.stoppedMap, p);
      combineOutcomeMap(result.stoppedMap, fail.stoppedMap, (1 - p) * (1 - destroyOnFail));
      combineOutcomeMap(result.destroyedMap, success.destroyedMap, p);
      combineOutcomeMap(result.destroyedMap, fail.destroyedMap, (1 - p) * (1 - destroyOnFail));
      memo.set(key, result);
      return result;
    }
    const initialSuccesses = Array.from({ length: plan.rows.length }, () => 0);
    const outcome = solve(initialSuccesses, plan.initialRemaining);
    const expectedCost = equipmentPrice + outcome.cost;
    const allKeys = new Set([...outcome.successMap.keys(), ...outcome.stoppedMap.keys(), ...outcome.destroyedMap.keys()]);
    const distribution = [...allKeys].map((key) => {
      const counts = parseSuccessKey(key);
      const alive = outcome.successMap.get(key) || 0;
      const stopped = outcome.stoppedMap.get(key) || 0;
      const destroyed = outcome.destroyedMap.get(key) || 0;
      return {
        key,
        counts,
        label: formatSuccessCounts(counts),
        alive,
        stopped,
        destroyed,
        targetAlive: isPlanTargetMet(counts, plan) ? alive : 0,
      };
    }).sort((a, b) => {
      const totalA = a.counts.reduce((sum, value) => sum + value, 0);
      const totalB = b.counts.reduce((sum, value) => sum + value, 0);
      return totalA - totalB || a.label.localeCompare(b.label);
    });
    return {
      destroyedProb: outcome.destroyedProb,
      stoppedProb: outcome.stoppedProb,
      targetProbability: outcome.successProb,
      expectedCost,
      expectedCostPerTarget: outcome.successProb > 0 ? expectedCost / outcome.successProb : Infinity,
      distribution,
    };
  }

  function buildFallbackPolicy(plan) {
    const actions = new Map();
    function visit(successes, remaining) {
      if (isPlanTargetMet(successes, plan) || isPlanImpossible(successes, remaining, plan)) return;
      const key = planStateKey(successes, remaining);
      if (actions.has(key)) return;
      const actionIndex = remaining.findIndex((value) => value > 0);
      if (actionIndex < 0) return;
      actions.set(key, actionIndex);
      const succeed = nextPlanState(successes, remaining, actionIndex, true);
      const fail = nextPlanState(successes, remaining, actionIndex, false);
      visit(succeed.successes, succeed.remaining);
      visit(fail.successes, fail.remaining);
    }
    visit(Array.from({ length: plan.rows.length }, () => 0), plan.initialRemaining);
    return { actions, fallback: true };
  }

  function optimizeStrategyPlan(equipmentPrice, plan) {
    if (!plan.rows.length) {
      const policy = { actions: new Map(), fallback: false };
      return { policy, exact: evaluatePolicyOutcome(equipmentPrice, plan, policy), paths: [], stateEstimate: 1 };
    }
    const stateEstimate = estimatePlanStateCount(plan);
    let policy = null;
    let warning = "";
    if (stateEstimate > OPTIMIZE_STATE_LIMIT) {
      policy = buildFallbackPolicy(plan);
      warning = "卷軸組合狀態過多，已改用目前的策略順序搭配停損規則計算。";
    } else {
      let low = 0;
      let high = Math.max(1, equipmentPrice + plan.rows.reduce((sum, row) => sum + row.price * row.count, 0));
      let adjusted = evaluateAdjustedPlan(equipmentPrice, plan, high);
      let guard = 0;
      while (adjusted.value > 0 && high < 1e15 && guard < 60) {
        high *= 2;
        adjusted = evaluateAdjustedPlan(equipmentPrice, plan, high);
        guard += 1;
      }
      for (let iteration = 0; iteration < 54; iteration += 1) {
        const mid = (low + high) / 2;
        const result = evaluateAdjustedPlan(equipmentPrice, plan, mid);
        if (result.value > 0) low = mid;
        else high = mid;
      }
      const finalAdjusted = evaluateAdjustedPlan(equipmentPrice, plan, high);
      policy = { actions: finalAdjusted.actions, fallback: false };
    }
    const exact = evaluatePolicyOutcome(equipmentPrice, plan, policy);
    return { policy, exact, paths: policyPreviewPaths(plan, policy), stateEstimate, warning };
  }

  function policyPreviewPaths(plan, policy) {
    function trace(mode) {
      const successes = Array.from({ length: plan.rows.length }, () => 0);
      const remaining = plan.initialRemaining.slice();
      const steps = [];
      while (!isPlanTargetMet(successes, plan) && !isPlanImpossible(successes, remaining, plan) && steps.length < plan.totalCount) {
        const actionIndex = policy.actions.get(planStateKey(successes, remaining));
        if (actionIndex === undefined || (remaining[actionIndex] || 0) <= 0) break;
        steps.push(actionIndex);
        remaining[actionIndex] = Math.max(0, remaining[actionIndex] - 1);
        if (mode === "success") successes[actionIndex] = (successes[actionIndex] || 0) + 1;
      }
      return {
        steps,
        achieved: isPlanTargetMet(successes, plan),
        stopped: isPlanImpossible(successes, remaining, plan),
      };
    }
    return [
      { label: "全成功時", ...trace("success") },
      { label: "連續失敗時", ...trace("failure") },
    ].filter((row) => row.steps.length);
  }

  function compactPolicyPath(plan, steps) {
    const rows = [];
    for (const actionIndex of steps) {
      const name = (plan.rows[actionIndex] && plan.rows[actionIndex].scroll.name) || "卷軸";
      const last = rows[rows.length - 1];
      if (last && last.name === name) last.count += 1;
      else rows.push({ name, count: 1 });
    }
    return rows.map((row) => row.name + (row.count > 1 ? " ×" + fmt(row.count) : "")).join(" → ");
  }

  // ---------------------------------------------------- 蒙地卡羅模擬

  function simulateSingle(equipmentPrice, plan, policy, captureSteps = false) {
    let cost = equipmentPrice;
    const successes = Array.from({ length: plan.rows.length }, () => 0);
    const remaining = plan.initialRemaining.slice();
    let destroyed = false;
    let stopped = false;
    const gains = {};
    const steps = [];
    while (true) {
      if (isPlanTargetMet(successes, plan)) break;
      if (isPlanImpossible(successes, remaining, plan)) {
        stopped = true;
        break;
      }
      const key = planStateKey(successes, remaining);
      const actionIndex = policy.actions.get(key);
      if (actionIndex === undefined || (remaining[actionIndex] || 0) <= 0) {
        stopped = true;
        break;
      }
      const row = plan.rows[actionIndex];
      const scroll = row.scroll;
      remaining[actionIndex] = Math.max(0, remaining[actionIndex] - 1);
      cost += row.price;
      const roll = Math.random() * 100;
      let result = "失敗";
      if (roll < Number(scroll.successRate || 0)) {
        successes[actionIndex] = (successes[actionIndex] || 0) + 1;
        result = "成功";
        Object.entries(scroll.effects || {}).forEach(([key2, value]) => {
          gains[key2] = (gains[key2] || 0) + Number(value || 0);
        });
      } else if (Math.random() * 100 < Number(scroll.destroyRate || 0)) {
        destroyed = true;
        result = "破壞";
      }
      if (captureSteps) steps.push({ scrollName: scroll.name, result, successes: successes.slice(), cost });
      if (destroyed) break;
    }
    return { cost, successes, destroyed, stopped, achieved: !destroyed && !stopped && isPlanTargetMet(successes, plan), gains, steps };
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] === undefined) return sorted[base];
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }

  function runMonteCarlo(equipmentPrice, plan, policy, trials, exact) {
    if (!plan.rows.length && plan.targets.some((target) => target > 0)) return null;
    if (exact.targetProbability <= 0 || exact.targetProbability < 0.0001) return null;
    const costs = [];
    const attemptCounts = [];
    const successDistribution = new Map();
    const aggregateGains = {};
    const samples = [];
    const maxAttemptsPerTarget = Math.min(200000, Math.max(200, Math.ceil(20 / exact.targetProbability)));
    for (let trial = 0; trial < trials; trial += 1) {
      let totalCost = 0;
      let attemptCount = 0;
      let final = null;
      const sampleAttempts = [];
      while (attemptCount < maxAttemptsPerTarget) {
        const capture = trial < SAMPLE_LIMIT && sampleAttempts.length < SAMPLE_ATTEMPT_DETAIL_LIMIT;
        const result = simulateSingle(equipmentPrice, plan, policy, capture);
        attemptCount += 1;
        totalCost += result.cost;
        if (capture) sampleAttempts.push(result);
        if (result.achieved) {
          final = result;
          break;
        }
      }
      if (!final) continue;
      costs.push(totalCost);
      attemptCounts.push(attemptCount);
      addToMap(successDistribution, successKey(final.successes), 1);
      Object.entries(final.gains).forEach(([key, value]) => {
        aggregateGains[key] = (aggregateGains[key] || 0) + Number(value || 0);
      });
      if (trial < SAMPLE_LIMIT) samples.push({
        totalCost,
        attemptCount,
        attempts: sampleAttempts,
        truncated: attemptCount > sampleAttempts.length,
      });
    }
    const sortedCosts = costs.slice().sort((a, b) => a - b);
    const count = costs.length || 1;
    return {
      completedTrials: costs.length,
      averageCost: costs.reduce((sum, value) => sum + value, 0) / count,
      medianCost: quantile(sortedCosts, 0.5),
      p90Cost: quantile(sortedCosts, 0.9),
      p95Cost: quantile(sortedCosts, 0.95),
      successDistribution,
      averageGains: Object.fromEntries(Object.entries(aggregateGains).map(([key, value]) => [key, value / count])),
      samples,
    };
  }

  // ------------------------------------------------------------ 渲染

  function renderPickerEmpty(label) {
    return '<p class="cm-empty">' + esc(label) + "</p>";
  }

  function renderEquipmentPickerRow(item) {
    const selected = Number(item.id) === Number(state.selectedEquipmentId);
    const level = item.stats && item.stats.reqLevel ? "Lv." + item.stats.reqLevel : "無等級限制";
    return '<button class="ssim-row' + (selected ? " ssim-row--active" : "") +
      '" type="button" role="option" aria-selected="' + selected + '" data-ssim-equip="' + esc(item.id) + '">' +
      itemIcon(item) +
      '<span class="ssim-row-text"><strong>' + esc(item.name) + "</strong>" +
      "<small>" + esc(item.subcategory || "裝備") + " · " + esc(level) + "</small></span>" +
      '<span class="ssim-badge">' + fmt((item.stats && item.stats.tuc) || 0) + " 次</span></button>";
  }

  function renderScrollPickerRow(item) {
    const selected = Number(item.id) === Number(state.selectedScrollId);
    const destroy = item.destroyRate ? " · 破壞 " + item.destroyRate + "%" : "";
    return '<button class="ssim-row' + (selected ? " ssim-row--active" : "") +
      '" type="button" role="option" aria-selected="' + selected + '" data-ssim-scroll="' + esc(item.id) + '">' +
      itemIcon(item) +
      '<span class="ssim-row-text"><strong>' + esc(item.name) + "</strong>" +
      "<small>" + esc(item.successRate) + "%" + esc(destroy) + " · " + esc(formatStatEffects(item.effects)) + "</small></span></button>";
  }

  function renderInitialStatsPanel() {
    const equipment = selectedEquipment();
    const keys = initialStatKeys(equipment);
    if (!equipment || !keys.length) {
      els.initialStats.innerHTML = "";
      return;
    }
    const hasFloating = keys.some((key) => statInputRange(equipment, key).floating);
    const sourceText = ((equipment.statRangeSources) || []).join("、");
    els.initialStats.innerHTML =
      '<div class="ssim-init-head"><strong>初始屬性</strong><span>' +
      (hasFloating ? "可在" + esc(sourceText || "裝備") + "浮動範圍內調整" : "此裝備沒有浮動範圍") + "</span>" +
      '<button class="btn btn-ghost" id="ssimResetInitStats" type="button">↺ 重置</button></div>' +
      '<div class="ssim-init-grid">' +
      keys.map((key) => {
        const range = statInputRange(equipment, key);
        const value = configuredInitialStats(equipment)[key] != null ? configuredInitialStats(equipment)[key] : range.base;
        const disabled = !range.floating;
        return '<label class="field ssim-init-field"><span>' + esc(STAT_LABELS[key] || key) + "</span>" +
          '<input class="ssim-init-input" data-ssim-init="' + esc(key) + '" type="number" min="' + esc(range.min) +
          '" max="' + esc(range.max) + '" step="1" value="' + esc(value) + '" inputmode="numeric"' + (disabled ? " disabled" : "") + ">" +
          "<small>" + (range.floating ? esc(range.min) + " ~ " + esc(range.max) : "固定") + "</small></label>";
      }).join("") + "</div>";
  }

  function renderEquipmentOptions() {
    const all = filteredEquipment();
    const rows = all.slice(0, PICKER_EQUIP_LIMIT);
    const previousEquipmentId = state.selectedEquipmentId;
    if (!state.selectedEquipmentId && rows.length) state.selectedEquipmentId = Number(rows[0].id);
    if (!rows.some((item) => Number(item.id) === Number(state.selectedEquipmentId)) && rows.length) {
      state.selectedEquipmentId = Number(rows[0].id);
    }
    if (!rows.length) state.selectedEquipmentId = null;
    if (Number(previousEquipmentId) !== Number(state.selectedEquipmentId)) resetInitialStatsForEquipment();
    els.equipPicker.innerHTML = rows.length
      ? rows.map(renderEquipmentPickerRow).join("") +
        (all.length > rows.length
          ? '<p class="cm-empty">還有 ' + fmt(all.length - rows.length) + " 筆符合，輸入關鍵字縮小範圍</p>"
          : "")
      : renderPickerEmpty("找不到符合條件的裝備");
    renderInitialStatsPanel();
  }

  function renderScrollOptions() {
    const all = filteredScrolls();
    const rows = all.slice(0, PICKER_SCROLL_LIMIT);
    if (!state.selectedScrollId && rows.length) state.selectedScrollId = Number(rows[0].id);
    if (!rows.some((item) => Number(item.id) === Number(state.selectedScrollId)) && rows.length) {
      state.selectedScrollId = Number(rows[0].id);
    }
    if (!rows.length) state.selectedScrollId = null;
    els.scrollPicker.innerHTML = rows.length
      ? rows.map(renderScrollPickerRow).join("")
      : renderPickerEmpty("沒有可用卷軸（先選裝備，卷軸清單只列用得上的）");
    updateAddButton();
  }

  function renderEquipmentFilterOptions() {
    const groups = equipmentPartGroups();
    if (state.equipmentPart && !equipmentPartOptions().includes(state.equipmentPart)) state.equipmentPart = "";
    const option = (part) =>
      '<option value="' + esc(part) + '"' + (part === state.equipmentPart ? " selected" : "") +
      ">" + esc(part) + "</option>";
    els.equipPart.innerHTML = '<option value="">全部部位</option>' + groups
      .map((group) =>
        '<optgroup label="' + esc(group.label) + '">' + group.parts.map(option).join("") + "</optgroup>")
      .join("");
    els.equipGroup.value = state.equipmentGroup;
    els.equipJob.value = state.equipmentJob;
    if (document.activeElement !== els.equipLevelMin) els.equipLevelMin.value = state.equipmentLevelMin;
    if (document.activeElement !== els.equipLevelMax) els.equipLevelMax.value = state.equipmentLevelMax;
  }

  function renderScrollFilterOptions() {
    const rates = scrollSuccessOptions();
    if (state.scrollSuccess !== "" && !rates.includes(Number(state.scrollSuccess))) state.scrollSuccess = "";
    els.scrollSuccess.innerHTML = '<option value="">全部成功率</option>' + rates
      .map((rate) => '<option value="' + esc(rate) + '"' + (String(rate) === String(state.scrollSuccess) ? " selected" : "") + ">" + esc(rate) + "%</option>")
      .join("");
  }

  function renderStrategy() {
    const slots = maxSlots();
    const used = strategySlotCount();
    const slotNote = '<p class="ssim-slot-note">已安排 ' + fmt(used) + " / " + fmt(slots) + " 張卷軸</p>";
    if (!state.strategy.length) {
      els.strategy.innerHTML = slotNote + '<p class="cm-empty">尚未加入卷軸</p>';
      updateAddButton();
      return;
    }
    els.strategy.innerHTML = slotNote + state.strategy.map((row, index) => {
      const scroll = scrollById.get(Number(row.scrollId));
      if (!scroll) return "";
      const maxCount = Math.max(1, row.count + availableSlots(index));
      const target = clampInteger(row.target != null ? row.target : Math.min(1, row.count), 0, row.count, Math.min(1, row.count));
      return '<article class="ssim-strategy-row" data-ssim-index="' + index + '">' +
        itemIcon(scroll) +
        '<div class="ssim-strategy-main"><strong>' + esc(scroll.name) + "</strong>" +
        "<small>" + esc(scroll.successRate) + "%" + (scroll.destroyRate ? " · 破壞 " + esc(scroll.destroyRate) + "%" : "") +
        " · " + esc(formatStatEffects(scroll.effects)) + "</small>" +
        '<div class="ssim-strategy-inputs">' +
        '<label>張數 <input class="ssim-strat-count" type="number" min="1" max="' + esc(maxCount) + '" step="1" value="' + esc(row.count) + '" inputmode="numeric"></label>' +
        '<label>目標成功 <input class="ssim-strat-target" type="number" min="0" max="' + esc(row.count) + '" step="1" value="' + esc(target) + '" inputmode="numeric"></label>' +
        '<label>單價 <input class="ssim-strat-price" type="text" inputmode="numeric" value="' + esc(formatMoneyInput(row.price)) + '">' +
        '<small class="ssim-price-hint">' + esc(formatChineseMeso(row.price)) + "</small></label>" +
        "</div></div>" +
        '<div class="ssim-strategy-actions">' +
        '<button class="btn btn-ghost" type="button" data-ssim-move="up" title="上移" aria-label="上移">↑</button>' +
        '<button class="btn btn-ghost" type="button" data-ssim-move="down" title="下移" aria-label="下移">↓</button>' +
        '<button class="btn btn-ghost" type="button" data-ssim-remove title="移除" aria-label="移除">✕</button>' +
        "</div></article>";
    }).join("");
    updateAddButton();
  }

  function updateAddButton() {
    const slotsLeft = availableSlots();
    const scroll = selectedScroll();
    const disabled = !scroll || slotsLeft <= 0;
    els.addScroll.disabled = disabled;
    els.addScroll.textContent = slotsLeft <= 0 ? "強化欄位已滿" : scroll ? "加入卷軸" : "沒有可用卷軸";
    els.addCount.max = String(Math.max(1, slotsLeft));
    if (slotsLeft > 0 && integerValue(els.addCount.value, 1) > slotsLeft) {
      els.addCount.value = String(slotsLeft);
    }
    const count = clampInteger(els.addCount.value, 1, Math.max(1, slotsLeft), 1);
    els.addTarget.max = String(count);
    els.addTarget.disabled = disabled;
    const target = clampInteger(els.addTarget.value, 0, count, Math.min(1, count));
    els.addTarget.value = String(target);
  }

  function refreshStrategyControls() {
    const note = els.strategy.querySelector(".ssim-slot-note");
    if (note) note.textContent = "已安排 " + fmt(strategySlotCount()) + " / " + fmt(maxSlots()) + " 張卷軸";
    els.strategy.querySelectorAll(".ssim-strategy-row").forEach((row) => {
      const index = Number(row.dataset.ssimIndex);
      const entry = state.strategy[index];
      if (!entry) return;
      const maxCount = Math.max(1, entry.count + availableSlots(index));
      const countInput = row.querySelector(".ssim-strat-count");
      const targetInput = row.querySelector(".ssim-strat-target");
      if (countInput) countInput.max = String(maxCount);
      if (targetInput) {
        targetInput.max = String(entry.count);
        const target = clampInteger(entry.target != null ? entry.target : 0, 0, entry.count, 0);
        entry.target = target;
        if (integerValue(targetInput.value, 0) > entry.count) targetInput.value = String(target);
      }
    });
    updateAddButton();
  }

  function updateCount() {
    els.count.textContent = fmt(filteredEquipment().length) + " 件裝備 · " + fmt(filteredScrolls().length) + " 種卷軸";
  }

  function renderSelectors() {
    renderEquipmentFilterOptions();
    renderEquipmentOptions();
    normalizeStrategyForEquipment();
    renderScrollFilterOptions();
    renderScrollOptions();
    renderStrategy();
    updateCount();
  }

  function renderEquipmentCard(equipment) {
    if (!equipment) return '<p class="cm-empty">請先選擇一件裝備</p>';
    const stats = equipment.stats || {};
    const initialStats = configuredInitialStats(equipment);
    const bonusRows = STAT_ORDER
      .filter((key) => Number(initialStats[key]))
      .map((key) => "<span>" + esc(STAT_LABELS[key] || key) + " " + formatSigned(initialStats[key]) + "</span>")
      .join("");
    return '<div class="ssim-hero">' + itemIcon(equipment) +
      "<div><h3>" + esc(equipment.name) + "</h3>" +
      "<p>" + esc(equipment.subcategory || "裝備") +
      " · " + (stats.reqLevel ? "Lv." + fmt(stats.reqLevel) : "無等級限制") +
      " · " + esc(formatReqJob(stats.reqJob)) +
      " · 可強化 " + fmt(stats.tuc || 0) + " 次</p>" +
      (bonusRows ? '<div class="ssim-chip-line">' + bonusRows + "</div>" : "") +
      "</div></div>";
  }

  function detailIntro() {
    return renderEquipmentCard(selectedEquipment()) +
      '<p class="cm-empty">加入卷軸策略後按「開始計算」。理論值會依裝備價格、每張卷軸價格、成功率與破壞率計算；' +
      "混合多種卷軸時會自動搜尋最低平均成本的使用順序，每衝一張後重新判斷下一張，已不可能達標就直接停損重做。</p>";
  }

  function renderDistributionTable(exact) {
    return '<div class="db-table-wrap"><table class="db-table ssim-table">' +
      "<thead><tr><th>成功組合</th><th>達標完成</th><th>停損</th><th>途中破壞</th><th>達標機率</th></tr></thead><tbody>" +
      exact.distribution.map((row) =>
        "<tr><td>" + esc(row.label) + "</td><td>" + formatPercent(row.alive) + "</td><td>" +
        formatPercent(row.stopped || 0) + "</td><td>" + formatPercent(row.destroyed) + "</td><td>" +
        formatPercent(row.targetAlive) + "</td></tr>").join("") +
      "</tbody></table></div>";
  }

  function renderSimulationTables(sim) {
    if (!sim) {
      return '<p class="input-warning-hint">目標機率過低或無法達成，已略過隨機模擬；請降低目標或調整卷軸策略。</p>';
    }
    const successRows = [...sim.successDistribution.entries()]
      .sort((a, b) => {
        const totalA = parseSuccessKey(a[0]).reduce((sum, value) => sum + value, 0);
        const totalB = parseSuccessKey(b[0]).reduce((sum, value) => sum + value, 0);
        return totalA - totalB || a[0].localeCompare(b[0]);
      })
      .map(([key, count]) =>
        "<tr><td>" + esc(formatSuccessCounts(parseSuccessKey(key))) + "</td><td>" + fmt(count) + "</td><td>" +
        formatPercent(count / sim.completedTrials) + "</td></tr>")
      .join("");
    const gainRows = Object.entries(sim.averageGains)
      .sort((a, b) => {
        const ai = STAT_ORDER.indexOf(a[0]);
        const bi = STAT_ORDER.indexOf(b[0]);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(([key, value]) =>
        "<tr><td>" + esc(STAT_LABELS[key] || key) + "</td><td>" + formatSigned(Math.round(value * 100) / 100) + "</td></tr>")
      .join("");
    return '<div class="ssim-table-grid">' +
      '<div class="db-table-wrap"><h4>成功品分布</h4><table class="db-table ssim-table">' +
      "<thead><tr><th>成功組合</th><th>次數</th><th>比例</th></tr></thead><tbody>" + successRows + "</tbody></table></div>" +
      '<div class="db-table-wrap"><h4>成功品平均加成</h4><table class="db-table ssim-table">' +
      "<thead><tr><th>屬性</th><th>平均增加</th></tr></thead><tbody>" +
      (gainRows || '<tr><td colspan="2">沒有屬性加成</td></tr>') + "</tbody></table></div></div>";
  }

  function renderSamples(sim) {
    if (!sim || !sim.samples.length) return "";
    return '<div class="panel-head scroll-sub-head"><h3>模擬過程樣本</h3><span class="atk-head-note">前 ' +
      fmt(sim.samples.length) + " 次成功樣本</span></div>" +
      '<div class="ssim-samples">' +
      sim.samples.map((sample, sampleIndex) =>
        '<details class="cm-disclaimer-details ssim-sample"><summary>#' + fmt(sampleIndex + 1) + " · " +
        formatMeso(sample.totalCost) + " · 重做 " + fmt(sample.attemptCount) + " 輪</summary>" +
        '<div class="ssim-sample-body">' +
        sample.attempts.map((attempt, attemptIndex) =>
          "<article><strong>第 " + fmt(attemptIndex + 1) + " 輪：" +
          (attempt.destroyed ? "破壞" : attempt.achieved ? "達標" : attempt.stopped ? "停損" : "未達標") +
          " · " + formatMeso(attempt.cost) + "</strong><ol>" +
          attempt.steps.map((step) =>
            "<li>" + esc(step.scrollName) + "：" + esc(step.result) + "，累計 " +
            esc(formatSuccessCounts(step.successes, true)) + "</li>").join("") +
          "</ol></article>").join("") +
        (sample.truncated
          ? '<p class="cm-empty">此樣本重做 ' + fmt(sample.attemptCount) + " 輪，僅顯示前 " + fmt(sample.attempts.length) + " 輪明細。</p>"
          : "") +
        "</div></details>").join("") +
      "</div>";
  }

  function renderOptimizedStrategy(optimized, plan) {
    if (!plan.rows.length) return "";
    const firstAction = optimized.policy.actions.get(
      planStateKey(Array.from({ length: plan.rows.length }, () => 0), plan.initialRemaining)
    );
    const firstScroll = firstAction === undefined ? "" : (plan.rows[firstAction] && plan.rows[firstAction].scroll.name) || "";
    return '<div class="panel-head scroll-sub-head"><h3>推薦策略</h3><span class="atk-head-note">最低平均成本路徑</span></div>' +
      '<div class="ssim-policy">' +
      "<p>計算時已達標就停止；剩餘卷軸已不可能達成目標時直接停損重做。</p>" +
      (optimized.warning ? '<p class="input-warning-hint">' + esc(optimized.warning) + "</p>" : "") +
      (firstScroll ? '<p class="ssim-path"><strong>起手</strong><span>' + esc(firstScroll) + "</span></p>" : "") +
      optimized.paths.map((path) =>
        '<p class="ssim-path"><strong>' + esc(path.label) + "</strong><span>" +
        esc(compactPolicyPath(plan, path.steps)) +
        (path.achieved ? "，達標停止" : path.stopped ? "，停損重做" : "") + "</span></p>").join("") +
      "</div>";
  }

  function targetGainStats(plan) {
    const gains = {};
    for (const row of plan.rows) {
      const target = clampInteger(row.target, 0, row.count, 0);
      Object.entries(row.scroll.effects || {}).forEach(([key, value]) => {
        gains[key] = (gains[key] || 0) + Number(value || 0) * target;
      });
    }
    return gains;
  }

  function renderSuccessPreview(plan) {
    const equipment = selectedEquipment();
    if (!equipment || !plan.rows.length) return "";
    const initial = configuredInitialStats(equipment);
    const gains = targetGainStats(plan);
    const keys = STAT_ORDER.filter((key) => Number(initial[key]) || Number(gains[key]));
    if (!keys.length) return "";
    return '<div class="panel-head scroll-sub-head"><h3>成品屬性預覽</h3><span class="atk-head-note">依照目標成功張數</span></div>' +
      '<div class="ssim-preview-grid">' +
      keys.map((key) => {
        const start = Number(initial[key] || 0);
        const gain = Number(gains[key] || 0);
        const finalValue = start + gain;
        return '<div class="ssim-preview-cell"><span>' + esc(STAT_LABELS[key] || key) + "</span>" +
          "<strong>" + esc(formatSigned(finalValue)) + "</strong>" +
          "<em>初始 " + esc(formatSigned(start)) + (gain ? " / 卷軸 " + esc(formatSigned(gain)) : "") + "</em></div>";
      }).join("") + "</div>";
  }

  function runAndRender() {
    const equipment = selectedEquipment();
    if (!equipment) {
      els.detail.innerHTML = '<p class="cm-empty">請先選擇一件裝備</p>';
      return;
    }
    normalizeStrategyForEquipment();
    renderStrategy();
    const plan = buildStrategyPlan();
    const used = strategySlotCount();
    const slots = maxSlots();
    const equipmentPrice = moneyValue(els.equipPrice.value, 0);
    const trials = Math.max(100, Math.min(20000, integerValue(els.trials.value, 3000)));
    els.trials.value = String(trials);
    if (used > slots) {
      els.detail.innerHTML = renderEquipmentCard(equipment) +
        '<p class="input-warning-hint">卷軸張數超過裝備可強化次數，請先降低張數。</p>';
      return;
    }
    if (!plan.rows.length) {
      els.detail.innerHTML = renderEquipmentCard(equipment) + '<p class="cm-empty">請先加入至少一張卷軸</p>';
      return;
    }
    const targets = targetVector();
    const optimized = optimizeStrategyPlan(equipmentPrice, plan);
    const exact = optimized.exact;
    const sim = runMonteCarlo(equipmentPrice, plan, optimized.policy, trials, exact);
    els.detail.innerHTML =
      renderEquipmentCard(equipment) +
      '<div class="panel-head scroll-sub-head"><h3>成本摘要</h3><span class="atk-head-note">' +
      fmt(plan.totalCount) + " 張卷軸 · " + esc(formatTargetSummary(targets)) + "</span></div>" +
      '<div class="stat-grid ssim-stats-grid">' +
      '<div class="stat-card"><p class="stat-label">單輪達標機率</p><p class="stat-value">' + formatPercent(exact.targetProbability) + "</p></div>" +
      '<div class="stat-card"><p class="stat-label">理論期望總成本</p><p class="stat-value">' + formatMeso(exact.expectedCostPerTarget) + '</p><p class="stat-sub">重做到成功強化出一件</p></div>' +
      '<div class="stat-card"><p class="stat-label">單輪平均花費</p><p class="stat-value">' + formatMeso(exact.expectedCost) + '</p><p class="stat-sub">含停損與途中破壞</p></div>' +
      '<div class="stat-card"><p class="stat-label">破壞機率</p><p class="stat-value">' + formatPercent(exact.destroyedProb) + "</p></div>" +
      '<div class="stat-card"><p class="stat-label">停損機率</p><p class="stat-value">' + formatPercent(exact.stoppedProb) + '</p><p class="stat-sub">已不可能達標</p></div>' +
      '<div class="stat-card"><p class="stat-label">模擬平均總成本</p><p class="stat-value">' + (sim ? formatMeso(sim.averageCost) : "未模擬") + '</p><p class="stat-sub">' + (sim ? fmt(sim.completedTrials) + " 次成功樣本" : "目標機率過低") + "</p></div>" +
      '<div class="stat-card"><p class="stat-label">模擬中位數</p><p class="stat-value">' + (sim ? formatMeso(sim.medianCost) : "未模擬") + "</p></div>" +
      '<div class="stat-card"><p class="stat-label">模擬 P90</p><p class="stat-value">' + (sim ? formatMeso(sim.p90Cost) : "未模擬") + '</p><p class="stat-sub">約 90% 成功樣本不超過此成本</p></div>' +
      '<div class="stat-card"><p class="stat-label">模擬 P95</p><p class="stat-value">' + (sim ? formatMeso(sim.p95Cost) : "未模擬") + '</p><p class="stat-sub">約 95% 成功樣本不超過此成本</p></div>' +
      "</div>" +
      renderSuccessPreview(plan) +
      renderOptimizedStrategy(optimized, plan) +
      '<div class="panel-head scroll-sub-head"><h3>單輪結果分布</h3><span class="atk-head-note">理論值</span></div>' +
      renderDistributionTable(exact) +
      '<div class="panel-head scroll-sub-head"><h3>本地模擬分布</h3><span class="atk-head-note">' + fmt(trials) + " 次</span></div>" +
      renderSimulationTables(sim) +
      renderSamples(sim);
  }

  // ------------------------------------------------------------ 操作

  function addSelectedScroll() {
    const scroll = selectedScroll();
    const slotsLeft = availableSlots();
    if (!scroll || slotsLeft <= 0 || state.strategy.some((row) => Number(row.scrollId) === Number(scroll.id))) return;
    const count = clampInteger(els.addCount.value, 1, slotsLeft, 1);
    const target = clampInteger(els.addTarget.value, 0, count, Math.min(1, count));
    state.strategy.push({
      scrollId: Number(scroll.id),
      count,
      target,
      price: moneyValue(els.addPrice.value, 0),
    });
    renderScrollOptions();
    renderStrategy();
    updateCount();
  }

  function resetFilters() {
    state.equipmentQuery = "";
    state.equipmentGroup = "";
    state.equipmentPart = "";
    state.equipmentJob = "";
    state.equipmentLevelMin = "";
    state.equipmentLevelMax = "";
    state.scrollQuery = "";
    state.scrollSuccess = "";
    state.strategy = [];
    els.equipSearch.value = "";
    els.scrollSearch.value = "";
    els.addPrice.value = "";
    setPriceHint(els.addPriceHint, "");
    els.addCount.value = "1";
    els.addTarget.value = "1";
    els.equipPrice.value = "0";
    setPriceHint(els.equipPriceHint, "0");
    renderSelectors();
    els.detail.innerHTML = detailIntro();
  }

  function selectEquipmentById(value) {
    const id = Number(value);
    if (!Number.isFinite(id)) return;
    state.selectedEquipmentId = id;
    resetInitialStatsForEquipment();
    normalizeStrategyForEquipment();
    renderEquipmentOptions();
    renderScrollFilterOptions();
    renderScrollOptions();
    renderStrategy();
    updateCount();
    els.detail.innerHTML = detailIntro();
  }

  function selectScrollById(value) {
    const id = Number(value);
    if (!Number.isFinite(id)) return;
    state.selectedScrollId = id;
    renderScrollOptions();
  }

  function bindEvents() {
    els.reset.addEventListener("click", resetFilters);
    els.equipSearch.addEventListener("input", () => {
      state.equipmentQuery = els.equipSearch.value;
      renderSelectors();
    });
    els.equipGroup.addEventListener("change", (event) => {
      state.equipmentGroup = event.target.value;
      renderSelectors();
      els.detail.innerHTML = detailIntro();
    });
    els.equipPart.addEventListener("change", (event) => {
      state.equipmentPart = event.target.value;
      renderSelectors();
      els.detail.innerHTML = detailIntro();
    });
    els.equipJob.addEventListener("change", (event) => {
      state.equipmentJob = event.target.value;
      renderSelectors();
      els.detail.innerHTML = detailIntro();
    });
    // 打字途中不回寫 input.value：回寫會把游標推到最後，打第二個數字就
    // 接錯位置（跟 attack.js 的角色等級是同一種毛病）。只有真的含非數字
    // 字元時才需要清掉，那種情況游標本來就該跟著移動
    function handleLevelInput(key, input) {
      const cleaned = numericLevelText(input.value);
      state[key] = cleaned;
      if (input.value !== cleaned) input.value = cleaned;
      renderSelectors();
      els.detail.innerHTML = detailIntro();
    }
    els.equipLevelMin.addEventListener("input", (event) => handleLevelInput("equipmentLevelMin", event.target));
    els.equipLevelMax.addEventListener("input", (event) => handleLevelInput("equipmentLevelMax", event.target));
    els.scrollSearch.addEventListener("input", () => {
      state.scrollQuery = els.scrollSearch.value;
      renderScrollOptions();
      updateCount();
    });
    els.scrollSuccess.addEventListener("change", (event) => {
      state.scrollSuccess = event.target.value;
      renderScrollOptions();
      updateCount();
    });
    els.equipPicker.addEventListener("click", (event) => {
      const row = event.target.closest("[data-ssim-equip]");
      if (row) selectEquipmentById(row.dataset.ssimEquip);
    });
    els.initialStats.addEventListener("input", (event) => {
      if (!event.target.classList.contains("ssim-init-input")) return;
      const key = event.target.dataset.ssimInit;
      const equipment = selectedEquipment();
      if (!key || !equipment) return;
      const range = statInputRange(equipment, key);
      state.initialStats[key] = clampInteger(event.target.value, range.min, range.max, range.base);
      els.detail.innerHTML = detailIntro();
    });
    els.initialStats.addEventListener("change", (event) => {
      if (!event.target.classList.contains("ssim-init-input")) return;
      const key = event.target.dataset.ssimInit;
      const equipment = selectedEquipment();
      if (!key || !equipment) return;
      const range = statInputRange(equipment, key);
      event.target.value = String(clampInteger(state.initialStats[key], range.min, range.max, range.base));
    });
    els.initialStats.addEventListener("click", (event) => {
      if (event.target.id !== "ssimResetInitStats") return;
      resetInitialStatsForEquipment();
      renderInitialStatsPanel();
      els.detail.innerHTML = detailIntro();
    });
    els.scrollPicker.addEventListener("click", (event) => {
      const row = event.target.closest("[data-ssim-scroll]");
      if (row) selectScrollById(row.dataset.ssimScroll);
    });
    els.addScroll.addEventListener("click", addSelectedScroll);
    els.run.addEventListener("click", runAndRender);
    els.equipPrice.addEventListener("input", () => formatPriceInput(els.equipPrice, els.equipPriceHint));
    els.addPrice.addEventListener("input", () => formatPriceInput(els.addPrice, els.addPriceHint));
    els.addCount.addEventListener("input", updateAddButton);
    els.addTarget.addEventListener("input", () => {
      const slotsLeft = Math.max(1, availableSlots());
      const target = clampInteger(els.addTarget.value, 0, slotsLeft, 0);
      const count = clampInteger(els.addCount.value, 1, slotsLeft, 1);
      if (target > count) els.addCount.value = String(target);
      updateAddButton();
    });
    els.strategy.addEventListener("input", (event) => {
      const row = event.target.closest(".ssim-strategy-row");
      if (!row) return;
      const index = Number(row.dataset.ssimIndex);
      if (!state.strategy[index]) return;
      if (event.target.classList.contains("ssim-strat-count")) {
        const maxCount = Math.max(1, availableSlots(index));
        state.strategy[index].count = clampInteger(event.target.value, 1, maxCount, 1);
        state.strategy[index].target = clampInteger(
          state.strategy[index].target != null ? state.strategy[index].target : 0,
          0, state.strategy[index].count, 0);
        refreshStrategyControls();
      }
      if (event.target.classList.contains("ssim-strat-target")) {
        // 不回寫 value（打字中），夾好的值下面 change 監聽器會補寫
        state.strategy[index].target = clampInteger(event.target.value, 0, integerValue(state.strategy[index].count, 0), 0);
      }
      if (event.target.classList.contains("ssim-strat-price")) {
        state.strategy[index].price = formatPriceInput(event.target, row.querySelector(".ssim-price-hint"));
      }
    });
    // 失焦／Enter 才把夾好的值寫回輸入框
    els.strategy.addEventListener("change", (event) => {
      const row = event.target.closest(".ssim-strategy-row");
      if (!row) return;
      const entry = state.strategy[Number(row.dataset.ssimIndex)];
      if (!entry) return;
      if (event.target.classList.contains("ssim-strat-count")) event.target.value = String(entry.count);
      if (event.target.classList.contains("ssim-strat-target")) event.target.value = String(entry.target);
    });
    els.strategy.addEventListener("click", (event) => {
      const actionButton = event.target.closest(".ssim-strategy-actions button");
      if (!actionButton) return;
      const row = actionButton.closest(".ssim-strategy-row");
      if (!row) return;
      const index = Number(row.dataset.ssimIndex);
      if (actionButton.hasAttribute("data-ssim-remove")) state.strategy.splice(index, 1);
      if (actionButton.dataset.ssimMove === "up" && index > 0) {
        [state.strategy[index - 1], state.strategy[index]] = [state.strategy[index], state.strategy[index - 1]];
      }
      if (actionButton.dataset.ssimMove === "down" && index < state.strategy.length - 1) {
        [state.strategy[index + 1], state.strategy[index]] = [state.strategy[index], state.strategy[index + 1]];
      }
      renderScrollOptions();
      renderStrategy();
      updateCount();
    });
  }

  // ------------------------------------------------------------ 初始化

  function init() {
    els = {
      status: document.getElementById("ssimStatus"),
      body: document.getElementById("ssimBody"),
      count: document.getElementById("ssimCount"),
      reset: document.getElementById("ssimResetBtn"),
      equipSearch: document.getElementById("ssimEquipSearch"),
      equipGroup: document.getElementById("ssimEquipGroup"),
      equipPart: document.getElementById("ssimEquipPart"),
      equipJob: document.getElementById("ssimEquipJob"),
      equipLevelMin: document.getElementById("ssimEquipLevelMin"),
      equipLevelMax: document.getElementById("ssimEquipLevelMax"),
      equipPicker: document.getElementById("ssimEquipPicker"),
      initialStats: document.getElementById("ssimInitStats"),
      equipPrice: document.getElementById("ssimEquipPrice"),
      equipPriceHint: document.getElementById("ssimEquipPriceHint"),
      scrollSearch: document.getElementById("ssimScrollSearch"),
      scrollSuccess: document.getElementById("ssimScrollSuccess"),
      scrollPicker: document.getElementById("ssimScrollPicker"),
      addCount: document.getElementById("ssimAddCount"),
      addTarget: document.getElementById("ssimAddTarget"),
      addPrice: document.getElementById("ssimAddPrice"),
      addPriceHint: document.getElementById("ssimAddPriceHint"),
      addScroll: document.getElementById("ssimAddScroll"),
      strategy: document.getElementById("ssimStrategy"),
      trials: document.getElementById("ssimTrials"),
      run: document.getElementById("ssimRun"),
      detail: document.getElementById("ssimDetail"),
    };
    equipmentById = new Map((db.equipment || []).map((item) => [Number(item.id), item]));
    scrollById = new Map((db.scrolls || []).map((item) => [Number(item.id), item]));
    bindEvents();
    renderSelectors();
    els.detail.innerHTML = detailIntro();
    els.status.hidden = true;
    els.body.hidden = false;
  }

  function load() {
    if (loadPromise) return loadPromise;
    // 帶版本參數，理由同 db.js 的 verUrl（資料更新後不能讓瀏覽器吃舊快取）
    const ver = document.documentElement.dataset.assetVer;
    loadPromise = fetch("data/db/scroll_sim.json" + (ver ? "?v=" + ver : ""))
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        db = data;
        init();
      })
      .catch((err) => {
        console.error("[scroll] 卷軸模擬資料載入失敗", err);
        loadPromise = null;
        const status = document.getElementById("ssimStatus");
        if (status) status.textContent = "資料載入失敗，請重新整理頁面再試";
      });
    return loadPromise;
  }

  window.MapleScrollSim = { load };
})();
