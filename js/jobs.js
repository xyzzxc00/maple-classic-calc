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

  function renderStage(s) {
    return `<div class="job-stage">
      <span class="job-stage-tier">${s.tier}</span>
      <span class="job-stage-level">Lv.${s.level}</span>
      <p class="job-stage-note">${s.note}</p>
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
        <button class="job-expand-btn" data-job="${job.id}" type="button" aria-expanded="false">看二轉／三轉／四轉關卡 ▾</button>
        <div class="job-later-stages" id="laterStages-${job.id}" hidden>${(job.laterQuests || []).map(renderStage).join("")}</div>
      </div>`
    ).join("");
  }

  // 委派監聽器，展開/收合每個職業卡片的後續轉職關卡
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".job-expand-btn");
    if (!btn) return;
    const panel = document.getElementById(`laterStages-${btn.dataset.job}`);
    if (!panel) return;
    const expanded = !panel.hidden;
    panel.hidden = expanded;
    btn.setAttribute("aria-expanded", String(!expanded));
    btn.textContent = expanded ? "看二轉／三轉／四轉關卡 ▾" : "收起 ▴";
  });

  render();
})();
