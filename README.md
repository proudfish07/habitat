#Habit Hourglass (MVP) – README

一個零後端、可離線使用的習慣與獎勵追蹤器。單一 index.html 檔即可運行，資料存在瀏覽器 localStorage。

✨ 功能總覽

獎勵卡（Reward）：設定目標點數 target、起始日 startDate、週期天數 periodDays，顯示區間進度條與本期事件色塊。

小習慣（Habit）：

類型 type: count（固定加點）或 streak（連續加成）。

每筆事件以顏色標記，右側按鈕 「達成」 會依類型計分：

count → 本次加 value。

streak → 本次加 value * computeStreakDelta()（連續天數 + 1）。

顯示 ＋本次加多少 與 （本期 X 次） 統計。

懲罰（Penalty）：

自訂名稱與點數（扣分），按鈕 「處罰」 新增一筆負分事件。

提供 撤銷上一筆懲罰。

懲罰同樣顯示 （本期 X 次）。

分期：

期間顯示為 「期間 <數字> 天」（單位置於後方）。

新開一期：清除事件、把 startDate 設為今天。

兌換：達標後紀錄一次兌換並清期（保留歷史兌換紀錄）。

PWA：可安裝至手機/桌面，連線中斷仍可使用（service-worker.js）。

🧮 計分規則

Habit

value：新增時輸入（預設 1）。

type = "count"：

本次加分 = value。

type = "streak"：

本次加分 = value * computeStreakDelta(habitId)。

computeStreakDelta 會從昨天開始往回找連續有打卡的天數 streak，回傳 streak + 1。可選擇加入上限（例如 streakMax）。

Penalty

本次扣分 = -abs(value)。

所有事件（habit/penalty）皆記錄於 reward.events，並以 delta（正負）累加成當期總點數。


🚀 快速開始

將整個資料夾放到任一靜態主機，或直接用本機開啟 index.html。

首次進入會建立一個預設 Reward。

依序：新增小習慣 →（必要時）切換為「累計」→ 設定加多少 → 按 達成。

需要扣分時，先在懲罰區新增項目，之後按 處罰 即可。


🖥️ 使用說明（UI）

標題列：顯示今天日期。

獎勵卡：

日期輸入：設定起始日。

目標 與 期間 天 可直接點擊數字編輯。

新開一期：清空事件、起始日改為今天；兌換：達成目標後紀錄一次兌換並清期。

小習慣列：

文本可點擊改名。

右側 達成：新增一筆事件（count 固定加、streak 連續加成）。

列表顯示：＋本次加多少、（本期 X 次）。

懲罰列：

處罰 新增一次扣分；可撤銷「上一筆懲罰」。

🔒 資料保存與相容性

所有資料只存於本機 localStorage（Key：habit_rewards_v1）。

重新整理/離線皆不會遺失資料；清瀏覽器資料或更換裝置會遺失。

舊版 habit 未設定 type 時，系統會視為 count，行為相容。

🐞 疑難排解

看不到 PWA 安裝按鈕：確保透過 HTTP(S) 站點存取，且 service-worker.js 路徑正確。

事件沒累加：確認時間格式為 YYYY-MM-DD，以及 delta 是否為數值。

連續加成不生效：該項目必須為 streak 類型；另外一天 只能打卡一次（同日重複會被覆蓋/移除）。


📄 授權

此 MVP 用於個人專案與學習示範，未特別指定授權；如需公開釋出，建議加上 MIT 授權檔案。

