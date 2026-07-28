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
    levelInput: document.getElementById("spotsLevelInput"),
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
    // 計算機那邊改等級時同步顯示到本分頁的等級欄，讓「底色高亮依什麼判斷」
    // 有一個看得見的來源；使用者正在打字（欄位聚焦中）就不要蓋掉
    if (els.levelInput && document.activeElement !== els.levelInput) {
      els.levelInput.value = currentLevel;
    }
    render();
  }

  // 把同一張地圖的多筆回報合併成一個地點：平均效率、看過的等級範圍、回報過的職業。
  // 平均「只計單練」——團練的每人 EXP 通常遠高於單練（組隊經驗分配），混進
  // 平均會把地圖效率系統性拉高、誤導單練玩家，排序（推薦順位）也會跟著失真。
  // mode 是 2026-07-28 才加的欄位，沒有 mode 的歷史紀錄視為單練（跟表單預設
  // 一致）；團練筆數另外統計，卡片上標注「未計入平均」
  function groupByMap(records) {
    const groups = new Map();
    records.forEach((r) => {
      if (!groups.has(r.map)) {
        groups.set(r.map, { map: r.map, jobs: new Set(), levels: [], expRates: [], count: 0, partyCount: 0 });
      }
      const g = groups.get(r.map);
      g.jobs.add(r.job);
      g.levels.push(r.level);
      if (r.mode === "party") g.partyCount++;
      else g.expRates.push(r.expPer10Min);
      g.count++;
    });
    return Array.from(groups.values()).map((g) => ({
      map: g.map,
      jobs: Array.from(g.jobs),
      levelMin: Math.min(...g.levels),
      levelMax: Math.max(...g.levels),
      // 全部都是團練回報時沒有可平均的單練數據，avg 為 null，卡片顯示「僅團練回報」
      avgExpPer10Min: g.expRates.length
        ? Math.round(g.expRates.reduce((a, b) => a + b, 0) / g.expRates.length)
        : null,
      partyCount: g.partyCount,
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
      // 四種狀態要分開講：還在載入、讀取失敗（網路/App Check 問題）、選了職業
      // 但該職業沒人回報過（allRecords 有資料）、整個資料庫真的是空的。
      // 尤其「載入中」不能少——沒有它，資料還在路上的瞬間會先閃出
      // 「還沒人回報」的錯誤結論，慢速網路下會停留好幾秒
      els.list.innerHTML = window.MapleCommunity.isLoading()
        ? '<p class="cm-loading">載入中...</p>'
        : window.MapleCommunity.hasLoadFailed()
        // 失敗原因沿用 community.js 分好的訊息（離線／被拒絕／額度用完…），
        // 同一次失敗在「回報紀錄」跟這裡才不會講兩種粒度的話
        ? `<p class="cm-empty">${window.MapleCommunity.loadErrorMsg() || "載入失敗，請重新整理頁面"}</p>`
        : allRecords.length
          ? '<p class="cm-empty">這個職業目前還沒有練功地點回報，可以切換其他職業看看，或到「回報紀錄」子分頁貢獻第一筆！</p>'
          : '<p class="cm-empty">目前還沒有玩家回報練功地點。去「回報紀錄」子分頁回報，這裡就會自動整理出建議。</p>';
      els.pagination.innerHTML = "";
      return;
    }

    const spots = groupByMap(records).sort((a, b) => {
      const aFit = isSuitable(a) ? 1 : 0;
      const bFit = isSuitable(b) ? 1 : 0;
      if (aFit !== bFit) return bFit - aFit;
      // avg 為 null（僅團練回報、沒有單練基準）的排到同組最後
      return (b.avgExpPer10Min ?? -1) - (a.avgExpPer10Min ?? -1);
    });

    const totalPages = Math.max(1, Math.ceil(spots.length / MaplePagination.PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageSpots = MaplePagination.slice(spots, currentPage);

    els.list.innerHTML =
      '<div class="cm-grid">' +
      pageSpots
        .map((s) => {
          const fit = isSuitable(s);
          const partyNote = s.partyCount
            ? s.avgExpPer10Min === null
              ? `${s.count} 筆回報（全部為團練，效率為組隊數據）`
              : `${s.count} 筆回報（含 ${s.partyCount} 筆團練，未計入平均）`
            : `${s.count} 筆回報`;
          return `<div class="cm-card${fit ? " spot-fit" : ""}">
        <div class="cm-job">${escHtml(s.map)}</div>
        <div class="cm-map">回報過的角色等級 Lv.${s.levelMin} - ${s.levelMax}</div>
        <div class="cm-stat"><span>平均 EXP / 10分鐘${s.avgExpPer10Min === null ? "（僅團練）" : ""}</span><span>${s.avgExpPer10Min === null ? "—" : s.avgExpPer10Min.toLocaleString()}</span></div>
        <div class="cm-stat"><span>回報職業</span><span>${escHtml(s.jobs.join("、"))}</span></div>
        <div class="cm-note">${partyNote}</div>
      </div>`;
        })
        .join("") +
      "</div>";

    MaplePagination.render(els.pagination, {
      total: spots.length,
      page: currentPage,
      onChange: (p) => { currentPage = p; render(); },
    });
    // 統計只用已載入的批次（最近 N 筆），伺服器上還有更早的回報沒抓進來時
    // 要明講，不然這份建議看起來像全站統計；措辭跟回報紀錄頁的涵蓋提示一致
    if (window.MapleCommunity.hasMoreOnServer()) {
      els.pagination.insertAdjacentHTML(
        "beforeend",
        `<p class="cm-range-hint">建議目前依最近 ${allRecords.length} 筆回報統計，更早的回報可在「回報紀錄」子分頁往回載入</p>`
      );
    }
  }

  if (els.filterJob) els.filterJob.addEventListener("change", () => { currentPage = 1; render(); });
  // 直接在本分頁改等級也能重算高亮，不用繞回計算機
  if (els.levelInput) {
    els.levelInput.addEventListener("input", () => {
      const v = parseInt(els.levelInput.value, 10);
      currentLevel = v >= 1 && v <= 200 ? v : 1;
      currentPage = 1;
      render();
    });
  }

  els.addBtn.addEventListener("click", () => {
    if (window.MapleCommunity) {
      window.MapleCommunity.showRecordsTab();
      window.MapleCommunity.openForm();
    }
  });

  window.MapleSpots = { setCurrentLevel, render };
})();
