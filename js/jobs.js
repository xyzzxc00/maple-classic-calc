/**
 * jobs.js — 職業介紹頁渲染
 */
(function () {
  const list = document.getElementById("jobsList");

  function renderPath(p) {
    return `
      <div class="job-path">
        <span class="job-path-step">${p.second}</span>
        <span class="job-path-arrow">→</span>
        <span class="job-path-step">${p.third}</span>
        <span class="job-path-arrow">→</span>
        <span class="job-path-step job-path-final">${p.fourth}</span>
        <span class="job-path-note">${p.note}</span>
      </div>`;
  }

  function renderFirstQuest(q) {
    if (!q) return "";
    return `<div class="job-first-quest">
      <span class="job-quest-label">🗨 一轉任務</span>
      Lv.${q.level}＋${q.stat} → 到「${q.city}」找 ${q.npc} 完成考驗
    </div>`;
  }

  function render() {
    list.innerHTML = window.MapleJobsData.map(
      (job) => `
      <div class="job-card">
        <div class="job-card-head">
          <span class="job-icon">${job.icon}</span>
          <div>
            <div class="job-branch">${job.branch}</div>
            <div class="job-first">一轉：${job.firstJob}</div>
          </div>
        </div>
        <p class="job-desc">${job.desc}</p>
        ${renderFirstQuest(job.firstQuest)}
        <div class="job-paths">${job.paths.map(renderPath).join("")}</div>
      </div>`
    ).join("");
  }

  render();
})();
