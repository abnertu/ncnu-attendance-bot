param(
  [string]$TaskName = "AttendanceBot"
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run-tick.cmd'

if (-not (Test-Path -LiteralPath $runner)) {
  throw "找不到 $runner"
}

if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
  throw '找不到 pnpm.cmd, 請先安裝 pnpm 並確認 PATH'
}

# 工作排程器使用目前登入的 Windows 帳號, 避免改用 SYSTEM 導致資料夾及 Session 不同。
$action = New-ScheduledTaskAction `
  -Execute $env:ComSpec `
  -Argument ('/d /c ""' + $runner + '""') `
  -WorkingDirectory $root

# 每分鐘檢查一次; 實際秒數由 src/runner.ts 的每日計畫決定。
# 此觸發器的重複期間為 10 年, 如有長期需求可定期重新安裝。
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At ((Get-Date).AddMinutes(1)) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# S4U 可在使用者登出後執行, 不儲存密碼, 且僅有本機資源的存取權。
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "已建立排程: $TaskName ($user)"
Write-Host "執行程式: $runner"
Write-Host '安全性: 不論使用者登入與否均執行、不儲存密碼、隱藏'
Write-Host '排程每分鐘觸發一次, 真正簽到/簽退時間以 config.json 與 .state 計畫為準'
Write-Host "檢視: Get-ScheduledTask -TaskName '$TaskName'"
