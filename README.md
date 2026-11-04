# 暨大差勤打卡工具

在 Windows 使用 TypeScript 與 Playwright，讀取暨大差勤網站的個人行事曆和簽到退紀錄，再依每日計畫自動打卡。

[![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

實際送出預設關閉。請依實際出勤使用。

## 安裝與登入

需要 Windows 10/11、pnpm，以及 Node.js 24 以上。也支援 Node.js 20.19 以上的 20.x 版、22.13 以上的 22.x 版。

```powershell
pnpm install
pnpm exec playwright install chromium
pnpm run login
pnpm run sync
```

在開啟的瀏覽器完成登入，再回到終端機按 Enter。登入狀態（Session）存於 `.auth/state.json`；過期後重新執行 `login`。工具不儲存帳號密碼。

`sync` 讀取當月行事曆、今日是否上班及簽到退時間。先確認輸出正確，再啟用排程。

## 唯讀檢查與本機狀態

| 指令                         | 用途                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `pnpm run sync`              | 讀取網站，更新 `.state/site-YYYY-MM-DD.json`。        |
| `pnpm run dry-run`           | 與 `sync` 相同。                                      |
| `pnpm run tick -- --dry-run` | 與 `sync` 相同。                                      |
| `pnpm run inspect`           | 開啟瀏覽器，檢查 Selector 並儲存 `logs/inspect.png`。 |
| `pnpm run plan`              | 顯示今日計畫、啟用狀態與最近一次網站快照。            |
| `pnpm run status`            | 與 `plan` 相同。                                      |

網站唯讀指令不改每日計畫的執行狀態，也不呼叫送出函式。即使 `execution.enabled=true`，仍有瀏覽器事件與請求攔截阻止送出。`blockedRequests=0` 表示沒有嘗試送出打卡請求。

`plan` 與 `status` 不連線網站；今日計畫不存在時會建立計畫。快照的 `fetchedAt` 是上次讀取時間。正式送出前會重新查詢網站，快照不作為執行依據。

## 設定

`config.defaults.json` 提供網站網址、導覽、行事曆、紀錄表、按鈕與成功訊息等規則。`config.json` 是個人覆寫檔，不納入 Git。

物件逐層合併，陣列整個取代。缺少 `config.json` 時使用預設值，實際送出仍為關閉。一般只需設定時間及是否啟用：

```json
{
  "schedule": {
    "checkIn": { "from": "08:00", "to": "08:15" },
    "checkOut": { "from": "17:16", "to": "17:30" }
  },
  "execution": {
    "enabled": false,
    "headless": true
  }
}
```

時間範圍含結束那一分鐘。每日隨機時間只建立一次，存於 `.state/YYYY-MM-DD.json`。當天修改設定不會重抽時間。

網站改版時，可在 `config.json` 覆寫 `site.calendar`、`site.records` 或 `site.checkIn/checkOut`。帳號、Cookie、Token 不應放入設定檔。

## 工作日與已打卡判斷

1. 讀取首頁「個人行事曆」，驗證年月、全月日期數量及唯一性。
2. 依 `holidayTexts` 判定休息日與國定假日，依 `workingTexts` 判定補班。無註記的日期視為一般上班日，不另行排除週末。
3. 遇到未知註記、衝突標記、缺少日期、登入過期或連線失敗時，停止本次操作。
4. 讀取「線上簽到退」的日期欄位與紀錄表，依動作名稱及同日時間戳記辨識紀錄。日期不符、重複或缺少動作列時停止。
5. 空白時間代表尚無紀錄；已有紀錄就回傳 `already`。正式送出前再讀一次，避免與手動打卡重複。
6. 下班簽退必須有今日網站上班紀錄，且間隔須超過 8 小時。剛好 8 小時仍不送出。

行事曆以網站排班資料為準。工具不另行推斷全日或部分請假，無法識別的註記會停止執行。可用 `schedule.skipDates` 指定暫停日期。

只有明確設定 `site.calendar.enabled=false`，才改用 `schedule.workingDays` 的星期設定。建立每日計畫不代表已確認當日需上班。

工時計算使用網站上班時間，包含使用者手動打卡的紀錄。網站時間只有分鐘時，以該分鐘最後一秒計算。

工時不足時，簽退保留 `pending`，下個週期重新查核。超過每日計畫的 `maxLateSeconds` 後，仍記為 `missed`，不延長允許時間。

## 成功通知

上班簽到或下班簽退確認成功後，可透過 SMTP 自動寄信。寄信預設關閉。

在個人 `config.json` 加入下列設定，並替換 SMTP 主機、帳號及寄收件地址。
直接將 SMTP 密碼或應用程式密碼填入 `email.password`。

```json
{
  "email": {
    "enabled": true,
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "user": "sender@example.com",
    "password": "your-smtp-password",
    "from": "sender@example.com",
    "to": "recipient@example.com",
    "timeoutMs": 15000
  }
}
```

密碼由 `config.json` 直接讀取，不使用環境變數。
舊設定請將 `passwordEnv` 改成 `password`，並填入實際密碼。
`config.json` 不納入 Git；請勿將密碼填入 `config.defaults.json`。

587 埠使用 `secure=false`，並強制 STARTTLS。465 埠使用 `secure=true`。伺服器必須提供有效的 TLS 憑證。設定方式見 [Nodemailer SMTP 說明](https://nodemailer.com/smtp)。

不需驗證的 SMTP 主機，可將 `user` 與 `password` 同時留空。

程式先保存打卡成功狀態，再寄出通知。已有網站紀錄、跳過、逾時或結果不明時不寄信。

`pnpm run status` 會顯示工作的 `email.status`，值為 `sent` 或 `failed`。`sent` 表示 SMTP 已接受郵件，不保證郵件已送達信箱。

寄信失敗不改變打卡成功狀態，也不自動重寄或重新打卡。日誌記錄 `EMAIL_SENT` 或 `EMAIL_FAILED`。

完成 SMTP 設定並啟用 `email.enabled=true` 後，可寄出一封測試信：

```powershell
pnpm run email:test
```

也可執行 `just email-test`。測試信主旨為 `[attendance-bot] test email`。

此指令不受 `execution.enabled` 影響。此指令不連線差勤網站，也不讀寫出勤狀態。

SMTP 接受郵件時回傳結束碼 `0`。設定錯誤或寄送失敗時回傳非零結束碼。

失敗時會顯示錯誤代碼、SMTP 回覆碼及對應說明，不顯示密碼或原始伺服器回覆。
`EAUTH` 表示帳密驗證失敗；`ERR_TLS_CERT_ALTNAME_INVALID` 表示憑證名稱與 SMTP 主機不符。

## 啟用排程

1. 執行 `pnpm run sync`，確認日期、行事曆及簽到退時間。
2. 在 `config.json` 設定 `execution.enabled=true`，排程執行時使用 `execution.headless=true`。
3. 在 PowerShell 安裝排程：

```powershell
.\windows\install-task.ps1
```

若執行政策阻擋，可只對本次處理程序略過政策：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\install-task.ps1
```

排程 `AttendanceBot` 使用執行安裝腳本的 Windows 帳號，安全性選項為：

- 不論使用者登入與否均執行：`LogonType=S4U`。
- 不儲存 Windows 密碼，僅有本機電腦資源的存取權。
- 隱藏：`Settings.Hidden=true`。

每分鐘執行 `windows/run-tick.cmd`，實際秒數由每日計畫決定。電腦需開機、未睡眠且能連線網站；使用者可登出。S4U 的網路及加密檔案存取限制，請參考 [Microsoft 說明](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_logon_type)。登出後的網站連線需在目標電腦確認。

舊排程需重新執行安裝腳本，才會套用新設定。專案路徑變更後也需重新安裝。觸發器的重複期間為十年。

```powershell
Get-ScheduledTask -TaskName AttendanceBot | Select-Object TaskName, State, Principal, Settings
Get-ScheduledTaskInfo -TaskName AttendanceBot
Get-Content .\logs\scheduler.log -Tail 50
pnpm run status
```

安裝與移除都支援自訂名稱；使用相同名稱即可更新或移除：

```powershell
.\windows\install-task.ps1 -TaskName AttendanceBot
.\windows\remove-task.ps1 -TaskName AttendanceBot
```

## 執行保護

- `enabled=false` 時，排程不查網站、不送出，也不將待執行項目標成逾時。
- 僅在動作即將到期時查核網站；當日放假記為 `skipped`。
- 超過 `maxLateSeconds` 不補點，記為 `missed`。導覽後與送出前會再次檢查日期及允許時間。
- 排程的 `IgnoreNew` 與程式執行鎖共同避免重疊。行程已終止的鎖可於下次執行回收。
- 導覽或讀取失敗且尚未嘗試送出時，保留原狀態，下個週期可在允許時間內重試。
- 點擊前先保存 `started`；其後失敗記為 `needs-review`，不自動重送。崩潰留下的 `started` 也不重送。
- 只接受符合 `confirmDialogContains` 的確認視窗。成功提示支援原生 alert、HTML Toast/Modal 及新視窗。

成功提示代表網站回覆成功，出勤報表可能延後更新。結果不明時先查核網站，再用 `sync` 更新快照。`sync` 不會解除 `needs-review` 或清除 `started`。請勿刪除含 `started`、`success` 或 `needs-review` 的計畫來重試。

## 手動實際打卡

以下指令會操作正式網站。必須在互動式終端機親自輸入小寫 `y`：

```powershell
pnpm run manual:checkin
pnpm run manual:checkout
```

手動指令略過排程時間與 `enabled` 開關，仍檢查網站工作日、今日紀錄、日期及本機防重複狀態。下班簽退仍須超過 8 小時。舊的 `test:checkin` 與 `test:checkout` 已改名為上述指令。

## Windows just 指令

可選擇安裝 [just](https://just.systems/)，以 Windows PowerShell 執行常用指令：

```powershell
just
just install
just login
just sync
just check
just install-task
```

`just` 只列出指令。`just tick` 會執行排程週期，啟用時可能實際送出。`just manual-checkin` 與 `just manual-checkout` 仍需互動確認。完整指令請執行 `just --list`。

開發指令與變更規範見 [AGENTS.md](AGENTS.md)。

## 本機資料

`.auth/`、`.state/`、`logs/` 與 `config.json` 均由 `.gitignore` 排除。這些檔案可能包含 Session、個人出勤紀錄、設定或截圖，請保留於本機。

Windows 檔案存取權限以資料夾 ACL 為準。`logs/` 尚未自動輪替，可自行清理舊截圖與日誌。
