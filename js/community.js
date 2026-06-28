/**
 * community.js — 社群經驗資料庫（Firebase Firestore）
 * -----------------------------------------------------------------
 * 重要：firebaseConfig 目前是空殼佔位，這個分頁在填入真實設定前
 * 不會送出/讀取任何資料（會顯示提示訊息），不影響其他分頁運作。
 *
 * 設定方式：
 * 1. 去 https://console.firebase.google.com 開一個新專案（例如 maple-classic-calc）
 * 2. 建立 Firestore Database（地區選 asia-east1 或 asia-northeast1 都可以）
 * 3. 專案設定 → 一般 → 你的應用程式 → 新增網頁應用程式，複製 firebaseConfig 貼到下面
 * 4. Firestore 規則建議：允許任何人 create / read exp_records，但不能 update / delete 別人的資料
 * -----------------------------------------------------------------
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

  const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

  let db = null;
  if (isConfigured && window.firebase) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }

  const els = {
    filterJob: document.getElementById("cmFilterJob"),
    filterMap: document.getElementById("cmFilterMap"),
    filterLvMin: document.getElementById("cmFilterLvMin"),
    filterLvMax: document.getElementById("cmFilterLvMax"),
    sort: document.getElementById("cmSort"),
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
  };

  let allRecords = [];
  let formOpen = false;

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
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function openFormWithExpPer10Min(expPer10Min) {
    openForm();
    els.expPer10Min.value = expPer10Min;
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
      els.msg.textContent = "社群資料庫尚未設定，遊戲上線前無法送出，先記在自己這邊";
      els.msg.className = "cm-msg err";
      return;
    }

    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "送出中...";
    els.msg.textContent = "";

    try {
      await db.collection("exp_records").add({
        job,
        map,
        level,
        expPer10Min: Math.round(expPer10Min),
        ...(note && { note }),
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
      els.msg.textContent = "✓ 已送出！感謝分享";
      els.msg.className = "cm-msg ok";
      els.job.value = "";
      els.map.value = "";
      els.level.value = "";
      els.expPer10Min.value = "";
      els.note.value = "";
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

  async function loadRecords() {
    if (!db) {
      els.list.innerHTML = '<p class="cm-empty">社群資料庫尚未開放（遊戲還沒上線），敬請期待 7/1 事前登錄後的更新。</p>';
      return;
    }
    els.list.innerHTML = '<p class="cm-loading">載入中...</p>';
    try {
      const snap = await db.collection("exp_records").orderBy("ts", "desc").limit(200).get();
      allRecords = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

    const sortBy = els.sort ? els.sort.value : "time";

    const filtered = allRecords
      .filter(
        (r) =>
          (!fJob || r.job.toLowerCase().includes(fJob)) &&
          (!fMap || r.map.toLowerCase().includes(fMap)) &&
          r.level >= fLvMin &&
          r.level <= fLvMax
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

    els.list.innerHTML =
      '<div class="cm-grid">' +
      filtered
        .map((r) => {
          const tsText = r.ts && r.ts.toDate ? formatTS(r.ts.toDate()) : "—";
          return `<div class="cm-card">
        <div class="cm-job">${escHtml(r.job)}</div>
        <div class="cm-map">📍 ${escHtml(r.map)}</div>
        <div class="cm-stat"><span>角色等級</span><span>Lv.${r.level}</span></div>
        <div class="cm-stat"><span>EXP / 10分鐘</span><span>${r.expPer10Min.toLocaleString()}</span></div>
        ${r.note ? `<div class="cm-note">💬 ${escHtml(r.note)}</div>` : ""}
        <div class="cm-ts">${tsText}</div>
      </div>`;
        })
        .join("") +
      "</div>";
  }

  els.filterJob.addEventListener("change", renderRecords);
  if (els.sort) els.sort.addEventListener("change", renderRecords);
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
