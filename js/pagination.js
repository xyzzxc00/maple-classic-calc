/**
 * pagination.js — 「建議練功地點」/「回報紀錄」清單共用的頁碼分頁
 */
(function () {
  const PAGE_SIZE = 15;

  // items 已經是篩選/排序後的完整陣列；回傳目前這一頁該顯示的子陣列。
  // pageSize 預設用共用的 15（回報紀錄／建議練功地點），組隊揪團／擺攤
  // 資訊這種量級小很多的公告板可以傳自己的頁面大小（例如 30），不用
  // 兩邊共用同一個數字
  function slice(items, page, pageSize = PAGE_SIZE) {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  // 頁碼太多時只顯示目前頁附近幾個 + 頭尾，中間用「…」省略
  function pageNumbers(current, total) {
    const pages = new Set([1, total, current, current - 1, current + 1]);
    return [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  }

  // hasMore：資料來源（例如 Firestore）在目前這批之後還有沒抓進來的資料。
  // 為 true 時最後一頁的「›」不能鎖死——呼叫端靠「翻超過 totalPages」這個
  // 訊號去補抓下一批；之前這顆按鈕在最後一頁永遠 disabled，使用者沒有任何
  // 操作能觸發補抓，第 51 筆以後的資料從 UI 上就永遠到不了
  function render(container, { total, page, onChange, hasMore, pageSize = PAGE_SIZE }) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (totalPages <= 1 && !hasMore) {
      container.innerHTML = "";
      return;
    }
    const nums = pageNumbers(page, totalPages);
    let html = `<button class="cm-page-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} type="button">‹</button>`;
    let prev = 0;
    nums.forEach((n) => {
      if (n - prev > 1) html += `<span class="cm-page-ellipsis">…</span>`;
      html += `<button class="cm-page-btn${n === page ? " active" : ""}" data-page="${n}" type="button">${n}</button>`;
      prev = n;
    });
    html += `<button class="cm-page-btn" data-page="${page + 1}" ${page >= totalPages && !hasMore ? "disabled" : ""} type="button">›</button>`;
    container.innerHTML = html;
    container.querySelectorAll(".cm-page-btn").forEach((btn) => {
      btn.addEventListener("click", () => onChange(parseInt(btn.dataset.page, 10)));
    });
  }

  window.MaplePagination = { PAGE_SIZE, slice, render };
})();
