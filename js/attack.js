/**
 * attack.js — 攻擊力計算機
 * -----------------------------------------------------------------
 * 計算邏輯完整對齊經典版拆包計算機（morris 版）：職業/武器/等級、
 * 素質點數預算、技能點數（轉職階段 SP 預算＋前置檢查）、精靈的祝福、
 * 隊伍技能 BUFF、道具 BUFF，輸出表攻範圍與各技能傷害。
 *
 * 資料在 data/db/damage_calc.json（約 1MB，gzip 後小很多），切到
 * 「攻擊力計算」子分頁才抓——初次載入由 nav.js 觸發（load()），跟
 * 資料庫頁同一套規矩，不要自己判斷「現在是不是在這一頁」。
 * -----------------------------------------------------------------
 */
(function () {
  const view = document.getElementById("calcAttackView");
  if (!view) return;

  // ------------------------------------------------------------ 常數
  // 武器係數與各種門檻值照拆包計算機原樣，不要「順手調整」——這組數字
  // 跟遊戲內顯示核對過
  const STAT_KEYS = ["str", "dex", "int", "luk"];
  const STAT_LABELS = { str: "力量", dex: "敏捷", int: "智力", luk: "幸運" };
  const MIN_CHARACTER_LEVEL = 1;
  // 等級上限跟資料庫的開放進度一致（tools/import_db.py 的 LEVEL_CAP）。
  // 四轉是 120 級開始，經典版還沒開到那裡，所以技能與等級都停在三轉區間
  const MAX_CHARACTER_LEVEL = 100;
  const DEFAULT_CHARACTER_LEVEL = 10;
  const MIN_BASE_STAT = 4;
  const LEVEL_ONE_BASE_STAT_POINTS = 25;
  const ZERO_ADVANCEMENT_SP = 6;
  // 四轉尚未開放，資料也被 tools/import_calc.py 的 MAX_ADVANCEMENT 擋掉了。
  // 開放時這裡要一起加回「四轉」，並把 MAX_CHARACTER_LEVEL 提高
  const ADVANCEMENT_ORDER = ["零轉", "一轉", "二轉", "三轉"];
  const JOB_REQUIREMENTS = {
    warrior: { level: 10, stats: { str: 35 } },
    magician: { level: 8, stats: { int: 20 } },
    bowman: { level: 10, stats: { dex: 25 } },
    thief: { level: 10, stats: { dex: 25 } },
    pirate_str: { level: 10, stats: { dex: 25 } },
    pirate_dex: { level: 10, stats: { dex: 25 } },
  };
  // 各職業的主屬性：預設配點會先滿足轉職需求，剩下的點全投主屬性。
  // 不寫死「450 STR」那種滿等範例值——預設等級是 10，點數根本不夠，
  // 寫死的值只會被預算夾回去，看起來像壞掉
  const MAIN_STAT_BY_JOB = {
    warrior: "str",
    magician: "int",
    bowman: "dex",
    thief: "luk",
    pirate_str: "str",
    pirate_dex: "dex",
  };
  const WEAPON_FORMULAS = {
    "單手劍": { max: 4.0, min: 4.0, main: "str", secondary: ["dex"], mastery: ["劍"] },
    "雙手劍": { max: 4.6, min: 4.6, main: "str", secondary: ["dex"], mastery: ["劍"] },
    "單手斧": { max: 4.4, min: 3.2, main: "str", secondary: ["dex"], mastery: ["斧"] },
    "雙手斧": { max: 4.8, min: 3.4, main: "str", secondary: ["dex"], mastery: ["斧"] },
    "單手棍": { max: 4.4, min: 3.2, main: "str", secondary: ["dex"], mastery: ["棍"] },
    "雙手棍": { max: 4.8, min: 3.4, main: "str", secondary: ["dex"], mastery: ["棍"] },
    "槍": { max: 5.0, min: 3.0, main: "str", secondary: ["dex"], mastery: ["槍"] },
    "矛": { max: 5.0, min: 3.0, main: "str", secondary: ["dex"], mastery: ["矛"] },
    "弓": { max: 3.4, min: 3.4, main: "dex", secondary: ["str"], mastery: ["弓"] },
    "弩": { max: 3.6, min: 3.6, main: "dex", secondary: ["str"], mastery: ["弩"] },
    "短刀": { max: 3.6, min: 3.6, main: "luk", secondary: ["str", "dex"], mastery: ["短刀", "刀"] },
    "拳套": { max: 3.6, min: 3.6, main: "luk", secondary: ["str", "dex"], mastery: ["拳套", "暗器"] },
    "指虎": { max: 4.8, min: 4.8, main: "str", secondary: ["dex"], mastery: ["指虎"] },
    "火槍": { max: 3.6, min: 3.6, main: "dex", secondary: ["str"], mastery: ["火槍", "槍法"] },
    "短杖": { max: 3.6, min: 3.6, main: "int", secondary: ["luk"], mastery: ["魔法"] },
    "長杖": { max: 3.6, min: 3.6, main: "int", secondary: ["luk"], mastery: ["魔法"] },
  };
  const SPECIAL_HIT_COUNTS = [
    [/雙飛斬/, 2],
    [/三飛閃/, 3],
    [/無雙劍舞/, 2],
    [/閃．連殺/, 6],
    [/海盜加農炮/, 4],
  ];

  const STORE_KEY = "maple_attack_calc_v1";

  let db = null;
  let loadPromise = null;
  let els = null;

  const state = {
    jobId: "",
    weaponType: "",
    characterLevel: DEFAULT_CHARACTER_LEVEL,
    spiritBlessingLevel: 0,
    skillTab: "零轉",
    skillLevels: {},
    activePartySkillBuffs: {},
    partySkillBuffLevels: {},
    selectedItemBuffs: new Set(),
  };

  // ------------------------------------------------------------ 小工具

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function fmt(value) {
    const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0;
    return number.toLocaleString("zh-TW");
  }

  function clampNumber(value, min, max, fallback = min) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function inputNumber(el, fallback = 0) {
    const value = Number(el && el.value || 0);
    return Number.isFinite(value) ? value : fallback;
  }

  // 使用者填的整份設定都留著，下次進站直接接續——這個計算機要填的欄位
  // 不少（配點＋技能點＋裝備數值），每次重來很煩。存的是「使用者的輸入」，
  // 不是計算結果，所以資料更新後照樣套得回去
  const NUMBER_FIELD_IDS = [
    "atkWeaponAtk", "atkEquipAtk", "atkWeaponMag", "atkEquipMag",
    "atkManualPad", "atkManualMad",
  ];

  function statFieldIds() {
    return STAT_KEYS.map((stat) => "atkBase" + stat.toUpperCase())
      .concat(STAT_KEYS.map((stat) => "atkEquip" + stat.toUpperCase()));
  }

  function saveState() {
    try {
      const fields = {};
      NUMBER_FIELD_IDS.concat(statFieldIds()).forEach((id) => {
        const el = document.getElementById(id);
        if (el) fields[id] = el.value;
      });
      const edited = {};
      STAT_KEYS.forEach((stat) => {
        const el = baseStatInput(stat);
        if (el && el.dataset.userEdited) edited[stat] = 1;
      });
      localStorage.setItem(STORE_KEY, JSON.stringify({
        jobId: state.jobId,
        weaponType: state.weaponType,
        characterLevel: state.characterLevel,
        spiritBlessingLevel: state.spiritBlessingLevel,
        skillTab: state.skillTab,
        skillLevels: state.skillLevels,
        activePartySkillBuffs: state.activePartySkillBuffs,
        partySkillBuffLevels: state.partySkillBuffLevels,
        selectedItemBuffs: [...state.selectedItemBuffs],
        fields,
        edited,
      }));
    } catch (e) { /* 隱私模式塞不進去就算了 */ }
  }

  // 只還原「跟畫面元素無關」的部分；欄位值要等 initFields 建好才填得進去，
  // 那部分交給 restoreFields()
  let savedSnapshot = null;

  function restoreState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      savedSnapshot = raw;
      if (raw.jobId) state.jobId = raw.jobId;
      if (raw.weaponType) state.weaponType = raw.weaponType;
      if (raw.characterLevel) state.characterLevel = raw.characterLevel;
      if (raw.spiritBlessingLevel) state.spiritBlessingLevel = raw.spiritBlessingLevel;
      if (raw.skillTab) state.skillTab = raw.skillTab;
      if (raw.skillLevels) state.skillLevels = { ...raw.skillLevels };
      if (raw.activePartySkillBuffs) state.activePartySkillBuffs = { ...raw.activePartySkillBuffs };
      if (raw.partySkillBuffLevels) state.partySkillBuffLevels = { ...raw.partySkillBuffLevels };
      if (Array.isArray(raw.selectedItemBuffs)) state.selectedItemBuffs = new Set(raw.selectedItemBuffs);
    } catch (e) { /* 壞紀錄照預設值 */ }
  }

  function restoreFields() {
    if (!savedSnapshot) return;
    const fields = savedSnapshot.fields || {};
    Object.keys(fields).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = fields[id];
    });
    // userEdited 也要復原，不然下次改等級會把使用者配好的點覆蓋掉
    Object.keys(savedSnapshot.edited || {}).forEach((stat) => {
      const el = baseStatInput(stat);
      if (el) el.dataset.userEdited = "1";
    });
  }

  // ------------------------------------------------------ 職業與技能查詢

  function skillById(skillId) {
    return (db.skills || []).find((skill) => Number(skill.id) === Number(skillId));
  }

  function currentJob() {
    return (db.jobs || []).find((job) => job.id === state.jobId) || (db.jobs || [])[0];
  }

  function jobSkills() {
    const job = currentJob();
    const ids = new Set([0, ...((job && job.jobIds) || []).map(Number)]);
    return (db.skills || []).filter((skill) => ids.has(Number(skill.jobId)));
  }

  function currentJobRequirement() {
    const job = currentJob();
    return JOB_REQUIREMENTS[(job && job.defaultStats) || "warrior"] || JOB_REQUIREMENTS.warrior;
  }

  function jobMinLevel() {
    return currentJobRequirement().level || MIN_CHARACTER_LEVEL;
  }

  function baseStatMinimum(stat) {
    return Math.max(MIN_BASE_STAT, Number(currentJobRequirement().stats[stat] || MIN_BASE_STAT));
  }

  function characterLevel() {
    return clampNumber(state.characterLevel, jobMinLevel(), MAX_CHARACTER_LEVEL, DEFAULT_CHARACTER_LEVEL);
  }

  /**
   * writeBack=false 時「只更新 state、不碰輸入框的值」。
   *
   * 打字途中一定要走這條：使用者想打 38，鍵入第一個字元時值是 3，夾到
   * 下限就變成 10 並寫回輸入框，游標跳到最後，第二個字元接在後面變成
   * 「103」——打什麼都會被吃掉，只剩上下箭頭能用。夾值要留到 change
   * （失焦／Enter）才做，見 setupEvents 裡的 change 監聽
   */
  function setCharacterLevel(value, persist, writeBack) {
    const minLevel = jobMinLevel();
    state.characterLevel = clampNumber(value, minLevel, MAX_CHARACTER_LEVEL, Math.max(DEFAULT_CHARACTER_LEVEL, minLevel));
    els.level.min = String(minLevel);
    // max 也由 JS 設，這樣調整 MAX_CHARACTER_LEVEL 時不用記得改 HTML
    els.level.max = String(MAX_CHARACTER_LEVEL);
    if (writeBack !== false) els.level.value = String(state.characterLevel);
    if (persist) saveState();
  }

  // -------------------------------------------------------- 精靈的祝福

  function spiritBlessingMaxLevel() {
    return Number((db.spiritBlessing && db.spiritBlessing.maxLevel) || 20);
  }

  function spiritBlessingLevel() {
    return clampNumber(state.spiritBlessingLevel, 0, spiritBlessingMaxLevel(), 0);
  }

  function setSpiritBlessingLevel(value, persist, writeBack) {
    state.spiritBlessingLevel = clampNumber(value, 0, spiritBlessingMaxLevel(), 0);
    els.spirit.max = String(spiritBlessingMaxLevel());
    if (writeBack !== false) els.spirit.value = String(state.spiritBlessingLevel);
    if (persist) saveState();
  }

  function spiritBlessingValues() {
    const skill = db.spiritBlessing;
    const level = spiritBlessingLevel();
    const row = ((skill && skill.levels) || []).find((item) => Number(item.level) === Number(level)) || null;
    const values = (row && row.values) || {};
    return {
      pad: Number(values.x || values.pad || 0),
      mad: Number(values.y || values.mad || 0),
    };
  }

  // ---------------------------------------------------- 轉職階段與 SP 預算

  function advancementStartLevel(advancement) {
    if (advancement === "零轉") return MIN_CHARACTER_LEVEL;
    if (advancement === "一轉") return jobMinLevel();
    if (advancement === "二轉") return 30;
    if (advancement === "三轉") return 70;
    return MIN_CHARACTER_LEVEL;
  }

  function advancementEndLevel(advancement) {
    if (advancement === "零轉") return jobMinLevel();
    if (advancement === "一轉") return 30;
    if (advancement === "二轉") return 70;
    return MAX_CHARACTER_LEVEL;
  }

  function skillBudget(advancement) {
    const level = characterLevel();
    if (advancement === "零轉") return Math.max(0, Math.min(ZERO_ADVANCEMENT_SP, level - 1));
    const start = advancementStartLevel(advancement);
    if (level < start) return 0;
    const cappedLevel = Math.min(level, advancementEndLevel(advancement));
    return 1 + Math.max(0, cappedLevel - start) * 3;
  }

  function skillAdvancement(skill) {
    if (Number(skill && skill.jobId) === 0) return "零轉";
    return (skill && skill.advancement) || "";
  }

  function advancementIndex(advancement) {
    return ADVANCEMENT_ORDER.indexOf(advancement);
  }

  function skillLevel(skillId) {
    return Math.max(0, Number(state.skillLevels[String(skillId)] || 0));
  }

  function skillBudgetUsed(advancement) {
    return jobSkills()
      .filter((skill) => skillAdvancement(skill) === advancement)
      .reduce((sum, skill) => sum + skillLevel(skill.id), 0);
  }

  function skillUsedThrough(stageIndex) {
    return jobSkills()
      .filter((skill) => {
        const index = advancementIndex(skillAdvancement(skill));
        return index >= 0 && index <= stageIndex;
      })
      .reduce((sum, skill) => sum + skillLevel(skill.id), 0);
  }

  function skillTotalUsed() {
    return jobSkills().reduce((sum, skill) => sum + skillLevel(skill.id), 0);
  }

  function skillBudgetThrough(stageIndex) {
    return ADVANCEMENT_ORDER
      .slice(0, Math.max(0, stageIndex) + 1)
      .reduce((sum, advancement) => sum + skillBudget(advancement), 0);
  }

  function totalSkillBudget() {
    return ADVANCEMENT_ORDER.reduce((sum, advancement) => sum + skillBudget(advancement), 0);
  }

  function previousAdvancementsComplete(stageIndex) {
    if (stageIndex <= 0) return true;
    return skillUsedThrough(stageIndex - 1) >= skillBudgetThrough(stageIndex - 1);
  }

  function skillGateReason(skill) {
    const advancement = skillAdvancement(skill);
    const stageIndex = advancementIndex(advancement);
    if (stageIndex < 0) return "";
    if (stageIndex > 0 && characterLevel() < advancementStartLevel(advancement)) return "等級不足";
    if (!previousAdvancementsComplete(stageIndex)) {
      const previous = ADVANCEMENT_ORDER[stageIndex - 1] || "";
      return "需先用盡" + previous + "點數";
    }
    return "";
  }

  // 可加到幾級：受「該階段還剩多少 SP」限制，不是總剩餘——一轉點滿 67/67
  // 之後就不該再拿二轉的點回頭加一轉技能（畫面上會看到一轉 68/67）
  function skillAssignableMax(skill) {
    const skillMax = Number((skill && skill.maxLevel) || 0);
    const current = skillLevel(skill && skill.id);
    if (skillMax <= 0) return 0;
    if (skillGateReason(skill)) return Math.min(skillMax, current);
    const advancement = skillAdvancement(skill);
    const stageLeft = Math.max(0, skillBudget(advancement) - skillBudgetUsed(advancement));
    return Math.max(0, Math.min(skillMax, current + stageLeft));
  }

  // 超出預算或階段被鎖時把點數收回來——優先從剛改動的那顆收，再從
  // 高轉職階段往回收
  function clampSkillLevelsToBudgets(changedSkillId = null) {
    const skills = jobSkills();
    const skillMap = new Map(skills.map((skill) => [String(skill.id), skill]));
    for (const key of Object.keys(state.skillLevels)) {
      const skill = skillMap.get(String(key));
      if (!skill) {
        delete state.skillLevels[key];
        continue;
      }
      state.skillLevels[key] = clampNumber(state.skillLevels[key], 0, Number(skill.maxLevel || 0), 0);
    }
    function reducePoints(candidates, amount) {
      const preferred = changedSkillId
        ? candidates.find((skill) => String(skill.id) === String(changedSkillId))
        : null;
      const ordered = [
        ...(preferred ? [preferred] : []),
        ...candidates
          .filter((skill) => !preferred || String(skill.id) !== String(preferred.id))
          .sort((a, b) =>
            advancementIndex(skillAdvancement(b)) - advancementIndex(skillAdvancement(a)) ||
            Number(b.id) - Number(a.id)),
      ];
      let remaining = amount;
      for (const skill of ordered) {
        const key = String(skill.id);
        const current = skillLevel(key);
        const reduceBy = Math.min(current, remaining);
        if (reduceBy > 0) {
          state.skillLevels[key] = current - reduceBy;
          remaining -= reduceBy;
        }
        if (remaining <= 0) break;
      }
    }

    const overBudget = skillTotalUsed() - totalSkillBudget();
    if (overBudget > 0) reducePoints(skills, overBudget);

    for (let index = 1; index < ADVANCEMENT_ORDER.length; index += 1) {
      if (previousAdvancementsComplete(index)) continue;
      const lockedSkills = skills.filter((skill) => advancementIndex(skillAdvancement(skill)) >= index);
      reducePoints(lockedSkills, skillTotalUsed());
    }
  }

  // ------------------------------------------------------ 素質點數預算

  function baseStatLimit() {
    return LEVEL_ONE_BASE_STAT_POINTS + Math.max(0, characterLevel() - 1) * 5;
  }

  function baseStatInput(stat) {
    return document.getElementById("atkBase" + stat.toUpperCase());
  }

  function baseStatValue(stat) {
    const minimum = baseStatMinimum(stat);
    return clampNumber(baseStatInput(stat) && baseStatInput(stat).value, minimum, 9999, minimum);
  }

  function baseStatSum() {
    return STAT_KEYS.reduce((sum, stat) => sum + baseStatValue(stat), 0);
  }

  function clampBaseStats(changedStat = null) {
    const limit = baseStatLimit();
    for (const stat of STAT_KEYS) {
      const input = baseStatInput(stat);
      if (!input) continue;
      input.min = String(baseStatMinimum(stat));
      // 正在打字的那一格不要回寫（理由同 setCharacterLevel）；打到一半的
      // 值可能低於下限，回寫會把使用者的輸入吃掉
      if (stat !== changedStat) input.value = String(baseStatValue(stat));
    }
    // 超出預算時，先從「使用者這次沒動的」欄位由大到小扣，剛輸入的那個
    // 留到最後才動——預設配點會把剩餘點全投主屬性、等於永遠吃滿預算，
    // 如果反過來夾使用者的輸入，加副屬性就會被彈回去，看起來像打不進去
    let sum = baseStatSum();
    if (sum > limit) {
      const ordered = [...STAT_KEYS]
        .filter((stat) => stat !== changedStat)
        .sort((a, b) => baseStatValue(b) - baseStatValue(a));
      if (changedStat && STAT_KEYS.includes(changedStat)) ordered.push(changedStat);
      for (const stat of ordered) {
        const input = baseStatInput(stat);
        if (!input) continue;
        const value = baseStatValue(stat);
        const removable = Math.max(0, value - baseStatMinimum(stat));
        const reduceBy = Math.min(removable, sum - limit);
        if (reduceBy > 0) {
          input.value = String(value - reduceBy);
          sum -= reduceBy;
        }
        if (sum <= limit) break;
      }
    }
    for (const stat of STAT_KEYS) {
      const input = baseStatInput(stat);
      if (!input) continue;
      const otherSum = STAT_KEYS
        .filter((key) => key !== stat)
        .reduce((sumValue, key) => sumValue + baseStatValue(key), 0);
      input.max = String(Math.max(baseStatMinimum(stat), limit - otherSum));
    }
    updateBaseStatBudget();
  }

  function updateBaseStatBudget() {
    const used = baseStatSum();
    const limit = baseStatLimit();
    const remaining = Math.max(0, limit - used);
    els.baseBudget.textContent =
      "素質點數 " + fmt(used) + " / " + fmt(limit) + "，剩餘 " + fmt(remaining) + " 點（照角色等級自動計算）";
  }

  function updateSpiritHint() {
    if (!db.spiritBlessing) {
      els.spiritHint.textContent = "未收錄精靈的祝福資料";
      return;
    }
    const values = spiritBlessingValues();
    els.spiritHint.textContent =
      "每 10 級 +1、最高 " + spiritBlessingMaxLevel() + " 級；目前攻擊力 +" + fmt(values.pad) +
      "、魔法攻擊力 +" + fmt(values.mad);
  }

  // ------------------------------------------------------ 技能數值解析

  function levelRow(skill, level) {
    return (skill.levels || []).find((row) => Number(row.level) === Number(level)) || null;
  }

  // 技能每級的數值大多在 values 裡，少數只寫在說明文字裡（例如部分精通
  // 技能的攻擊力加成），照拆包計算機的作法從文字補撈一次
  function parseLevelText(text) {
    const values = {};
    const source = String(text || "");
    const mastery = source.match(/熟練度\s*[+提升]*\s*(\d+)\s*%/);
    if (mastery) values.M = Number(mastery[1]);
    const attack = source.match(/物理攻擊力\s*(?:上升|增加|[+＋])\s*(\d+)/) ||
      source.match(/(?:^|[^魔法])攻擊力\s*(?:上升|增加|[+＋])\s*(\d+)/);
    if (attack) values.pad = Number(attack[1]);
    const magic = source.match(/(?:魔法攻擊力|魔力)\s*(?:上升|增加|[+＋])\s*(\d+)/);
    if (magic) values.mad = Number(magic[1]);
    const damage = source.match(/(?:殺傷力|傷害|攻擊力|最大攻擊力)\s*(?:提升|增加|[+＋])?\s*(\d+)\s*%/);
    if (damage) values.damage = values.damage || Number(damage[1]);
    return values;
  }

  function skillValues(skill, level) {
    const row = levelRow(skill, level);
    return { ...((row && row.values) || {}), ...parseLevelText(row && row.description) };
  }

  function selectedSkillValues(skill) {
    return skillValues(skill, skillLevel(skill.id));
  }

  // ------------------------------------------------------------ BUFF

  function partyBuffById(buffId) {
    return (db.partySkillBuffs || []).find((buff) => String(buff.id) === String(buffId));
  }

  function partyBuffLevel(buff) {
    const key = String(buff.id);
    const fallback = Number(buff.maxLevel || 0);
    const stored = Object.prototype.hasOwnProperty.call(state.partySkillBuffLevels, key)
      ? Number(state.partySkillBuffLevels[key])
      : fallback;
    return Math.max(0, Math.min(fallback, Number.isFinite(stored) ? stored : fallback));
  }

  function partyBuffValues(buff) {
    const level = partyBuffLevel(buff);
    const row = (buff.levels || []).find((item) => Number(item.level) === Number(level)) || null;
    return (row && row.effects) || {};
  }

  // 同種加成不疊加、取最高的那個來源（跟遊戲內 BUFF 覆蓋規則一致）
  function improveBuffTotals(totals, effects, source) {
    for (const key of ["pad", "mad", "padPercent", "madPercent", "statPercent"]) {
      const value = Number((effects && effects[key]) || 0);
      if (value > Number(totals[key] || 0)) {
        totals[key] = value;
        totals.sources[key] = source;
      }
    }
  }

  function getBuffTotals() {
    const totals = { pad: 0, mad: 0, padPercent: 0, madPercent: 0, statPercent: 0, sources: {} };
    improveBuffTotals(totals, { pad: inputNumber(els.manualPad) }, "手動攻擊力");
    improveBuffTotals(totals, { mad: inputNumber(els.manualMad) }, "手動魔法攻擊力");
    for (const buff of db.partySkillBuffs || []) {
      if (!state.activePartySkillBuffs[String(buff.id)]) continue;
      improveBuffTotals(totals, partyBuffValues(buff), buff.name);
    }
    for (const buffId of state.selectedItemBuffs) {
      const buff = (db.itemBuffs || []).find((row) => String(row.id) === String(buffId));
      if (!buff) continue;
      improveBuffTotals(totals, buff.effects, buff.name);
    }
    return totals;
  }

  function percentBuffAmount(baseValue, buff, percentKey) {
    const percent = Number((buff && buff[percentKey]) || 0);
    return Math.floor(Math.max(0, Number(baseValue) || 0) * percent / 100);
  }

  function getStatTotals() {
    const baseTotals = { str: 0, dex: 0, int: 0, luk: 0 };
    const addedTotals = { str: 0, dex: 0, int: 0, luk: 0 };
    const totals = { str: 0, dex: 0, int: 0, luk: 0 };
    for (const stat of STAT_KEYS) {
      baseTotals[stat] = inputNumber(baseStatInput(stat));
      addedTotals[stat] = inputNumber(document.getElementById("atkEquip" + stat.toUpperCase()));
      totals[stat] = baseTotals[stat] + addedTotals[stat];
    }
    const buff = getBuffTotals();
    const mapleWarrior = buff.statPercent || 0;
    if (mapleWarrior > 0) {
      for (const stat of STAT_KEYS) totals[stat] += Math.floor(baseTotals[stat] * mapleWarrior / 100);
    }
    return { totals, baseTotals, addedTotals, buff };
  }

  // ---------------------------------------------------- 熟練度與被動加成

  function isWeaponMatch(skill, weaponType) {
    const formula = WEAPON_FORMULAS[weaponType];
    if (!formula) return false;
    const haystack = (skill.name || "") + " " + (skill.description || "") + " " + (skill.formula || "");
    return formula.mastery.some((token) => haystack.includes(token));
  }

  function getPassiveSkillAttackBonus(weaponType) {
    let pad = 0;
    let mad = 0;
    for (const skill of jobSkills()) {
      const level = skillLevel(skill.id);
      if (!level) continue;
      const values = selectedSkillValues(skill);
      if (!isWeaponMatch(skill, weaponType)) continue;
      if (values.pad && /精通|熟練/.test(skill.name + " " + skill.description)) pad += Number(values.pad);
      if (values.mad && /精通|熟練/.test(skill.name + " " + skill.description)) mad += Number(values.mad);
    }
    return { pad, mad };
  }

  function getMastery(weaponType) {
    let mastery = 0.1;
    let source = "基礎 10%";
    let additive = 0;
    for (const skill of jobSkills()) {
      const level = skillLevel(skill.id);
      if (!level) continue;
      const values = selectedSkillValues(skill);
      if (!values.M) continue;
      // 暗之靈魂是加算在其他精通上的特例
      if ((skill.name || "").includes("暗之靈魂")) {
        additive = Math.max(additive, Number(values.M) / 100);
        continue;
      }
      if (!isWeaponMatch(skill, weaponType)) continue;
      const value = Number(values.M) / 100;
      if (value > mastery) {
        mastery = value;
        source = skill.name + " " + values.M + "%";
      }
    }
    if (additive) {
      mastery = Math.min(0.95, mastery + additive);
      source += " + 暗之靈魂 " + Math.round(additive * 100) + "%";
    }
    return { mastery, source };
  }

  // ------------------------------------------------------------ 表攻計算

  function getAttackRange() {
    const job = currentJob();
    const weaponType = state.weaponType || (job && job.weapons && job.weapons[0]) || "";
    const formula = WEAPON_FORMULAS[weaponType] || WEAPON_FORMULAS["單手劍"];
    const { totals, baseTotals, addedTotals, buff } = getStatTotals();
    const passive = getPassiveSkillAttackBonus(weaponType);
    const spirit = spiritBlessingValues();
    const attackBase = inputNumber(els.weaponAtk) + inputNumber(els.equipAtk) + passive.pad + spirit.pad;
    const magicAttackBase = inputNumber(els.weaponMag) + inputNumber(els.equipMag) + passive.mad + spirit.mad;
    const echoMagicBase = baseTotals.int + addedTotals.int + magicAttackBase;
    const attack = attackBase + Number(buff.pad || 0) + percentBuffAmount(attackBase, buff, "padPercent");
    const magicAttack = Math.floor(
      totals.int + magicAttackBase + Number(buff.mad || 0) + percentBuffAmount(echoMagicBase, buff, "madPercent")
    );
    const secondary = (formula.secondary || []).reduce((sum, key) => sum + totals[key], 0);
    const { mastery, source } = getMastery(weaponType);
    const max = Math.floor((totals[formula.main] * formula.max + secondary) * attack / 100);
    const min = Math.floor((totals[formula.main] * formula.min * 0.9 * mastery + secondary) * attack / 100);
    return {
      job,
      weaponType,
      formula,
      stats: totals,
      attack,
      magicAttack,
      mastery,
      masterySource: source,
      min: Math.max(0, min),
      max: Math.max(0, max),
    };
  }

  // ------------------------------------------------------------ 技能傷害

  function isCriticalPassiveSkill(skill) {
    const name = (skill && skill.name) || "";
    if (/強力投擲|霸王箭|致命箭|致命暗襲/.test(name)) return true;
    const text = name + " " + ((skill && skill.description) || "") + " " + ((skill && skill.formula) || "");
    return /(爆擊|暴擊|臨界|致命一擊|出現比率)/.test(text) && !/消耗\s*(?:HP|MP|HP、MP|MP、HP)/.test(text);
  }

  function isDamageSkill(skill) {
    if (isCriticalPassiveSkill(skill)) return false;
    return (skill.levels || []).some((row) => {
      const values = { ...(row.values || {}), ...parseLevelText(row.description || "") };
      return values.damage || values.mad || values.z;
    });
  }

  function hitCount(skill, values) {
    for (const [pattern, count] of SPECIAL_HIT_COUNTS) {
      if (pattern.test(skill.name || "")) return count;
    }
    if (values.bulletCount) return Number(values.bulletCount);
    if ((skill.name || "").includes("龍魂之箭")) return 1;
    if ((skill.name || "").includes("魔力爪")) return 2;
    if ((skill.name || "").includes("二連箭")) return 2;
    return 1;
  }

  function physicalSkillDamage(skill, values, range) {
    const percent = Number(values.damage || values.z || 100);
    const hits = hitCount(skill, values);
    if (/雙飛斬|三飛閃/.test(skill.name || "")) {
      const luk = range.stats.luk;
      const max = Math.floor((luk * 5.0) * range.attack / 100 * percent / 100);
      const min = Math.floor((luk * 2.5) * range.attack / 100 * percent / 100);
      return { min, max, hits, percent, note: "投擲公式：每段 floor(幸運 × 2.5~5.0 × 攻擊力 ÷ 100 × 技能% ÷ 100)" };
    }
    return {
      min: Math.floor(range.min * percent / 100),
      max: Math.floor(range.max * percent / 100),
      hits,
      percent,
      note: "",
    };
  }

  function magicSkillDamage(skill, values, range) {
    const basic = Number(values.mad || 0);
    const mastery = Number(values.M || 60) / 100;
    const magic = range.magicAttack;
    const intValue = range.stats.int;
    const max = Math.floor(((magic * magic / 1000 + magic) / 30 + intValue / 200) * basic);
    const min = Math.floor(((magic * magic / 1000 + magic * mastery * 0.9) / 30 + intValue / 200) * basic);
    return { min, max, hits: hitCount(skill, values), percent: basic, note: "魔法基本攻擊力" };
  }

  function skillDamage(skill, range) {
    const level = skillLevel(skill.id);
    if (!level) return null;
    const values = selectedSkillValues(skill);
    if (!values.damage && !values.z && !values.mad) return null;
    const job = currentJob();
    return job.kind === "magic"
      ? magicSkillDamage(skill, values, range)
      : physicalSkillDamage(skill, values, range);
  }

  function prerequisiteWarnings(skill) {
    const warnings = [];
    for (const req of skill.prerequisites || []) {
      const level = skillLevel(req.skillId);
      if (level < Number(req.level || 0)) {
        warnings.push(req.skillName + " 需要 " + req.level + " 級");
      }
    }
    return warnings;
  }

  // ------------------------------------------------------------ 渲染

  function availableSkillAdvancements() {
    return ADVANCEMENT_ORDER.filter((advancement) =>
      jobSkills().some((skill) => skillAdvancement(skill) === advancement));
  }

  function ensureSkillTab() {
    const available = availableSkillAdvancements();
    if (!available.includes(state.skillTab)) state.skillTab = available[0] || "零轉";
    return state.skillTab;
  }

  // 這一階段的 SP 剛好用完，就自動翻到下一個還有點數可用的階段——點完
  // 零轉還停在零轉分頁，使用者得自己想到要按一轉，是多餘的一步
  function advanceSkillTabIfDone() {
    const available = availableSkillAdvancements();
    const current = ensureSkillTab();
    const budget = skillBudget(current);
    if (!budget || skillBudgetUsed(current) < budget) return;
    const next = available
      .slice(available.indexOf(current) + 1)
      .find((adv) => skillBudget(adv) > skillBudgetUsed(adv));
    if (next) state.skillTab = next;
  }

  function renderSkillBudget() {
    els.skillBudget.innerHTML = availableSkillAdvancements().map((advancement) => {
      const used = skillBudgetUsed(advancement);
      const budget = skillBudget(advancement);
      return '<span class="atk-pill' + (budget ? "" : " atk-pill--empty") + '">' +
        esc(advancement) + " " + fmt(used) + " / " + fmt(budget) + "</span>";
    }).join("");
  }

  // 轉職階段用資料庫頁那組膠囊晶片（.db-chip），跟站上其他快速篩選一致，
  // 不要用側邊欄的 .subtab——那組是為深色側欄設計的，放在白底內容區很突兀
  function renderSkillTabs() {
    const activeTab = ensureSkillTab();
    els.skillTabs.innerHTML = availableSkillAdvancements().map((advancement) => {
      const active = advancement === activeTab;
      return '<button class="db-chip' + (active ? " db-chip--on" : "") + '" type="button" role="tab" ' +
        'aria-selected="' + active + '" data-atk-skill-tab="' + esc(advancement) + '">' +
        esc(advancement) + "</button>";
    }).join("");
  }

  function skillImg(skill) {
    return skill.image
      ? '<img class="atk-skill-icon" src="' + esc(skill.image) + '" alt="" loading="lazy" width="32" height="32">'
      : '<span class="atk-skill-icon atk-skill-icon--empty"></span>';
  }

  function renderSkillList() {
    clampSkillLevelsToBudgets();
    renderSkillBudget();
    renderSkillTabs();
    const activeTab = ensureSkillTab();
    const rows = jobSkills().filter((skill) => skillAdvancement(skill) === activeTab);
    els.skillList.innerHTML = rows.map((skill) => {
      const level = skillLevel(skill.id);
      const warnings = level ? prerequisiteWarnings(skill) : [];
      const maxAllowed = skillAssignableMax(skill);
      const gateReason = skillGateReason(skill);
      const isLocked = (Boolean(gateReason) || maxAllowed <= 0) && level <= 0;
      return '<div class="atk-skill-row' + (isLocked ? " atk-skill-row--locked" : "") + '">' +
        skillImg(skill) +
        '<span class="atk-skill-name"><strong>' + esc(skill.name) + "</strong>" +
        "<small>" + level + "/" + (skill.maxLevel || 0) + (gateReason ? " · " + esc(gateReason) : "") + "</small></span>" +
        '<span class="atk-skill-ctrl">' +
        '<input data-atk-skill-level="' + esc(skill.id) + '" type="number" min="0" max="' + maxAllowed +
        '" step="1" value="' + level + '" inputmode="numeric" autocomplete="off" aria-label="' + esc(skill.name) + ' 技能等級"' +
        (isLocked ? " disabled" : "") + ">" +
        '<button class="btn btn-ghost atk-max-btn" type="button" data-atk-skill-max="' + esc(skill.id) + '"' +
        (maxAllowed <= level ? " disabled" : "") + ">MAX</button></span>" +
        (warnings.length ? '<em class="atk-warning">' + esc(warnings.join("、")) + "</em>" : "") +
        "</div>";
    }).join("") || '<p class="cm-empty">此階段沒有技能</p>';
  }

  function formatBuffEffects(effects) {
    const parts = [];
    if (effects && effects.pad) parts.push("攻擊力 +" + effects.pad);
    if (effects && effects.mad) parts.push("魔法攻擊力 +" + effects.mad);
    if (effects && effects.padPercent) parts.push("攻擊力 +" + effects.padPercent + "%");
    if (effects && effects.madPercent) parts.push("魔法攻擊力 +" + effects.madPercent + "%");
    if (effects && effects.statPercent) parts.push("全屬性 +" + effects.statPercent + "%");
    return parts.join(" · ") || "BUFF";
  }

  function renderPartyBuffs() {
    els.partyBuffs.innerHTML = (db.partySkillBuffs || []).map((buff) => {
      const isChecked = Boolean(state.activePartySkillBuffs[String(buff.id)]);
      const level = partyBuffLevel(buff);
      const effects = partyBuffValues(buff);
      return '<div class="atk-buff-row' + (isChecked ? " atk-buff-row--active" : "") + '">' +
        '<input id="atkPartyBuff' + esc(buff.id) + '" data-atk-party-buff="' + esc(buff.id) + '" type="checkbox"' +
        (isChecked ? " checked" : "") + ">" +
        (buff.image ? '<img class="atk-skill-icon" src="' + esc(buff.image) + '" alt="" loading="lazy" width="32" height="32">' : "") +
        '<label class="atk-buff-info" for="atkPartyBuff' + esc(buff.id) + '"><strong>' + esc(buff.name) + "</strong>" +
        "<small>" + esc(buff.source || "隊伍技能 BUFF") + " · " + esc(formatBuffEffects(effects)) + "</small></label>" +
        '<label class="atk-buff-level"><span>等級</span>' +
        '<input data-atk-party-buff-level="' + esc(buff.id) + '" type="number" min="0" max="' + esc(buff.maxLevel || 0) +
        '" step="1" value="' + esc(level) + '" inputmode="numeric" autocomplete="off" aria-label="' + esc(buff.name) + ' 等級"></label>' +
        "</div>";
    }).join("") || '<p class="cm-empty">目前沒有可啟用的技能 BUFF</p>';
  }

  function renderItemBuffSearch() {
    const query = (els.itemBuffSearch.value || "").trim().toLowerCase();
    const rows = (db.itemBuffs || [])
      .filter((buff) => !state.selectedItemBuffs.has(String(buff.id)))
      .filter((buff) => {
        if (!query) return true;
        return (buff.id + " " + buff.name + " " + buff.desc).toLowerCase().includes(query);
      })
      .slice(0, 18);
    els.itemBuffResults.innerHTML = rows.map((buff) =>
      '<button class="atk-buff-row atk-buff-row--btn" type="button" data-atk-add-buff="' + esc(buff.id) + '">' +
      (buff.image ? '<img class="atk-skill-icon" src="' + esc(buff.image) + '" alt="" loading="lazy" width="32" height="32">' : "") +
      '<span class="atk-buff-info"><strong>' + esc(buff.name) + "</strong><small>" +
      esc(formatBuffEffects(buff.effects)) + "</small></span>" +
      '<span class="atk-pill">加入</span></button>'
    ).join("") || '<p class="cm-empty">找不到道具 BUFF</p>';
  }

  function renderSelectedItemBuffs() {
    els.itemBuffSelected.innerHTML = [...state.selectedItemBuffs].map((id) => {
      const buff = (db.itemBuffs || []).find((row) => String(row.id) === String(id));
      if (!buff) return "";
      return '<span class="atk-selected-buff">' + esc(buff.name) + " · " + esc(formatBuffEffects(buff.effects)) +
        '<button type="button" data-atk-remove-buff="' + esc(buff.id) + '" aria-label="移除 ' + esc(buff.name) + '">✕</button></span>';
    }).join("");
  }

  function renderSkillDamageCard(skill, result) {
    const totalMin = result.min * result.hits;
    const totalMax = result.max * result.hits;
    return '<div class="atk-dmg-card">' +
      skillImg(skill) +
      "<div><strong>" + esc(skill.name) + "</strong><p>Lv." + skillLevel(skill.id) + "</p>" +
      '<div class="atk-dmg-nums">' +
      '<span class="atk-pill">單段 ' + fmt(result.min) + " ~ " + fmt(result.max) + "</span>" +
      (result.hits > 1 ? '<span class="atk-pill">' + result.hits + " 段合計 " + fmt(totalMin) + " ~ " + fmt(totalMax) + "</span>" : "") +
      '<span class="atk-pill">' + esc(result.note || result.percent + "%") + "</span>" +
      "</div></div></div>";
  }

  function renderDetail() {
    const job = currentJob();
    const range = getAttackRange();
    const damageSkills = jobSkills().filter(isDamageSkill);
    const activeDamageRows = damageSkills
      .map((skill) => ({ skill, result: skillDamage(skill, range) }))
      .filter((row) => row.result);
    const formula = WEAPON_FORMULAS[state.weaponType] || {};
    const isMagic = job && job.kind === "magic";
    const attackCards = isMagic
      ? '<div class="stat-card"><p class="stat-label">魔法攻擊力</p><p class="stat-value">' + fmt(range.magicAttack) + "</p></div>"
      : '<div class="stat-card"><p class="stat-label">最小攻擊力</p><p class="stat-value">' + fmt(range.min) + "</p></div>" +
        '<div class="stat-card"><p class="stat-label">最大攻擊力</p><p class="stat-value">' + fmt(range.max) + "</p></div>";
    els.detail.innerHTML =
      '<div class="atk-hero">' +
      (job && job.image ? '<img class="atk-hero-img" src="' + esc(job.image) + '" alt="" loading="lazy">' : "") +
      "<div><h3>" + esc((job && job.name) || "") + "</h3>" +
      "<p>Lv." + characterLevel() + " · " + esc(state.weaponType) + " · 熟練度 " + Math.round(range.mastery * 100) + "% · " +
      esc(range.masterySource) + "</p></div></div>" +
      '<div class="stat-grid">' + attackCards + "</div>" +
      (isMagic
        ? ""
        : '<div class="atk-formula-note"><p>最大 = floor((主屬性 × ' + (formula.max || "-") + " + 副屬性) × 攻擊力 ÷ 100)</p>" +
          "<p>最小 = floor((主屬性 × " + (formula.min || "-") + " × 0.9 × 熟練度 + 副屬性) × 攻擊力 ÷ 100)</p></div>") +
      '<div class="panel-head scroll-sub-head"><h3>技能傷害</h3><span class="atk-head-note">' +
      fmt(activeDamageRows.length) + " 個技能已設定點數</span></div>" +
      ('<div class="atk-dmg-grid">' +
        (activeDamageRows.map((row) => renderSkillDamageCard(row.skill, row.result)).join("") ||
          '<p class="cm-empty">設定技能點數後會顯示技能傷害（理論值，未計入怪物防禦與屬性相剋）</p>') +
        "</div>");
  }

  function renderAll() {
    updateBaseStatBudget();
    updateSpiritHint();
    renderSkillList();
    renderPartyBuffs();
    renderItemBuffSearch();
    renderSelectedItemBuffs();
    renderDetail();
  }

  /**
   * 打字途中用的輕量重繪：更新數字，但**不重建技能列表與 BUFF 列表**。
   *
   * 那兩塊是整段 innerHTML 換掉的，重建等於把使用者正在打字的 <input>
   * 換成新元素——焦點與游標位置一起消失，變成打一個字就跳出輸入框。
   * 列表的鎖定狀態、MAX 鈕啟用與否留到 change（失焦／Enter）再更新
   */
  function renderLive() {
    clampSkillLevelsToBudgets();
    updateBaseStatBudget();
    updateSpiritHint();
    renderSkillBudget();
    renderDetail();
  }

  // ------------------------------------------------------------ 初始化

  function initFields() {
    els.baseStats.innerHTML = "";
    els.equipStats.innerHTML = "";
    for (const stat of STAT_KEYS) {
      const base = document.createElement("label");
      base.className = "field";
      base.innerHTML = "<span>" + STAT_LABELS[stat] + " " + stat.toUpperCase() + "</span>" +
        '<input id="atkBase' + stat.toUpperCase() + '" type="number" min="' + MIN_BASE_STAT +
        '" step="1" inputmode="numeric" autocomplete="off">';
      els.baseStats.append(base);
      const equip = document.createElement("label");
      equip.className = "field";
      equip.innerHTML = "<span>" + STAT_LABELS[stat] + " " + stat.toUpperCase() + "</span>" +
        '<input id="atkEquip' + stat.toUpperCase() + '" type="number" step="1" inputmode="numeric" value="0" autocomplete="off">';
      els.equipStats.append(equip);
    }
  }

  function initJobs() {
    els.job.innerHTML = (db.jobs || []).map((job) =>
      '<option value="' + esc(job.id) + '">' + esc(job.name) + "</option>").join("");
    state.jobId = ((db.jobs || [])[0] || {}).id || "";
    restoreState();
    if (!(db.jobs || []).some((job) => job.id === state.jobId)) {
      state.jobId = ((db.jobs || [])[0] || {}).id || "";
    }
    els.job.value = state.jobId;
    setCharacterLevel(state.characterLevel, false);
  }

  // 預設配點：各屬性先給轉職需求的最低值，剩下的點全投主屬性——照等級
  // 動態算，換職業或改等級都不會出現「填了預算裝不下的數字」
  function applyJobDefaults() {
    const job = currentJob();
    const mainStat = MAIN_STAT_BY_JOB[(job && job.defaultStats) || "warrior"] || "str";
    const minimums = {};
    STAT_KEYS.forEach((stat) => { minimums[stat] = baseStatMinimum(stat); });
    const spare = Math.max(
      0,
      baseStatLimit() - STAT_KEYS.reduce((sum, stat) => sum + minimums[stat], 0)
    );
    for (const stat of STAT_KEYS) {
      const input = baseStatInput(stat);
      if (input && !input.dataset.userEdited) {
        input.value = minimums[stat] + (stat === mainStat ? spare : 0);
      }
    }
    clampBaseStats();
    renderWeaponOptions();
  }

  function renderWeaponOptions() {
    const job = currentJob();
    const options = (job && job.weapons) || Object.keys(WEAPON_FORMULAS);
    const previous = state.weaponType;
    state.weaponType = options.includes(previous) ? previous : options[0];
    els.weapon.innerHTML = options.map((type) =>
      '<option value="' + esc(type) + '">' + esc(type) + "</option>").join("");
    els.weapon.value = state.weaponType;
    saveState();
  }

  function clearAll() {
    const job = currentJob();
    setCharacterLevel(DEFAULT_CHARACTER_LEVEL, true);
    state.skillLevels = {};
    state.activePartySkillBuffs = {};
    state.partySkillBuffLevels = {};
    state.selectedItemBuffs.clear();
    setSpiritBlessingLevel(0, true);
    els.itemBuffSearch.value = "";
    els.weaponAtk.value = job && job.kind === "magic" ? 30 : 80;
    els.weaponMag.value = job && job.kind === "magic" ? 90 : 0;
    els.equipAtk.value = "0";
    els.equipMag.value = "0";
    els.manualPad.value = "0";
    els.manualMad.value = "0";
    for (const stat of STAT_KEYS) {
      const base = baseStatInput(stat);
      const equip = document.getElementById("atkEquip" + stat.toUpperCase());
      if (base) base.dataset.userEdited = "";
      if (equip) equip.value = "0";
    }
    applyJobDefaults();
    clampSkillLevelsToBudgets();
    saveState();
    renderAll();
  }

  function setupEvents() {
    els.reset.addEventListener("click", clearAll);
    els.skillReset.addEventListener("click", () => {
      state.skillLevels = {};
      clampSkillLevelsToBudgets();
      saveState();
      renderAll();
    });
    els.job.addEventListener("change", () => {
      state.jobId = els.job.value;
      state.skillLevels = {};
      state.skillTab = "零轉";
      saveState();
      setCharacterLevel(state.characterLevel, true);
      applyJobDefaults();
      clampSkillLevelsToBudgets();
      renderAll();
    });
    els.weapon.addEventListener("change", () => {
      state.weaponType = els.weapon.value;
      saveState();
      renderAll();
    });
    view.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      // checkbox 交給下面的 change 監聽器處理。checkbox 點擊會先發 input
      // 再發 change，這裡先 renderAll 的話 DOM 已重建，change 事件冒泡不
      // 上來，勾選就永遠存不進 state
      if (target.type === "checkbox") return;
      if (target === els.level) {
        // writeBack=false：打字途中不回寫輸入框（見 setCharacterLevel 註解）
        setCharacterLevel(target.value, true, false);
        // 還沒手動配過點的欄位，跟著新等級重算預設配點（applyJobDefaults
        // 內部會跳過 userEdited 的欄位）——不然改完等級會看到一堆
        // 「剩餘 450 點」沒地方去
        applyJobDefaults();
        renderLive();
        return;
      }
      if (target === els.spirit) {
        setSpiritBlessingLevel(target.value, true, false);
        renderLive();
        return;
      }
      if (target === els.itemBuffSearch) {
        renderItemBuffSearch();
        return;
      }
      if (target.id.startsWith("atkBase")) {
        target.dataset.userEdited = "1";
        const stat = STAT_KEYS.find((key) => target.id === "atkBase" + key.toUpperCase());
        clampBaseStats(stat);
        renderLive();
        return;
      }
      const skillId = target.dataset.atkSkillLevel;
      if (skillId) {
        const skill = skillById(skillId);
        const max = skillAssignableMax(skill);
        state.skillLevels[String(skillId)] = Math.max(0, Math.min(max, Number(target.value || 0)));
        saveState();
        renderLive();
        return;
      }
      const partyBuffId = target.dataset.atkPartyBuffLevel;
      if (partyBuffId) {
        const buff = partyBuffById(partyBuffId);
        const max = Number((buff && buff.maxLevel) || 0);
        state.partySkillBuffLevels[String(partyBuffId)] = Math.max(0, Math.min(max, Number(target.value || 0)));
        saveState();
        renderLive();
        return;
      }
      // 武器攻擊力、裝備加成那些純數字欄位：不需要重建任何列表
      saveState();
      renderLive();
    });
    // change（失焦／Enter）才把值規範化並整個重繪——列表重建會換掉 DOM，
    // 放在這裡才不會打斷打字
    view.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const partySkillBuff = target.dataset.atkPartyBuff;
      if (partySkillBuff) {
        state.activePartySkillBuffs[String(partySkillBuff)] = target.checked;
        saveState();
        renderAll();
        return;
      }
      if (target === els.level) setCharacterLevel(target.value, true, true);
      if (target === els.spirit) setSpiritBlessingLevel(target.value, true, true);
      if (target.id.startsWith("atkBase")) {
        const stat = STAT_KEYS.find((key) => target.id === "atkBase" + key.toUpperCase());
        target.value = String(baseStatValue(stat));
      }
      if (target.dataset.atkSkillLevel) advanceSkillTabIfDone();
      saveState();
      renderAll();
    });
    view.addEventListener("click", (event) => {
      const tabButton = event.target.closest("[data-atk-skill-tab]");
      if (tabButton) {
        state.skillTab = tabButton.dataset.atkSkillTab || "零轉";
        saveState();
        renderAll();
        return;
      }
      const maxButton = event.target.closest("[data-atk-skill-max]");
      if (maxButton) {
        const skillId = maxButton.dataset.atkSkillMax;
        const skill = skillById(skillId);
        if (skill) {
          state.skillLevels[String(skillId)] = skillAssignableMax(skill);
          clampSkillLevelsToBudgets(skillId);
          advanceSkillTabIfDone();
          saveState();
          renderAll();
        }
        return;
      }
      const addButton = event.target.closest("[data-atk-add-buff]");
      if (addButton) {
        state.selectedItemBuffs.add(String(addButton.dataset.atkAddBuff));
        renderAll();
        return;
      }
      const removeButton = event.target.closest("[data-atk-remove-buff]");
      if (removeButton) {
        state.selectedItemBuffs.delete(String(removeButton.dataset.atkRemoveBuff));
        renderAll();
      }
    });
  }

  function init() {
    els = {
      status: document.getElementById("atkStatus"),
      body: document.getElementById("atkBody"),
      reset: document.getElementById("atkResetBtn"),
      job: document.getElementById("atkJob"),
      weapon: document.getElementById("atkWeapon"),
      level: document.getElementById("atkLevel"),
      spirit: document.getElementById("atkSpirit"),
      spiritHint: document.getElementById("atkSpiritHint"),
      baseBudget: document.getElementById("atkBaseBudget"),
      baseStats: document.getElementById("atkBaseStats"),
      equipStats: document.getElementById("atkEquipStats"),
      weaponAtk: document.getElementById("atkWeaponAtk"),
      equipAtk: document.getElementById("atkEquipAtk"),
      weaponMag: document.getElementById("atkWeaponMag"),
      equipMag: document.getElementById("atkEquipMag"),
      manualPad: document.getElementById("atkManualPad"),
      manualMad: document.getElementById("atkManualMad"),
      skillReset: document.getElementById("atkSkillReset"),
      skillBudget: document.getElementById("atkSkillBudget"),
      skillTabs: document.getElementById("atkSkillTabs"),
      skillList: document.getElementById("atkSkillList"),
      partyBuffs: document.getElementById("atkPartyBuffs"),
      itemBuffSearch: document.getElementById("atkItemBuffSearch"),
      itemBuffResults: document.getElementById("atkItemBuffResults"),
      itemBuffSelected: document.getElementById("atkItemBuffSelected"),
      detail: document.getElementById("atkDetail"),
    };
    initFields();
    initJobs();
    setSpiritBlessingLevel(state.spiritBlessingLevel, false);
    els.weaponAtk.value = currentJob() && currentJob().kind === "magic" ? 30 : 80;
    els.weaponMag.value = currentJob() && currentJob().kind === "magic" ? 90 : 0;
    applyJobDefaults();
    // 上次填的欄位值蓋回去（要排在 applyJobDefaults 之後，不然會被預設值蓋掉）
    restoreFields();
    clampBaseStats();
    setupEvents();
    renderAll();
    els.status.hidden = true;
    els.body.hidden = false;
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch("data/db/damage_calc.json")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        db = data;
        init();
      })
      .catch((err) => {
        console.error("[attack] 攻擊力計算資料載入失敗", err);
        loadPromise = null;
        const status = document.getElementById("atkStatus");
        if (status) status.textContent = "資料載入失敗，請重新整理頁面再試";
      });
    return loadPromise;
  }

  window.MapleAttackCalc = { load };
})();
