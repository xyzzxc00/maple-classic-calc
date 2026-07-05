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
    mastery: document.getElementById("attackMastery"),
    masteryHint: document.getElementById("attackMasteryHint"),
    resultLabel: document.getElementById("attackResultLabel"),
    result: document.getElementById("attackResult"),
    warningHint: document.getElementById("attackWarningHint"),
    clearBtn: document.getElementById("clearAttackBtn"),
  };
  if (!els.weaponType) return;

  const WEAPON_TYPES = window.MapleAttackWeaponTypes || [];
  const STAT_INPUTS = { str: els.str, dex: els.dex, int: els.int, luk: els.luk };

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

  function calc() {
    const weapon = getWeaponType();
    const weaponAtkRaw = els.weaponAtk.value.trim();
    const weaponAtk = parseFloat(weaponAtkRaw) || 0;
    const warnings = [];

    ["str", "dex", "int", "luk"].forEach((key) => {
      const raw = STAT_INPUTS[key].value.trim();
      if (raw && parseInt(raw, 10) < 0) warnings.push("能力值不能是負數");
    });
    if (weaponAtkRaw && weaponAtk < 0) warnings.push("武器攻擊力不能是負數");

    if (weapon.type === "magic") {
      // 法師的魔攻公式查到的資料互相矛盾（見 attackData.js 開頭說明），
      // 這裡只算「魔杖攻擊力 + 智力/2」這個多份資料都同意、沒有爭議的
      // 基礎值，不套用有爭議的範圍公式，避免把沒把握的數字當正式結果
      els.masteryField.hidden = true;
      els.masteryHint.hidden = true;
      els.weaponAtkLabel.textContent = "法杖／魔杖魔法攻擊力";
      els.resultLabel.textContent = "魔法攻擊力（基礎值，僅供參考）";
      const intVal = getStat("int");
      const magicBase = weaponAtk + Math.floor(intVal / 2);
      els.result.textContent = weaponAtkRaw || STAT_INPUTS.int.value.trim() ? `≈ ${magicBase.toLocaleString()}` : "—";
    } else {
      els.masteryField.hidden = false;
      els.masteryHint.hidden = false;
      els.weaponAtkLabel.textContent = "武器攻擊力";
      els.resultLabel.textContent = "攻擊力範圍";

      const mainStatVal = getStat(weapon.mainStat);
      const subStatsSum = weapon.subStats.reduce((sum, key) => sum + getStat(key), 0);
      const masteryRaw = els.mastery.value.trim();
      const masteryPct = parseFloat(masteryRaw);
      const masteryValid = !isNaN(masteryPct) && masteryPct >= 0 && masteryPct <= 100;
      if (masteryRaw && !masteryValid) warnings.push("熟練度請輸入 0～100 之間的數字");
      const mastery = masteryValid ? masteryPct / 100 : 0.1;

      const max = Math.floor((mainStatVal * weapon.coef + subStatsSum) * weaponAtk / 100);
      const min = Math.floor((mainStatVal * weapon.coef * 0.9 * mastery + subStatsSum) * weaponAtk / 100);
      els.result.textContent = weaponAtkRaw ? `${min.toLocaleString()} ~ ${max.toLocaleString()}` : "—";
    }

    els.warningHint.hidden = warnings.length === 0;
    els.warningHint.textContent = [...new Set(warnings)].join("；");
  }

  els.weaponType.addEventListener("change", calc);
  [els.weaponAtk, els.str, els.dex, els.int, els.luk, els.mastery].forEach((el) =>
    el.addEventListener("input", calc)
  );

  els.clearBtn.addEventListener("click", () => {
    els.weaponAtk.value = "";
    els.str.value = 4;
    els.dex.value = 4;
    els.int.value = 4;
    els.luk.value = 4;
    els.mastery.value = 10;
    els.weaponType.selectedIndex = 0;
    calc();
  });

  calc();
})();
