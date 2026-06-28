/**
 * community.js — 社群經驗資料庫（Firebase Firestore）
 */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyBpx9FoF2kKfgv3_VCoSJHnCBRVCjLu8iM",
    authDomain: "maple-classic-calc.firebaseapp.com",
    projectId: "maple-classic-calc",
    storageBucket: "maple-classic-calc.firebasestorage.app",
    messagingSenderId: "468368517060",
    appId: "1:468368517060:web:d9c9deb8390d32089f2691",
  };

  const PAGE_SIZE = 50;
  const VOTED_KEY = "maple_classic_voted";

  let db = null;
  if (firebaseConfig.apiKey && window.firebase) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }

  const els = {
    filterJob: document.getElementById("cmFilterJob"),
    filterMap: document.getElementById("cmFilterMap"),
    filterLvMin: document.getElementById("cmFilterLvMin"),
    filterLvMax: document.getElementById("cmFilterLvMax"),
    sortBtns: document.querySelectorAll(".cm-sort-btn"),
    addBtn: document.getElementById("cmAddBtn"),
    form: document.getElementById("cmForm"),
    job: document.getElementById("cmJob"),
    map: document.getElementById("cmMap"),
    level: document.getElementById("cmLevel"),
    expPer10Min: document.getElementById("cmExpPer10Min"),
    note: document.getElementById("cmNote"),
    submitBtn: document.getElementById("cmSubmitBtn"),
    cancelBtn: document.getElementById("cmCancelBtn"),
    msg: document.getElementById("cmMsg"),
    list: document.getElementById("cmList"),
    loadMore: document.getElementById("cmLoadMore"),
  };

  let allRecords = [];
  let lastDoc = null;
  let formOpen = false;

  function getVotedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(VOTED_KEY)) || []); } catch { return new Set(); }
  }
  function saveVote(id) {
    const s = getVotedSet();
    s.add(id);
    localStorage.setItem(VOTED_KEY, JSON.stringify([...s]));
  }

  function parseExpVal(val) {
    if (!val || !val.trim()) return NaN;
    const s = val.trim().toUpperCase().replace(/[,\s]/g, "");
    if (s.endsWith("W")) {
      const n = parseFloat(s.slice(0, -1));
      return isNaN(n) ? NaN : n * 10000;
    }
    return parseFloat(s);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatTS(date) {
    return date.toLocaleDateString("zh-TW") + " " + date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }

  function toggleForm() {
    formOpen = !formOpen;
    els.form.hidden = !formOpen;
    els.addBtn.textContent = formOpen ? "✕ 收起" : "＋ 新增紀錄";
  }

  els.addBtn.addEventListener("click", toggleForm);
  els.cancelBtn.addEventListener("click", toggleForm);

  function openForm() {
    if (!formOpen) toggleForm();
    setTimeout(() => {
      els.form.scrollIntoView({ behavior: "smooth", block: "center" });
      els.job.focus();
    }, 150);
  }

  function openFormWithExpPer10Min(val) {
    openForm();
    els.expPer10Min.value = val;
  }

  async function submitRecord() {
    const job = els.job.value.trim();
    const map = els.map.value.trim();
    const level = parseInt(els.level.value, 10);
    const expPer10Min = parseExpVal(els.expPer10Min.value);
    const note = els.note.value.trim();

    if (!job || !map || isNaN(level) || level < 1 || isNaN(expPer10Min) || expPer10Min <= 0) {
      els.msg.textContent = "請填寫所有必填欄位（*）";
      els.msg.className = "cm-msg err";
      return;
    }
    if (!db) {
      els.msg.textContent = "社群資料庫尚未設定，遊戲上線前無法送出";
      els.msg.className = "cm-msg err";
      return;
    }

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "送出中...";
    els.msg.textContent = "";

    try {
      await db.collection("exp_records").add({
        job, map, level,
        expPer10Min: Math.round(expPer10Min),
        helpful: 0,
        ...(note && { note }),
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已送出！感謝分享";
      els.msg.className = "cm-msg ok";
      els.job.value = ""; els.map.value = "";
      els.level.value = ""; els.expPer10Min.value = ""; els.note.value = "";
      allRecords = []; lastDoc = null;
      await loadRecords();
      if (window.MapleSpots) window.MapleSpots.render();
    } catch (e) {
      els.msg.textContent = "送出失敗，請稍後再試";
      els.msg.className = "cm-msg err";
    } finally {
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "送出";
    }
  }

  els.submitBtn.addEventListener("click", submitRecord);

  async function loadRecords(append = false) {
    if (!db) {
      els.list.innerHTML = '<p class="cm-empty">社群資料庫尚未開放（遊戲還沒上線），敬請期待。</p>';
      if (els.loadMore) els.loadMore.hidden = true;
      return;
    }
    if (!append) {
      els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
      allRecords = [];
      lastDoc = null;
    }

    try {
      let query = db.collection("exp_records").orderBy("ts", "desc").limit(PAGE_SIZE);
      if (append && lastDoc) query = query.startAfter(lastDoc);

      const snap = await query.get();
      const newRecords = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      lastDoc = snap.docs[snap.docs.length - 1] || null;
      allRecords = append ? [...allRecords, ...newRecords] : newRecords;

      if (els.loadMore) els.loadMore.hidden = snap.docs.length < PAGE_SIZE;
      renderRecords();
    } catch (e) {
      els.list.innerHTML = '<p class="cm-empty">載入失敗，請重新整理頁面</p>';
    }
  }

  function renderRecords() {
    const fJob = els.filterJob.value.trim().toLowerCase();
    const fMap = els.filterMap.value.trim().toLowerCase();
    const fLvMin = parseInt(els.filterLvMin.value, 10) || 0;
    const fLvMax = parseInt(els.filterLvMax.value, 10) || 999;
    const activeSort = document.querySelector(".cm-sort-btn.active");
    const sortBy = activeSort ? activeSort.dataset.sort : "time";

    const filtered = allRecords
      .filter((r) =>
        (!fJob || r.job.toLowerCase().includes(fJob)) &&
        (!fMap || r.map.toLowerCase().includes(fMap)) &&
        r.level >= fLvMin && r.level <= fLvMax
      )
      .sort((a, b) => {
        if (sortBy === "exp") return b.expPer10Min - a.expPer10Min;
        const ta = a.ts && a.ts.toDate ? a.ts.toDate() : new Date(0);
        const tb = b.ts && b.ts.toDate ? b.ts.toDate() : new Date(0);
        return tb - ta;
      });

    if (!filtered.length) {
      els.list.innerHTML = '<p class="cm-empty">沒有符合條件的紀錄</p>';
      return;
    }

    const voted = getVotedSet();
    els.list.innerHTML =
      '<div class="cm-grid">' +
      filtered.map((r) => {
        const tsText = r.ts && r.ts.toDate ? formatTS(r.ts.toDate()) : "—";
        const hasVoted = voted.has(r.id);
        return `<div class="cm-card">
          <div class="cm-job">${escHtml(r.job)}</div>
          <div class="cm-map">📍 ${escHtml(r.map)}</div>
          <div class="cm-stat"><span>角色等級</span><span>Lv.${r.level}</span></div>
          <div class="cm-stat"><span>EXP / 10分鐘</span><span>${r.expPer10Min.toLocaleString()}</span></div>
          ${r.note ? `<div class="cm-note">💬 ${escHtml(r.note)}</div>` : ""}
          <div class="cm-card-footer">
            <span class="cm-ts">${tsText}</span>
            <button class="cm-helpful-btn${hasVoted ? " voted" : ""}" data-id="${r.id}" ${hasVoted ? "disabled" : ""} type="button">
              👍 <span class="cm-helpful-count">${r.helpful || 0}</span>
            </button>
          </div>
        </div>`;
      }).join("") +
      "</div>";

    els.list.addEventListener("click", onHelpfulClick, { once: true });
  }

  function onHelpfulClick(e) {
    const btn = e.target.closest(".cm-helpful-btn");
    if (!btn || btn.disabled) {
      els.list.addEventListener("click", onHelpfulClick, { once: true });
      return;
    }
    const id = btn.dataset.id;
    if (!db || getVotedSet().has(id)) return;

    btn.disabled = true;
    db.collection("exp_records").doc(id).update({
      helpful: firebase.firestore.FieldValue.increment(1),
    }).then(() => {
      saveVote(id);
      btn.classList.add("voted");
      const countEl = btn.querySelector(".cm-helpful-count");
      if (countEl) countEl.textContent = parseInt(countEl.textContent || "0") + 1;
      const rec = allRecords.find((r) => r.id === id);
      if (rec) rec.helpful = (rec.helpful || 0) + 1;
    }).catch(() => { btn.disabled = false; });

    els.list.addEventListener("click", onHelpfulClick, { once: true });
  }

  if (els.loadMore) {
    els.loadMore.addEventListener("click", () => loadRecords(true));
  }

  els.filterJob.addEventListener("change", renderRecords);
  els.sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.sortBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderRecords();
    });
  });
  [els.filterMap, els.filterLvMin, els.filterLvMax].forEach((el) =>
    el.addEventListener("input", renderRecords)
  );

  window.MapleCommunity = {
    loadRecords,
    openForm,
    openFormWithExpPer10Min,
    getRecords: () => allRecords,
  };
})();
