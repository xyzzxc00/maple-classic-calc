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
  // 四轉雖尚未開放，仍先放進 SP 階段順序。目前等級上限
  // 低於 120，四轉預算自然是 0、也沒有技能頁籤；未來資料開放後
  // 只要提高 MAX_CHARACTER_LEVEL，「高轉 SP 可回點低轉」的共用規則就會直接涵蓋四轉。
  const ADVANCEMENT_ORDER = ["零轉", "一轉", "二轉", "三轉", "四轉"];
  const ADVANCEMENT_START_LEVELS = { "二轉": 30, "三轉": 70, "四轉": 120 };
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

  // 群體治癒一次最多補到 5 隻怪（第 6 個目標是自己）
  const MAX_HEAL_TARGETS = 5;

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
  // 存的是 el.value，所以 <select>（atkHealTargets）跟 <input> 一樣通用
  const PERSISTED_FIELD_IDS = [
    "atkWeaponAtk", "atkEquipAtk", "atkWeaponMag", "atkEquipMag",
    "atkManualPad", "atkManualMad", "atkHealTargets",
  ];

  function statFieldIds() {
    return STAT_KEYS.map((stat) => "atkBase" + stat.toUpperCase())
      .concat(STAT_KEYS.map((stat) => "atkEquip" + stat.toUpperCase()));
  }

  // 初始化期間一律不准存檔。init() 的流程是「先填職業預設值 → 再把使用者
  // 存的值蓋回去」，而中間 applyJobDefaults() → renderWeaponOptions() 會呼叫
  // saveState()——那一刻畫面上還是預設值，等於把使用者的設定覆蓋掉。
  // 症狀很難察覺：畫面之後被 restoreFields() 蓋成正確的值，看起來一切正常，
  // 但 localStorage 已經是預設值了，要等下一次開啟才發現資料不見
  let ready = false;

  function saveState() {
    if (!ready) return;
    try {
      const fields = {};
      PERSISTED_FIELD_IDS.concat(statFieldIds()).forEach((id) => {
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
    return Number(ADVANCEMENT_START_LEVELS[advancement] || MIN_CHARACTER_LEVEL);
  }

  function advancementEndLevel(advancement) {
    const index = advancementIndex(advancement);
    const next = index >= 0 ? ADVANCEMENT_ORDER[index + 1] : "";
    return next ? advancementStartLevel(next) : MAX_CHARACTER_LEVEL;
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

  // 從指定轉數往後的「技能已用 SP」與「取得 SP」。
  // 舊楓的規則是高轉 SP 能點回低轉，低轉 SP 不能向後點，所以正確的
  // 限制是這組「後綴預算」：二轉以上的技能合計不能超過二～四轉
  // 取得的 SP；三轉以上同理。初心者 SP 是獨立池，不參與這組計算。
  function skillUsedFrom(stageIndex) {
    return jobSkills()
      .filter((skill) => {
        const index = advancementIndex(skillAdvancement(skill));
        return index >= stageIndex;
      })
      .reduce((sum, skill) => sum + skillLevel(skill.id), 0);
  }

  function skillBudgetFrom(stageIndex) {
    return ADVANCEMENT_ORDER
      .slice(Math.max(0, stageIndex))
      .reduce((sum, advancement) => sum + skillBudget(advancement), 0);
  }

  function skillGateReason(skill) {
    const advancement = skillAdvancement(skill);
    const stageIndex = advancementIndex(advancement);
    if (stageIndex < 0) return "";
    if (stageIndex > 0 && characterLevel() < advancementStartLevel(advancement)) return "等級不足";
    return "";
  }

  // 可加到幾級：初心者只吃獨立 SP；一～四轉技能則同時檢查
  // 所有會被這次加點影響的後綴預算。例如二轉技能既受「職業總 SP」
  // 限制，也受「二轉以上 SP」限制；一轉技能只受職業總 SP 限制，
  // 因此可以合法地用二、三、四轉取得的 SP 往回補。
  function skillAssignableMax(skill) {
    const skillMax = Number((skill && skill.maxLevel) || 0);
    const current = skillLevel(skill && skill.id);
    if (skillMax <= 0) return 0;
    if (skillGateReason(skill)) return Math.min(skillMax, current);
    const advancement = skillAdvancement(skill);
    const stageIndex = advancementIndex(advancement);
    if (stageIndex === 0) {
      const beginnerLeft = Math.max(0, skillBudget(advancement) - skillBudgetUsed(advancement));
      return Math.max(0, Math.min(skillMax, current + beginnerLeft));
    }
    let assignable = Number.POSITIVE_INFINITY;
    for (let index = 1; index <= stageIndex; index += 1) {
      assignable = Math.min(assignable, skillBudgetFrom(index) - skillUsedFrom(index));
    }
    return Math.max(0, Math.min(skillMax, current + Math.max(0, assignable)));
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

    const beginnerSkills = skills.filter((skill) => advancementIndex(skillAdvancement(skill)) === 0);
    const beginnerOverBudget = skillBudgetUsed("零轉") - skillBudget("零轉");
    if (beginnerOverBudget > 0) reducePoints(beginnerSkills, beginnerOverBudget);

    // 從最高轉數往回檢查，先修正「低轉 SP 被拿去點高轉」的非法分配，
    // 最後 index=1 再負責職業總 SP。優先從剛改動的技能扣回，輸入超額時
    // 不會偷改使用者之前配好的其他技能。
    for (let index = ADVANCEMENT_ORDER.length - 1; index >= 1; index -= 1) {
      const overBudget = skillUsedFrom(index) - skillBudgetFrom(index);
      if (overBudget <= 0) continue;
      const affectedSkills = skills.filter((skill) => advancementIndex(skillAdvancement(skill)) >= index);
      reducePoints(affectedSkills, overBudget);
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

  // 群體治癒這種「補血順便打不死系」的技能，資料上只有恢復力（hp），沒有
  // 任何傷害欄位，所以下面 isDamageSkill 那條路認不出來，得靠技能敘述判斷
  function isHealDamageSkill(skill) {
    return /不死/.test((skill && skill.description) || "") &&
      ((skill && skill.levels) || []).some((row) => (row.values || {}).hp);
  }

  function healDamageSkill() {
    return jobSkills().find(isHealDamageSkill) || null;
  }

  function healUndeadCount() {
    return clampNumber(els && els.healTargets && els.healTargets.value, 1, MAX_HEAL_TARGETS, 1);
  }

  function isDamageSkill(skill) {
    if (isHealDamageSkill(skill)) return true;
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

  /**
   * 群體治癒打不死系怪物的傷害。跟一般魔法技能是完全不同的公式：
   * 同時吃智力與幸運，智力係數 0.3~1.2、幸運係數固定 1.0，而且**不吃熟練度**
   * ——所以下限只有上限的三成左右（一般魔法技能約七成五），傷害特別飄。
   *
   * 目標乘數 = 1.5 + 5 ÷ (範圍內目標總數)，目標總數要把自己算進去，所以
   * 打 n 隻不死怪時是 1.5 + 5 ÷ (n + 1)。**這裡是最容易抄錯的地方**：來源
   * 的對照表寫「1個目標: 6.5」，那個 6.5 是自補、範圍內沒有怪的情況；打
   * 1 隻怪要用 4。照字面把 6.5 套在 1 隻怪上會讓傷害虛高約六成。
   *
   * 來源：巴哈 85994 板〈[全智]or[裝備] 經典服法師起手到底該怎麼選〉一文
   * 與作者附的試算表。已拿試算表自己的五組數字（1~5 隻怪的上下限）反推
   * 驗證，五組全部吻合，反推出的技能係數 2.998 也對上資料庫的 Lv.30 恢復力
   * 300%。試算表另外會扣怪物魔防（上限 ×0.5、下限 ×0.6），我們這裡跟其他
   * 技能一致不扣，卡片下方本來就標示了「未計入怪物防禦與屬性相剋」。
   */
  function healSkillDamage(skill, values, range) {
    const percent = Number(values.hp || 0);
    if (!percent) return null;
    const undead = healUndeadCount();
    const factor = range.magicAttack / 1000 * (percent / 100) * (1.5 + 5 / (undead + 1));
    return {
      min: Math.floor((range.stats.int * 0.3 + range.stats.luk) * factor),
      max: Math.floor((range.stats.int * 1.2 + range.stats.luk) * factor),
      hits: 1,
      percent,
      note: "對不死系 · 範圍內 " + undead + " 隻 · " + percent + "%",
    };
  }

  function skillDamage(skill, range) {
    const level = skillLevel(skill.id);
    if (!level) return null;
    const values = selectedSkillValues(skill);
    if (isHealDamageSkill(skill)) return healSkillDamage(skill, values, range);
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
    // 高轉 SP 回補後，單一轉數的已用點數可能合法地高於該轉原生預算；
    // 只有「剛好用完」時才自動翻頁，避免使用者回頭補技能時每點一下就被帶走。
    if (!budget || skillBudgetUsed(current) !== budget) return;
    const next = available
      .slice(available.indexOf(current) + 1)
      .find((adv) => skillBudget(adv) > skillBudgetUsed(adv));
    if (next) state.skillTab = next;
  }

  function renderSkillBudget() {
    els.skillBudget.innerHTML = availableSkillAdvancements().map((advancement) => {
      const stageIndex = advancementIndex(advancement);
      const beginner = stageIndex === 0;
      const used = beginner ? skillBudgetUsed(advancement) : skillUsedFrom(stageIndex);
      const budget = beginner ? skillBudget(advancement) : skillBudgetFrom(stageIndex);
      const label = beginner
        ? "初心者 SP"
        : (stageIndex === 1 ? "職業 SP" : advancement + "以上 SP");
      return '<span class="atk-pill' + (budget ? "" : " atk-pill--empty") + '">' +
        esc(label) + " " + fmt(used) + " / " + fmt(budget) + "</span>";
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
    // 「不死怪數量」只對真的點了群體治癒的職業有意義：沒點就沒有傷害卡片，
    // 留一個沒有對應輸出的欄位只會讓人猜它在做什麼
    const healSkill = healDamageSkill();
    if (els.healBlock) els.healBlock.hidden = !healSkill || !skillLevel(healSkill.id);
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
    if (els.healTargets) els.healTargets.value = "1";
    for (const stat of STAT_KEYS) {
      const base = baseStatInput(stat);
      const equip = document.getElementById("atkEquip" + stat.toUpperCase());
      if (base) base.dataset.userEdited = "";
      if (equip) equip.value = "0";
    }
    applyJobDefaults();
    clampSkillLevelsToBudgets();
    renderAll();
    saveState();
  }

  function setupEvents() {
    els.reset.addEventListener("click", clearAll);
    els.skillReset.addEventListener("click", () => {
      state.skillLevels = {};
      clampSkillLevelsToBudgets();
      renderAll();
      saveState();
    });
    els.job.addEventListener("change", () => {
      state.jobId = els.job.value;
      state.skillLevels = {};
      state.skillTab = "零轉";
      // 換職業就重設成該職業的第一把武器。不清掉的話，只要新舊職業碰巧都
      // 能裝這把（例如法師的清單裡其實也有單手劍），就會沿用舊的——換到
      // 大魔導士卻拿著劍、表攻還用 STR×4.0 去算，數字低得莫名其妙
      state.weaponType = "";
      saveState();
      setCharacterLevel(state.characterLevel, true);
      applyJobDefaults();
      clampSkillLevelsToBudgets();
      renderAll();
    });
    els.weapon.addEventListener("change", () => {
      state.weaponType = els.weapon.value;
      renderAll();
      saveState();
    });
    // 下面的 input/change 委派只處理 HTMLInputElement，<select> 不會進去，
    // 所以這一顆要自己綁。只影響傷害數字，用 renderLive 就夠
    if (els.healTargets) {
      els.healTargets.addEventListener("change", () => {
        renderLive();
        saveState();
      });
    }
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
        renderLive();
        saveState();
        return;
      }
      const partyBuffId = target.dataset.atkPartyBuffLevel;
      if (partyBuffId) {
        const buff = partyBuffById(partyBuffId);
        const max = Number((buff && buff.maxLevel) || 0);
        state.partySkillBuffLevels[String(partyBuffId)] = Math.max(0, Math.min(max, Number(target.value || 0)));
        renderLive();
        saveState();
        return;
      }
      // 武器攻擊力、裝備加成那些純數字欄位：不需要重建任何列表
      renderLive();
      saveState();
    });
    // change（失焦／Enter）才把值規範化並整個重繪——列表重建會換掉 DOM，
    // 放在這裡才不會打斷打字
    view.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const partySkillBuff = target.dataset.atkPartyBuff;
      if (partySkillBuff) {
        state.activePartySkillBuffs[String(partySkillBuff)] = target.checked;
        renderAll();
        saveState();
        return;
      }
      if (target === els.level) setCharacterLevel(target.value, true, true);
      if (target === els.spirit) setSpiritBlessingLevel(target.value, true, true);
      if (target.id.startsWith("atkBase")) {
        const stat = STAT_KEYS.find((key) => target.id === "atkBase" + key.toUpperCase());
        target.value = String(baseStatValue(stat));
      }
      if (target.dataset.atkSkillLevel) advanceSkillTabIfDone();
      renderAll();
      saveState();
    });
    view.addEventListener("click", (event) => {
      const tabButton = event.target.closest("[data-atk-skill-tab]");
      if (tabButton) {
        state.skillTab = tabButton.dataset.atkSkillTab || "零轉";
        renderAll();
        saveState();
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
          renderAll();
          saveState();
        }
        return;
      }
      const addButton = event.target.closest("[data-atk-add-buff]");
      if (addButton) {
        state.selectedItemBuffs.add(String(addButton.dataset.atkAddBuff));
        renderAll();
        saveState();
        return;
      }
      const removeButton = event.target.closest("[data-atk-remove-buff]");
      if (removeButton) {
        state.selectedItemBuffs.delete(String(removeButton.dataset.atkRemoveBuff));
        renderAll();
        saveState();
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
      healBlock: document.getElementById("atkHealBlock"),
      healTargets: document.getElementById("atkHealTargets"),
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
    // 到這裡畫面已經是「使用者上次的狀態」，之後的存檔才存得到對的東西
    ready = true;
    renderAll();
    els.status.hidden = true;
    els.body.hidden = false;
  }

  function load() {
    if (loadPromise) return loadPromise;
    // 帶版本參數，理由同 db.js 的 verUrl（資料更新後不能讓瀏覽器吃舊快取）
    const ver = document.documentElement.dataset.assetVer;
    loadPromise = fetch("data/db/damage_calc.json" + (ver ? "?v=" + ver : ""))
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
