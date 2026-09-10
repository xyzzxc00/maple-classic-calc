# 9/10 資料換期與新版 HUD 檢查

日期：2026-09-10。範圍：既有資料庫、轉蛋模擬、任務／職業攻略、實用情報與自動測速。使用 site-audit 流程分別檢查資料、服務、部署及 UI；不增加時裝／美容資料庫。

標記：`verified-live` 表示實際命令、瀏覽器或線上服務驗證（另註本機／合成）；`code-inference` 表示程式或來源對照；`unchecked` 表示未實際驗證。合成畫面不等於實體裝置擷取。

## 資料與官方範圍

- `verified-live`：[9/10 官方開機公告](https://maplestoryclassic.beanfun.com/bulletin?Bid=82647)仍列二轉、Lv.100。三轉、天空之城與冰原雪域繼續獨立預覽，不混入現行練功建議。
- `verified-live`：[冒險家戒指第一階段](https://maplestoryclassic-event.beanfun.com/EventAd/EventAd?eventAdId=19112)為 Lv.30 起、9/10 維護後常態任務。生命 HP+500、靈魂 MP+500、調和 HP/MP 各+250；後續強化未開放，補發 NPC 與成本不推測。
- `code-inference`：客戶端 1.15.0 資料只納入現行關聯及明確允許的戒指第一階段，排除菇菇王國、未核准戒指階段與特殊月光水晶任務。新增 56 筆任務、34 張關聯地圖、27 件道具、7 位 NPC。

| 類型 | 現行資料 | 預覽聯集（含現行） |
| --- | ---: | ---: |
| 怪物 | 71 | 145 |
| 地圖 | 387 | 470 |
| 道具 | 1,470 | 1,926 |
| NPC | 243 | 269 |
| 任務 | 320 | 320 |
| 技能 | 208 | 208 |

- `verified-live`（本機）：索引、詳情、跨資料集連結及圖片檢查通過；新增 68 張引用圖片、170,571 bytes。既有圖片與 14 張人工校正未覆蓋；缺圖繼續留白。鋼豬 99 EXP、珍白水 310、檸檬過期警告移除、BOSS 楓幣未知等保護檢查通過。
- `verified-live`（本機重建）：2,709 個現行 JSON 與 3,347 個預覽 JSON 重跑一致。卷軸模擬 977 件裝備、111 種卷軸，610 件天然浮動裝備共 1,444 欄位檢查通過。
- `unchecked`：未進遊戲走完全部任務、實測通行／重生或確認戒指補發 NPC。資料檔流程不冒充遊戲實測。

## 轉蛋換期

`verified-live`：逐列核對官方 API 的名稱、機率、分級與日期。顯示原始公布機率，抽取時僅依總權重換算，不自行改寫小數誤差。

| 獎池 | 項數 | 公告機率合計 | 官方機率表期間 |
| --- | ---: | ---: | --- |
| 閃亮彗星 | 35 | 100.06% | 9/10 09:00～9/24 07:59 |
| 璀璨彗星 | 58 | 100.01% | 同上 |
| 男女皇家美髮／整形 | 各 12 | 各 100% | 9/10 09:00～9/23 23:59 |
| 轉蛋機 | 101 | 99.97% | 9/10 09:00～10/6 23:59 |

資料：[彗星](https://maplestoryclassic-event.beanfun.com/EventAd/EventAd?eventAdId=18945)、[皇家美容院](https://maplestoryclassic-event.beanfun.com/EventAd/EventAd?eventAdId=18938)、[轉蛋機](https://maplestoryclassic-event.beanfun.com/EventAd/EventAd?eventAdId=19046)。表上 09:00 與維護公告實際開機 10:00 分開呈現。

- 璀璨三組男女共用機率只計一次；不含本期聯名獎項。不模擬性別限制與重分配。
- 已取得過的轉蛋道具繼續可查；兩期轉蛋機各 101 項、合計 105 種道具，沒有以新一期覆蓋舊取得紀錄。
- `verified-live`（本機／瀏覽器）：七池單抽／十連、切換統計、只重置當前池皆通過；未知圖示不補錯圖。

## 自動測速

- `verified-live`（使用者原始截圖）：實際圖片 1367×768（回報解析度為 1366×768），正確讀出 Lv.63、EXP 1,208,864、85.13%。舊版定位無法命中，已以新候選與色塊定位修正。
- 修正縮放後小數點黏住「1」、EXP 首位「1」被截掉、OCR 校準 padding 位移。逐筆驗證等級／EXP／百分比，移除錯誤讀值重複出現即可放行的備援。
- 限制複雜背景搜尋：最多 512 次配對、48 次 EXP、16 次等級辨識；先找徽章附近同列，不再對整個底帶無界配對。
- 校準有 15 秒逾時及取消；世代所屬鎖防止舊校準回寫或釋放新鎖，停止／重新定位不必等舊 worker 完成。worker 終止與重建不重疊。
- `verified-live`（Node 合成）：3,184 組等級、3,184 組 EXP／百分比、1,194 組小數縮放、190 組裁切；另有 14 組新版 HUD 解析度／縮放、偏移、尺寸變更、錯值拒收、密集雜訊與非同步校準測試。
- `verified-live`（瀏覽器原生 Canvas 合成）：10 組，1366/1367×768、1920×1080/1200、2560×1440、3440×1440、3840×2160、5120×1440，含 125/150/175/200/300% 縮放；皆讀到預期數字，靜止畫面不增加經驗。
- 僅保存等級／EXP 去識別化像素作回歸 fixture，不保存角色、聊天或完整截圖。`tools/test_expocr_browser.html` 為本機手動測試，不複製至部署目錄。
- `unchecked`：實體 2K／4K、多螢幕 Windows DPI、壓縮串流、HDR、瀏覽器擷取選擇器及真實 worker 生命週期尚未逐機驗證。內建瀏覽器不提供畫面分享入口；不宣稱已完成真實遊戲連續測速。

## UI／UX、桌面與手機

- `verified-live`（編譯版、本機瀏覽器）：320/375px 七個獎池無文件橫向溢出；十連結果、期間、長名稱及非零長條可顯示。長條改成 block，窄螢幕統計分行。
- `verified-live`（1366×768）：四個玩法攻略各自切到社群「實用情報」都成功；戒指攻略可到生命戒指詳情，顯示 HP+500 與官方取得連結。
- `verified-live`（375px）：戒指詳情、暗色新版情報可讀；未開放預览與目前資料提示保持分離。網址與動態文字皆做轉義，官方道具連結限 HTTPS 官方網域。
- `code-inference`：660px 以下測速浮窗改靠右 12px，避免原 right:332px 在窄視窗超出左邊。真正 PiP 視窗與跨瀏覽器操作未實測。
- 攻略新增菇菇通行證 Season 1 的角色綁定、刪角不重選、獎勵到期提醒；不把新通行證誤算成常駐 10% 經驗。依[官方活動說明](https://maplestoryclassic-event.beanfun.com/EventAd/EventAd?eventAdId=19111)。
- 職業指南改為現行二轉的名稱、武器與玩法，移除無依據的強弱排名；火毒舊心得旁註 9/10 官方中毒修正，保留原社群引用與日期。
- `code-inference`（色值計算）：抽卡／預覽／OCR 相關亮暗色文字對比均超過 4.5:1。`unchecked`：實體 iOS／Android、輔助閱讀器未驗證。

## Firebase

- `verified-live`：Firestore `(default)`、asia-east1、Native Standard；刪除保護開啟、PITR 關閉。部署規則與本機一致，App Check ENFORCED。
- `verified-live`＋`code-inference`：現有 `ts desc` 游標查詢無需複合索引，未見缺索引失敗。本次無新查詢、權限調整或正式社群寫入。
- 待另案處理 P2（`code-inference`，本機隔離重現）：社群刪除按鈕共用 helpful class，可能先觸發按讚；寫入 15 秒逾時後重試 `.add()` 可能重複回報。不屬於本次資料／測速改動，未修改或操作玩家紀錄。
- `unchecked`：費用、預算提醒、備份排程與正式寫入流程。

## GitHub／CI

- `verified-live`：作業開始前最近 20 次部署皆成功，主分支禁止 force push／刪除，沒有待處理公開 issue／PR。
- 修正 Bash `mapfile < <(producer)` 會吞掉清單產生器失敗狀態：先賦值檢查 exit status，再讀入陣列。`verified-live`（Bash）：一般失敗 exit 1、部分輸出後失敗 exit 23 皆阻擋；合法 23 個 JS 通過。
- 保留既有 CSS、資料、技能、裝備、轉蛋、OCR、非同步導覽、預覽與 SEO 部署門檻；新增新版 HUD 回歸納入既有 OCR 命令。
- `code-inference`：Firestore 部署重試仍為既有 continue-on-error 設計，兩次失敗時不會阻擋 Pages；本次未發生此情況，沒有擴大部署政策變更。

## SEO／其他服務

- `verified-live`：線上 robots、sitemap、canonical、字型與既有辨識程式 CDN 可讀；來源與非官方身分仍清楚區分。
- `verified-live`（本機）：首頁 14 題 FAQ、7 個攻略頁 FAQ 與可見文字一致，資料筆數同步；公開 HTML/JS/JSON 識別檢查通過，不出現指定外站品牌。合法官方、巴哈與 Threads 引用保留。
- `verified-live`（本機）：完整 minify／app-shell 建置及 71 張怪物靜態頁＋總覽產生成功。未新增外部 SDK 或追蹤器。
- `unchecked`：Search Console、Core Web Vitals 與搜尋成效無存取，不能宣稱已收錄或流量改善。

## 重跑

Node：`test_expocr.js`、`test_gacha_data.js`、`test_equipment_ranges.js`、`test_el_nath.js`、`test_skill_text.js`、`test_db_async.js`（皆在 tools/）。Python：`tools/check_data.py`、`tools/check_css.py`、`tools/check_seo_copy.py`、`tools/build_el_nath_guide.py --check`。瀏覽器：本機 HTTP server 開啟 `tools/test_expocr_browser.html`，按執行；不需要分享真實螢幕。
