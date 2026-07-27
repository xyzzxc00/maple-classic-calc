/**
 * legacySpots.js — 舊版資料參考頁渲染
 */
(function () {
  function renderEntry(e) {
    return `<div class="legacy-entry">
      ${e.level ? `<span class="legacy-entry-level">Lv.${e.level}</span>` : ""}
      <span class="legacy-entry-monster">${e.monster}</span>
      <div class="legacy-entry-locations">${e.locations}</div>
      ${e.respawn ? `<div class="legacy-entry-respawn">重生時間：${e.respawn}</div>` : ""}
    </div>`;
  }

  function renderTier(t) {
    return `<div class="legacy-spot-card">
      <div class="legacy-spot-level">Lv.${t.levelRange}</div>
      ${t.entries.map(renderEntry).join("")}
      ${t.note ? `<div class="legacy-spot-note">${t.note}</div>` : ""}
    </div>`;
  }

  // 資料檔（legacySpotsData.js）沒載入成功時，`|| []` 會渲染出整片空白、只剩
  // 免責聲明孤零零掛著。跟 jobs.js 的兜底比照辦理，明講載入失敗
  const DATA_MISSING_MSG = '<p class="cm-empty">資料載入失敗，請重新整理頁面</p>';

  const spotsList = document.getElementById("legacySpotsList");
  if (spotsList) {
    const tiers = window.MapleLegacySpots || [];
    spotsList.innerHTML = tiers.length ? tiers.map(renderTier).join("") : DATA_MISSING_MSG;
  }

  const bossList = document.getElementById("legacyBossList");
  if (bossList) {
    const bosses = window.MapleLegacyBosses || [];
    bossList.innerHTML = bosses.length
      ? `<div class="legacy-spot-card">${bosses.map(renderEntry).join("")}</div>`
      : DATA_MISSING_MSG;
  }

  function renderPrequest(p) {
    return `<div class="legacy-spot-card">
      <div class="legacy-spot-level">${p.boss}</div>
      <div class="boss-prequest-level">${p.levelReq}</div>
      <ol class="boss-prequest-steps">
        ${p.steps
          .map(
            (s) => `<li class="boss-prequest-step">
              <div class="boss-prequest-step-title">${s.title}</div>
              <div class="boss-prequest-step-desc">${s.desc}</div>
            </li>`
          )
          .join("")}
      </ol>
      ${p.note ? `<div class="legacy-spot-note">${p.note}</div>` : ""}
    </div>`;
  }

  const bossPrequestList = document.getElementById("legacyBossPrequestList");
  if (bossPrequestList) {
    const prequests = window.MapleLegacyBossPrequests || [];
    bossPrequestList.innerHTML = prequests.length ? prequests.map(renderPrequest).join("") : DATA_MISSING_MSG;
  }

  // 照職業系分組，每條路線各自收合。標題不再寫成「職業系｜路線」，因為
  // 職業系已經是分組標題了，重複寫在每張卡片上只是佔掉手機版的寬度。
  // 預設全部收起來：一到四轉的說明加上信心度本來就長，十二條路線攤開的話
  // 這個分頁會長到捲不完

  // 信心度／衝突點／各種但書原本是一整段跑完，讀起來很吃力，所以拆成
  // 帶標籤的區塊；衝突點通常有好幾條，資料裡是陣列的就直接列點
  function renderJobBuildNote(n) {
    const body = n.list
      ? `<ul class="legacy-job-note-list">${n.list.map((i) => `<li>${i}</li>`).join("")}</ul>`
      : `<p class="legacy-job-note-body">${n.body}</p>`;
    return `<div class="legacy-job-note">
      <div class="legacy-job-note-label">${n.label}</div>
      ${body}
    </div>`;
  }

  function renderJobBuildPath(p) {
    const notes = p.notes || [];
    return `<details class="legacy-job-path">
      <summary>${p.route}</summary>
      <div class="legacy-job-path-body">
        <ol class="boss-prequest-steps">
          ${p.stages
            .map(
              (s) => `<li class="boss-prequest-step">
                <div class="boss-prequest-step-title">${s.tier}</div>
                <div class="boss-prequest-step-desc">${s.note}</div>
              </li>`
            )
            .join("")}
        </ol>
        ${notes.length ? `<div class="legacy-job-notes">${notes.map(renderJobBuildNote).join("")}</div>` : ""}
      </div>
    </details>`;
  }

  function renderJobBuildBranch(b) {
    return `<section class="legacy-job-branch">
      <h3 class="legacy-job-branch-title">${b.branch}</h3>
      <div class="legacy-job-paths">${b.paths.map(renderJobBuildPath).join("")}</div>
    </section>`;
  }

  const jobBuildsList = document.getElementById("legacyJobBuildsList");
  if (jobBuildsList) {
    const branches = window.MapleLegacyJobBuilds || [];
    // 空陣列（資料還沒整理進來）跟「載入失敗」是兩回事，不要共用
    // DATA_MISSING_MSG 那句「資料載入失敗」，會誤導使用者以為網站壞了
    jobBuildsList.innerHTML = branches.length
      ? branches.map(renderJobBuildBranch).join("")
      : '<p class="cm-empty">職業配點資料整理中，之後會陸續補上。</p>';
  }

  const subSpotsBtn = document.getElementById("legacySubSpots");
  const subBossesBtn = document.getElementById("legacySubBosses");
  const subBossPrequestsBtn = document.getElementById("legacySubBossPrequests");
  const subJobBuildsBtn = document.getElementById("legacySubJobBuilds");
  const spotsView = document.getElementById("legacySpotsView");
  const bossView = document.getElementById("legacyBossView");
  const bossPrequestView = document.getElementById("legacyBossPrequestView");
  const jobBuildsView = document.getElementById("legacyJobBuildsView");
  if (!subSpotsBtn || !subBossesBtn || !subBossPrequestsBtn || !subJobBuildsBtn || !spotsView || !bossView || !bossPrequestView || !jobBuildsView) return;

  const STORAGE_KEY = "maple_classic_legacy_subtab";

  const tabs = [
    { btn: subSpotsBtn, view: spotsView, key: "spots" },
    { btn: subBossesBtn, view: bossView, key: "bosses" },
    { btn: subBossPrequestsBtn, view: bossPrequestView, key: "bossPrequests" },
    { btn: subJobBuildsBtn, view: jobBuildsView, key: "jobBuilds" },
  ];

  function showTab(key, skipSave) {
    tabs.forEach((t) => {
      const active = t.key === key;
      t.view.hidden = !active;
      t.btn.classList.toggle("active", active);
      t.btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (!skipSave) localStorage.setItem(STORAGE_KEY, key);
  }

  tabs.forEach((t) => t.btn.addEventListener("click", () => showTab(t.key)));

  // 網址錨點 #legacy-<subtab>（例如 guides 文章連的 #legacy-bosses）比
  // localStorage 的舊紀錄優先，跟 nav.js 處理 #calc-* 的規則一致
  const [hashMain, hashSub] = location.hash.slice(1).split("-");
  const hashTab = hashMain === "legacy" && tabs.some((t) => t.key === hashSub) ? hashSub : null;
  const savedTab = localStorage.getItem(STORAGE_KEY);
  const initialTab = hashTab || savedTab;
  if (tabs.some((t) => t.key === initialTab)) showTab(initialTab, true);
})();
