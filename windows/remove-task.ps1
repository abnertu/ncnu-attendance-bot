param(
  [string]$TaskName = "AttendanceBot"
)

$ErrorActionPreference = 'Stop'

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Host "已刪除排程: $TaskName"
