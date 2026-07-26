/**
 * formGuard.js — 表單欄位字數硬上限（社群四板共用）
 * -----------------------------------------------------------------
 * 原生 maxlength 對「貼上一大段文字」或中文輸入法組字這種情境不一定
 * 每個瀏覽器都會確實擋下來；超長字串送到 Firestore 會被規則整筆拒絕，
 * 前端只會看到「送出被資料庫拒絕」這種誤導訊息。這裡主動裁切，保證
 * 欄位值真的不會超過上限。
 *
 * 中文／日文輸入法組字期間也會觸發 input 事件——這個時候如果動手改
 * el.value，會打斷瀏覽器正在處理的組字狀態（畫面上那段還加底線、還沒
 * 定案的暫存文字），導致打到一半的字被打斷或吃掉。組字中只更新顯示的
 * 字數，真正裁切要等 compositionend（組字定案）之後再做。
 * -----------------------------------------------------------------
 */
(function () {
  /**
   * @param {HTMLInputElement|HTMLTextAreaElement} el
   * @param {number} max - 字數上限（跟 HTML maxlength 與 firestore.rules 同值）
   * @param {HTMLElement} [countEl] - 選填：「N / MAX 字」即時計數元素
   * @returns {Function} update - 手動重算一次（表單重開時歸零計數用）
   */
  function attach(el, max, countEl) {
    // 快到上限的變色警示門檻：長欄位保留 20 字，短欄位按比例縮小
    const reserve = Math.min(20, Math.max(5, Math.round(max * 0.1)));
    let composing = false;
    const update = () => {
      if (!composing && el.value.length > max) {
        el.value = el.value.slice(0, max);
      }
      if (countEl) {
        const len = el.value.length;
        countEl.textContent = `${len} / ${max} 字`;
        countEl.classList.toggle("near-limit", len >= max - reserve);
      }
    };
    el.addEventListener("compositionstart", () => { composing = true; });
    el.addEventListener("compositionend", () => { composing = false; update(); });
    el.addEventListener("input", update);
    return update;
  }

  window.MapleFormGuard = { attach };
})();
