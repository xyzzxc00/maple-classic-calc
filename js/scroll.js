/**
 * scroll.js — 卷軸強化模擬 UI 綁定與計算邏輯
 *
 * 機制說明：
 * - 一件裝備有固定的「衝捲數」，每次都是新的一格、只能衝一次卷軸，不能重衝同一格。
 * - 「目標成功張數」是這件裝備至少要幾次衝成功（可以 ≤ 衝捲數）。
 * - 「失敗報廢張數」是開局後最前面連續失敗到這個張數（中途只要衝到 1 張成功就不算），
 *   就當這件裝備報廢、直接換新的重來——這是玩家實際會用的停損策略。
 * - 上半部「理論值」用二項分布算「完全不放棄、每件都衝滿所有次數」的期望值，當基準參考。
 * - 下半部「衝卷模擬」是真的套用報廢策略跑隨機數，因為提早放棄能省下不少卷軸錢，
 *   實際花費通常會比理論值低。
 */
(function () {
  const els = {
    rate: document.getElementById("scrollRate"),
    slots: document.getElementById("scrollSlots"),
    target: document.getElementById("scrollTarget"),
    giveup: document.getElementById("scrollGiveup"),
    equipPrice: document.getElementById("scrollEquipPrice"),
    price: document.getElementById("scrollPrice"),
    warningHint: document.getElementById("scrollWarningHint"),

    theoryChance: document.getElementById("scrollTheoryChance"),
    theoryCopies: document.getElementById("scrollTheoryCopies"),
    theoryCostBox: document.getElementById("scrollTheoryCostBox"),
    theoryScrolls: document.getElementById("scrollTheoryScrolls"),
    theoryCost: document.getElementById("scrollTheoryCost"),

    curAttempts: document.getElementById("scrollCurAttempts"),
    curSlots: document.getElementById("scrollCurSlots"),
    curSuccess: document.getElementById("scrollCurSuccess"),
    attackBtn: document.getElementById("scrollAttackBtn"),
    autoBtn: document.getElementById("scrollAutoBtn"),
    swapBtn: document.getElementById("scrollSwapBtn"),
    clearBtn: document.getElementById("clearScrollBtn"),
    resetSimBtn: document.getElementById("scrollResetSimBtn"),
    simCopies: document.getElementById("scrollSimCopies"),
    simCostRow: document.getElementById("scrollSimCostRow"),
    simCost: document.getElementById("scrollSimCost"),
    simResult: document.getElementById("scrollSimResult"),
    simDist: document.getElementById("scrollSimDist"),
  };
  if (!els.rate) return;

  const parseExpVal = window.MapleCalculator ? window.MapleCalculator.parseExpVal : parseFloat;

  function formatGold(n) {
    if (!isFinite(n)) return "—";
    if (n >= 1e12) return (n / 1e12).toFixed(2) + " 兆";
    if (n >= 1e8) return (n / 1e8).toFixed(2) + " 億";
    if (n >= 1e4) return (n / 1e4).toFixed(2) + " 萬";
    return Math.round(n).toLocaleString();
  }

  function formatChance(p) {
    const pct = p * 100;
    if (pct <= 0) return "0%";
    if (pct < 0.01) return "< 0.01%";
    return pct.toFixed(pct < 1 ? 2 : 1) + "%";
  }

  function choose(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let result = 1;
    for (let i = 0; i < k; i++) {
      result = (result * (n - i)) / (i + 1);
    }
    return result;
  }

  // P(Binomial(n, p) >= target)：完全不放棄、衝滿 n 格時，至少 target 格成功的機率
  function probAtLeast(n, p, target) {
    if (target <= 0) return 1;
    if (target > n) return 0;
    let sum = 0;
    for (let i = target; i <= n; i++) {
      sum += choose(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i);
    }
    return Math.min(Math.max(sum, 0), 1);
  }

  function readConfig() {
    // raw* 保留夾值前的原始輸入給 renderWarning 用——warning 要比對「使用者
    // 填了什麼」，夾過的值永遠在範圍內，拿它判斷警告就變成死程式碼。
    // 之前 target/giveup 在存成 raw 前就先 Math.max(...,1) 夾過一次，等於
    // 把「填負數/0」跟「本來就填 1」混成同一種 raw 值，下限警告永遠不出現；
    // slots 更是完全沒有 raw 版本。這裡四個欄位都先原封不動存字串再轉數字，
    // *Filled 用來分辨「使用者真的填了無效值」跟「欄位是空的」，避免空欄位
    // 也跳出「已改用 1 計算」的警告
    const rawRateStr = els.rate.value.trim();
    const rawRateNum = parseFloat(els.rate.value);
    // 打非數字文字時 parseFloat 是 NaN，跟「填 0%」的 fallback 值撞在一起——
    // slots/target/giveup 下限是 1，NaN 落到 0 剛好會被「< 1」的下限檢查抓到；
    // rate 的合法下限是 0，NaN 落到 0 反而落在合法範圍內，下面單純比大小的
    // 警告判斷抓不到，要另外記一個 rawRateInvalid 給 renderWarning 用
    const rawRateInvalid = rawRateStr !== "" && isNaN(rawRateNum);
    const rawRate = isNaN(rawRateNum) ? 0 : rawRateNum;
    const rawSlotsStr = els.slots.value.trim();
    const rawSlots = parseInt(els.slots.value, 10) || 0;
    const rawTargetStr = els.target.value.trim();
    const rawTarget = parseInt(els.target.value, 10) || 0;
    const rawGiveupStr = els.giveup.value.trim();
    const rawGiveup = parseInt(els.giveup.value, 10) || 0;

    const rate = Math.min(Math.max(rawRate, 0), 100) / 100;
    // 上限跟 HTML 的 max="20" 一致——HTML 屬性擋不住手動打字，沒有這條的話
    // 極大值會讓二項分布計算溢位成 NaN，幾萬以上更會讓每次 input 重算卡住
    // 整個分頁好幾秒（O(n·k) 迴圈），這是唯一能把分頁弄死的輸入
    const slots = Math.min(Math.max(rawSlots, 1), 20);
    const target = Math.min(Math.max(rawTarget, 1), slots);
    const giveup = Math.min(Math.max(rawGiveup, 1), slots);
    const equipPrice = parseExpVal(els.equipPrice.value);
    const price = parseExpVal(els.price.value);
    return {
      rate, slots, target, giveup, equipPrice, price,
      rawRate, rawRateFilled: !!rawRateStr, rawRateInvalid,
      rawSlots, rawSlotsFilled: !!rawSlotsStr,
      rawTarget, rawTargetFilled: !!rawTargetStr,
      rawGiveup, rawGiveupFilled: !!rawGiveupStr,
    };
  }

  function renderTheory(cfg) {
    els.curSlots.textContent = cfg.slots;

    if (!cfg.rate) {
      els.theoryChance.textContent = "—";
      els.theoryCopies.textContent = "—";
      els.theoryCostBox.hidden = true;
      return;
    }

    const chance = probAtLeast(cfg.slots, cfg.rate, cfg.target);
    els.theoryChance.textContent = formatChance(chance);

    if (chance <= 0) {
      els.theoryCopies.textContent = "幾乎不可能";
      els.theoryCostBox.hidden = true;
      return;
    }

    const avgCopies = 1 / chance;
    els.theoryCopies.textContent = avgCopies.toFixed(1) + " 件";

    const hasEquipPrice = Number.isFinite(cfg.equipPrice) && cfg.equipPrice > 0;
    const hasScrollPrice = Number.isFinite(cfg.price) && cfg.price > 0;
    els.theoryCostBox.hidden = !hasEquipPrice && !hasScrollPrice;
    if (!els.theoryCostBox.hidden) {
      const avgScrolls = avgCopies * cfg.slots;
      els.theoryScrolls.textContent = avgScrolls.toFixed(1) + " 張";
      const cost = avgCopies * (cfg.equipPrice || 0) + avgScrolls * (cfg.price || 0);
      els.theoryCost.textContent = formatGold(cost) + " 楓幣";
    }
  }

  function renderWarning(cfg) {
    const msgs = [];
    if (cfg.rawSlotsFilled && cfg.rawSlots < 1) {
      msgs.push("裝備衝捲數至少要 1 格，已改用 1 格計算。");
    } else if (cfg.rawSlots > 20) {
      msgs.push("裝備衝捲數最多 20 格，已改用 20 格計算。");
    }
    if (cfg.rawTargetFilled && cfg.rawTarget < 1) {
      msgs.push("目標成功張數至少要 1 張，已改用 1 張計算。");
    } else if (cfg.rawTarget > cfg.slots) {
      msgs.push(`目標成功張數不能超過裝備衝捲數，已改用 ${cfg.slots} 張計算。`);
    }
    if (cfg.rawGiveupFilled && cfg.rawGiveup < 1) {
      msgs.push("失敗報廢張數至少要 1 張，已改用 1 張計算。");
    } else if (cfg.rawGiveup > cfg.slots) {
      msgs.push(`失敗報廢張數不能超過裝備衝捲數，已改用 ${cfg.slots} 張計算。`);
    }
    if (cfg.rawRateInvalid) {
      msgs.push("成功率請輸入 0~100 之間的數字，已改用 0% 計算。");
    } else if (cfg.rawRateFilled && cfg.rawRate < 0) {
      msgs.push("成功率不能是負數，已改用 0% 計算。");
    } else if (cfg.rawRate > 100) {
      msgs.push("成功率最高 100%，已改用 100% 計算。");
    }
    els.warningHint.hidden = msgs.length === 0;
    els.warningHint.textContent = msgs.join(" ");
  }

  // ---------- 衝卷模擬（會套用報廢策略的真隨機模擬） ----------
  const sim = {
    attempts: 0,
    success: 0,
    copies: 0,
    cost: 0,
    dist: {}, // { successCount: 件數 }
    done: false,
  };

  function tallyCurrentCopy() {
    sim.dist[sim.success] = (sim.dist[sim.success] || 0) + 1;
  }

  function startNewCopy(cfg) {
    sim.attempts = 0;
    sim.success = 0;
    sim.copies++;
    if (Number.isFinite(cfg.equipPrice) && cfg.equipPrice > 0) sim.cost += cfg.equipPrice;
  }

  function isCopyDead(cfg) {
    if (sim.attempts >= cfg.slots) return true;
    if (sim.success === 0 && sim.attempts >= cfg.giveup) return true;
    const remaining = cfg.slots - sim.attempts;
    if (sim.success + remaining < cfg.target) return true;
    return false;
  }

  // 丟一次卷軸，回傳這次是不是命中
  function rollOnce(cfg) {
    if (Number.isFinite(cfg.price) && cfg.price > 0) sim.cost += cfg.price;
    sim.attempts++;
    const hit = Math.random() < cfg.rate;
    if (hit) sim.success++;
    return hit;
  }

  function renderDist(cfg) {
    const total = sim.copies;
    if (!total) {
      els.simDist.hidden = true;
      els.simDist.innerHTML = "";
      return;
    }
    els.simDist.hidden = false;
    let rows = `<p class="scroll-sim-dist-title">衝過裝備統計（總計：${total.toLocaleString()} 件）</p>`;
    for (let i = 0; i <= cfg.slots; i++) {
      const count = sim.dist[i] || 0;
      if (!count) continue;
      const pct = (count / total) * 100;
      rows += `<div class="scroll-sim-dist-row">
        <span class="scroll-sim-dist-label">成功 ${i}</span>
        <span class="scroll-sim-dist-bar-track"><span class="scroll-sim-dist-bar-fill" style="width:${pct}%"></span></span>
        <span class="scroll-sim-dist-count">${count.toLocaleString()}（${pct.toFixed(1)}%）</span>
      </div>`;
    }
    els.simDist.innerHTML = rows;
  }

  function renderSimStatus(cfg) {
    els.curAttempts.textContent = sim.attempts;
    els.curSlots.textContent = cfg.slots;
    els.curSuccess.textContent = sim.success;
    els.simCopies.textContent = sim.copies.toLocaleString();

    const hasCost = (Number.isFinite(cfg.equipPrice) && cfg.equipPrice > 0) || (Number.isFinite(cfg.price) && cfg.price > 0);
    els.simCostRow.hidden = !hasCost;
    if (hasCost) els.simCost.textContent = formatGold(sim.cost) + " 楓幣";

    renderDist(cfg);
  }

  function finishSuccess(cfg) {
    tallyCurrentCopy();
    sim.done = true;
    els.simResult.hidden = false;
    els.simResult.textContent = `達成目標！這件裝備衝了 ${sim.attempts} 張卷，成功 ${sim.success} / ${cfg.target}（累計試了 ${sim.copies.toLocaleString()} 件裝備）`;
  }

  // 手動衝一張：如果目前沒有進行中的裝備（或上一件已達標／已用完），就先開新的
  function attackOnce() {
    const cfg = readConfig();
    if (sim.done || sim.copies === 0) {
      startNewCopy(cfg);
      sim.done = false;
      els.simResult.hidden = true;
    }
    rollOnce(cfg);
    if (sim.success >= cfg.target) {
      finishSuccess(cfg);
    } else if (isCopyDead(cfg)) {
      tallyCurrentCopy();
      // 跟 autoRun 一樣走 startNewCopy：之前這裡只歸零 attempts/success，
      // 沒有把裝備件數 +1、也沒累計新裝備的價格，手動模式的「累計試了
      // X 件」跟總成本會一路低估，分布百分比的分母也跟著錯
      startNewCopy(cfg);
    }
    renderSimStatus(cfg);
  }

  // 自動連續衝到達標為止（會自動換裝備），防止極端低機率跑到卡死畫面設個上限
  function autoRun() {
    const cfg = readConfig();
    if (!cfg.rate) {
      // 靜默 return 會讓按鈕看起來像壞掉，講清楚為什麼沒反應
      els.simResult.hidden = false;
      els.simResult.textContent = "成功率目前是 0%，先在上面填卷軸成功率再開始模擬。";
      return;
    }
    const MAX_ROLLS = 200000;
    let rolls = 0;

    if (sim.done || sim.copies === 0) {
      startNewCopy(cfg);
      sim.done = false;
      els.simResult.hidden = true;
    }

    while (rolls < MAX_ROLLS) {
      rolls++;
      rollOnce(cfg);
      if (sim.success >= cfg.target) {
        finishSuccess(cfg);
        break;
      }
      if (isCopyDead(cfg)) {
        tallyCurrentCopy();
        startNewCopy(cfg);
      }
    }

    if (!sim.done && rolls >= MAX_ROLLS) {
      els.simResult.hidden = false;
      els.simResult.textContent = "超過模擬上限（20 萬張），這組條件太難達成，實際情況請參考上面的理論值。";
    }

    renderSimStatus(cfg);
  }

  // 手動放棄目前這件，換新的（不等報廢門檻）
  function swapEquip() {
    const cfg = readConfig();
    if (sim.copies > 0 && !sim.done) tallyCurrentCopy();
    startNewCopy(cfg);
    sim.done = false;
    els.simResult.hidden = true;
    renderSimStatus(cfg);
  }

  // 只重置「衝卷模擬」下半部累計的數據（裝備數、成本、分布），不動上面填的設定值
  function resetSimOnly() {
    sim.attempts = 0;
    sim.success = 0;
    sim.copies = 0;
    sim.cost = 0;
    sim.dist = {};
    sim.done = false;
    els.simResult.hidden = true;
    // 隱藏之外連內容一起清：舊結果文字留著的話，下次任何地方把 hidden
    // 拿掉（或未來改版忘了先寫入再顯示）會閃出上一輪的結論
    els.simResult.textContent = "";
    renderAll();
  }

  function resetAll() {
    els.rate.value = 60;
    els.slots.value = 5;
    els.target.value = 5;
    els.giveup.value = 5;
    els.equipPrice.value = "";
    els.price.value = "";
    resetSimOnly();
  }

  function renderAll() {
    const cfg = readConfig();
    renderWarning(cfg);
    renderTheory(cfg);
    renderSimStatus(cfg);
  }

  [els.rate, els.slots, els.target, els.giveup, els.equipPrice, els.price].forEach((el) =>
    el.addEventListener("input", renderAll)
  );
  els.attackBtn.addEventListener("click", attackOnce);
  els.autoBtn.addEventListener("click", autoRun);
  els.swapBtn.addEventListener("click", swapEquip);
  els.clearBtn.addEventListener("click", resetAll);
  els.resetSimBtn.addEventListener("click", resetSimOnly);

  renderAll();
})();
