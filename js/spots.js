/**
 * spots.js — 建議練功地點
 * -----------------------------------------------------------------
 * 不再用猜的佔位資料，改成把「社群資料庫」(community.js / Firestore
 * exp_records) 裡玩家回報的紀錄，依地圖分組算平均效率，依目前等級排序，
 * 整理成「現在最適合去哪裡練」的建議列表。
 * -----------------------------------------------------------------
 */
(function () {
  const els = {
    list: document.getElementById("spotsList"),
    pagination: document.getElementById("spotsPagination"),
    addBtn: document.getElementById("spotsAddBtn"),
    filterJob: document.getElementById("spotsFilterJob"),
  };

  // 職業選單改由 jobsData.js 的單一資料來源動態產生，避免 HTML 裡多份清單各自維護
  if (window.MapleJobOptionsHtml && els.filterJob) {
    els.filterJob.insertAdjacentHTML("beforeend", window.MapleJobOptionsHtml);
  }

  let currentLevel = 1;
  let currentPage = 1;

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
    // 分頁隱藏時不用重繪（計算機每次輸入都會呼叫 setCurrentLevel → render）；
    // 切回本分頁／子分頁時會再觸發一次 render，不會漏更新
    if (document.getElementById("pageCm").hidden || document.getElementById("cmSuggestView").hidden) return;
    const fJob = els.filterJob ? els.filterJob.value.trim() : "";
    const allRecords = window.MapleCommunity.getRecords();
    const records = fJob ? allRecords.filter((r) => r.job === fJob) : allRecords;

    if (!records.length) {
      // 讀取真的失敗（網路/App Check 問題）跟「還沒人回報」是兩回事，
      // 不然使用者遇到問題時只會看到「還沒人回報」，以為是正常狀態
      els.list.innerHTML = window.MapleCommunity.hasLoadFailed()
        ? '<p class="cm-empty">載入失敗，請重新整理頁面</p>'
        : '<p class="cm-empty">目前還沒有玩家回報練功地點。遊戲上線後，去「回報紀錄」子分頁回報，這裡就會自動整理出建議。</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const spots = groupByMap(records).sort((a, b) => {
      const aFit = isSuitable(a) ? 1 : 0;
      const bFit = isSuitable(b) ? 1 : 0;
      if (aFit !== bFit) return bFit - aFit;
      return b.avgExpPer10Min - a.avgExpPer10Min;
    });

    const totalPages = Math.max(1, Math.ceil(spots.length / MaplePagination.PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageSpots = MaplePagination.slice(spots, currentPage);

    els.list.innerHTML =
      '<div class="cm-grid">' +
      pageSpots
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

    MaplePagination.render(els.pagination, {
      total: spots.length,
      page: currentPage,
      onChange: (p) => { currentPage = p; render(); },
    });
  }

  if (els.filterJob) els.filterJob.addEventListener("change", () => { currentPage = 1; render(); });

  els.addBtn.addEventListener("click", () => {
    if (window.MapleCommunity) {
      window.MapleCommunity.showRecordsTab();
      window.MapleCommunity.openForm();
    }
  });

  window.MapleSpots = { setCurrentLevel, render };
})();
