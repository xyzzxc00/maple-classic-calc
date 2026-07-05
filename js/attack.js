/**
 * attack.js — 攻擊力計算機 UI 綁定與計算邏輯
 */
(function () {
  const els = {
    weaponType: document.getElementById("attackWeaponType"),
    weaponAtk: document.getElementById("attackWeaponAtk"),
    weaponAtkLabel: document.getElementById("attackWeaponAtkLabel"),
    str: document.getElementById("attackStr"),
    dex: document.getElementById("attackDex"),
    int: document.getElementById("attackInt"),
    luk: document.getElementById("attackLuk"),
    masteryField: document.getElementById("attackMasteryField"),
    masteryLabel: document.getElementById("attackMasteryLabel"),
    mastery: document.getElementById("attackMastery"),
    masteryHint: document.getElementById("attackMasteryHint"),
    skillPctField: document.getElementById("attackSkillPctField"),
    skillPct: document.getElementById("attackSkillPct"),
    monsterMdefField: document.getElementById("attackMonsterMdefField"),
    monsterMdef: document.getElementById("attackMonsterMdef"),
    magicBonusRow: document.getElementById("attackMagicBonusRow"),
    elemBonus: document.getElementById("attackElemBonus"),
    manaBoost: document.getElementById("attackManaBoost"),
    staffMatch: document.getElementById("attackStaffMatch"),
    resultLabel: document.getElementById("attackResultLabel"),
    result: document.getElementById("attackResult"),
    warningHint: document.getElementById("attackWarningHint"),
    clearBtn: document.getElementById("clearAttackBtn"),
  };
  if (!els.weaponType) return;

  const WEAPON_TYPES = window.MapleAttackWeaponTypes || [];
  const STAT_INPUTS = { str: els.str, dex: els.dex, int: els.int, luk: els.luk };

  const MASTERY_HINT_PHYSICAL = "1轉熟練技能基礎 10%，滿級（Lv.20）約 60%；4轉「達人」系技能可以再往上加，實際數字請照自己技能視窗顯示的熟練度輸入。";
  const MASTERY_HINT_MAGIC = "法術熟練度（精神集中／魔法熟練系技能）點滿基本上是 60%，實際數字請照自己技能視窗顯示的熟練度輸入。";

  // 依武器資料本身的順序分組成 <optgroup>（劍士/弓箭手/盜賊/海盜/法師），
  // 跟職業介紹分頁的職業順序一致，不用另外維護一份順序
  const branches = [];
  WEAPON_TYPES.forEach((w) => { if (!branches.includes(w.branch)) branches.push(w.branch); });
  els.weaponType.innerHTML = branches
    .map((branch) => {
      const opts = WEAPON_TYPES.filter((w) => w.branch === branch)
        .map((w) => `<option value="${w.id}">${w.label}</option>`)
        .join("");
      return `<optgroup label="${branch}">${opts}</optgroup>`;
    })
    .join("");

  function getWeaponType() {
    return WEAPON_TYPES.find((w) => w.id === els.weaponType.value) || WEAPON_TYPES[0];
  }

  function getStat(key) {
    return parseInt(STAT_INPUTS[key].value, 10) || 0;
  }

  function getMastery(warnings) {
    const raw = els.mastery.value.trim();
    const pct = parseFloat(raw);
    const valid = !isNaN(pct) && pct >= 0 && pct <= 100;
    if (raw && !valid) warnings.push("熟練度請輸入 0～100 之間的數字");
    return valid ? pct / 100 : 0.1;
  }

  function calcPhysical(weapon, weaponAtk, weaponAtkRaw, warnings) {
    const mainStatVal = getStat(weapon.mainStat);
    const subStatsSum = weapon.subStats.reduce((sum, key) => sum + getStat(key), 0);
    const mastery = getMastery(warnings);

    const max = Math.floor((mainStatVal * weapon.coef + subStatsSum) * weaponAtk / 100);
    const min = Math.floor((mainStatVal * weapon.coef * 0.9 * mastery + subStatsSum) * weaponAtk / 100);
    els.result.textContent = weaponAtkRaw ? `${min.toLocaleString()} ~ ${max.toLocaleString()}` : "—";
  }

  // 巴哈姆特新楓之谷哈啦板 2008 年（大改版前）文章公式，細節見 attackData.js
  // 開頭說明。技能攻擊力／怪物魔防／三種加成都是選填，沒填視為「無加成、
  // 對 0 魔防目標」的基礎值。
  function calcMagic(weaponAtk, weaponAtkRaw, warnings) {
    const intVal = getStat("int");
    const mastery = getMastery(warnings);

    const skillPctRaw = els.skillPct.value.trim();
    const skillPct = parseFloat(skillPctRaw);
    if (skillPctRaw && skillPct < 0) warnings.push("技能攻擊力不能是負數");
    const effectiveSkillPct = (!isNaN(skillPct) && skillPct >= 0) ? skillPct : 100;

    const mdefRaw = els.monsterMdef.value.trim();
    const mdef = parseFloat(mdefRaw);
    if (mdefRaw && mdef < 0) warnings.push("怪物魔防不能是負數");
    const effectiveMdef = (!isNaN(mdef) && mdef >= 0) ? mdef : 0;

    const bonusMult = (els.elemBonus.checked ? 1.5 : 1) *
      (els.manaBoost.checked ? 1.35 : 1) *
      (parseFloat(els.staffMatch.value) || 1);

    const sharedTerm = weaponAtk * weaponAtk * 0.003365 + intVal * 0.5;
    const maxBase = (weaponAtk * 3.3 + sharedTerm) * effectiveSkillPct / 100;
    const minBase = (weaponAtk * 3.3 * mastery * 0.9 + sharedTerm) * effectiveSkillPct / 100;

    const max = Math.floor(maxBase * bonusMult - effectiveMdef / 3);
    const min = Math.floor(minBase * bonusMult - effectiveMdef / 3);
    els.result.textContent = weaponAtkRaw ? `${min.toLocaleString()} ~ ${max.toLocaleString()}` : "—";
  }

  function calc() {
    const weapon = getWeaponType();
    const weaponAtkRaw = els.weaponAtk.value.trim();
    const weaponAtk = parseFloat(weaponAtkRaw) || 0;
    const warnings = [];
    const isMagic = weapon.type === "magic";

    ["str", "dex", "int", "luk"].forEach((key) => {
      const raw = STAT_INPUTS[key].value.trim();
      if (raw && parseInt(raw, 10) < 0) warnings.push("能力值不能是負數");
    });
    if (weaponAtkRaw && weaponAtk < 0) warnings.push("武器攻擊力不能是負數");

    els.skillPctField.hidden = !isMagic;
    els.monsterMdefField.hidden = !isMagic;
    els.magicBonusRow.hidden = !isMagic;
    els.masteryLabel.textContent = isMagic ? "法術熟練度 %（技能視窗顯示的數字，直接輸入）" : "熟練度 %（技能視窗顯示的數字，直接輸入）";
    els.masteryHint.textContent = isMagic ? MASTERY_HINT_MAGIC : MASTERY_HINT_PHYSICAL;
    els.weaponAtkLabel.textContent = isMagic ? "魔攻（角色資訊視窗顯示的魔攻數值）" : "武器攻擊力";
    els.resultLabel.textContent = isMagic ? "魔法攻擊力範圍" : "攻擊力範圍";

    if (isMagic) {
      calcMagic(weaponAtk, weaponAtkRaw, warnings);
    } else {
      calcPhysical(weapon, weaponAtk, weaponAtkRaw, warnings);
    }

    els.warningHint.hidden = warnings.length === 0;
    els.warningHint.textContent = [...new Set(warnings)].join("；");
  }

  els.weaponType.addEventListener("change", calc);
  [
    els.weaponAtk, els.str, els.dex, els.int, els.luk, els.mastery,
    els.skillPct, els.monsterMdef,
  ].forEach((el) => el.addEventListener("input", calc));
  [els.elemBonus, els.manaBoost, els.staffMatch].forEach((el) =>
    el.addEventListener("change", calc)
  );

  els.clearBtn.addEventListener("click", () => {
    els.weaponAtk.value = "";
    els.str.value = 4;
    els.dex.value = 4;
    els.int.value = 4;
    els.luk.value = 4;
    els.mastery.value = 10;
    els.skillPct.value = "";
    els.monsterMdef.value = "";
    els.elemBonus.checked = false;
    els.manaBoost.checked = false;
    els.staffMatch.value = "1";
    els.weaponType.selectedIndex = 0;
    calc();
  });

  calc();
})();
