/**
 * spots.js — 建議練功地點
 * -----------------------------------------------------------------
 * 不再用猜的佔位資料，改成把「社群經驗資料庫」(community.js / Firestore
 * exp_records) 裡玩家回報的紀錄，依地圖分組算平均效率，依目前等級排序，
 * 整理成「現在最適合去哪裡練」的建議列表。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    list: document.getElementById("spotsList"),
    addBtn: document.getElementById("spotsAddBtn"),
    filterJob: document.getElementById("spotsFilterJob"),
  };

  let currentLevel = 1;

  const escHtml = MapleCalculator.escHtml;

  function setCurrentLevel(level) {
    currentLevel = level || 1;
    render();
  }

  // 把同一張地圖的多筆回報合併成一個地點：平均效率、看過的等級範圍、回報過的職業
  function groupByMap(records) {
    const groups = new Map();
    records.forEach((r) => {
      if (!groups.has(r.map)) {
        groups.set(r.map, { map: r.map, jobs: new Set(), levels: [], expRates: [], count: 0 });
      }
      const g = groups.get(r.map);
      g.jobs.add(r.job);
      g.levels.push(r.level);
      g.expRates.push(r.expPer10Min);
      g.count++;
    });
    return Array.from(groups.values()).map((g) => ({
      map: g.map,
      jobs: Array.from(g.jobs),
      levelMin: Math.min(...g.levels),
      levelMax: Math.max(...g.levels),
      avgExpPer10Min: Math.round(g.expRates.reduce((a, b) => a + b, 0) / g.expRates.length),
      count: g.count,
    }));
  }

  function isSuitable(spot) {
    return currentLevel >= spot.levelMin - 5 && currentLevel <= spot.levelMax + 5;
  }

  function render() {
    if (!window.MapleCommunity) return;
    const fJob = els.filterJob ? els.filterJob.value.trim() : "";
    const allRecords = window.MapleCommunity.getRecords();
    const records = fJob ? allRecords.filter((r) => r.job === fJob) : allRecords;

    if (!records.length) {
      els.list.innerHTML =
        '<p class="cm-empty">目前還沒有玩家回報練功地點。遊戲上線後，去「社群經驗資料庫」分頁回報，這裡就會自動整理出建議。</p>';
      return;
    }

    const spots = groupByMap(records).sort((a, b) => {
      const aFit = isSuitable(a) ? 1 : 0;
      const bFit = isSuitable(b) ? 1 : 0;
      if (aFit !== bFit) return bFit - aFit;
      return b.avgExpPer10Min - a.avgExpPer10Min;
    });

    els.list.innerHTML =
      '<div class="cm-grid">' +
      spots
        .map((s) => {
          const fit = isSuitable(s);
          return `<div class="cm-card${fit ? " spot-fit" : ""}">
        <div class="cm-job">${escHtml(s.map)}${fit ? " ⭐" : ""}</div>
        <div class="cm-map">回報過的角色等級 Lv.${s.levelMin} - ${s.levelMax}</div>
        <div class="cm-stat"><span>平均 EXP / 10分鐘</span><span>${s.avgExpPer10Min.toLocaleString()}</span></div>
        <div class="cm-stat"><span>回報職業</span><span>${escHtml(s.jobs.join("、"))}</span></div>
        <div class="cm-note">💬 ${s.count} 筆回報</div>
      </div>`;
        })
        .join("") +
      "</div>";
  }

  if (els.filterJob) els.filterJob.addEventListener("change", render);

  els.addBtn.addEventListener("click", () => {
    window.MapleNav.switchNav("cm");
    if (window.MapleCommunity) window.MapleCommunity.openForm();
  });

  window.MapleSpots = { setCurrentLevel, render };
})();
