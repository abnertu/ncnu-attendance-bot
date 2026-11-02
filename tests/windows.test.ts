import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test(
  'Windows installer creates a hidden, passwordless S4U task for the current user',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const installer = fileURLToPath(new URL('../windows/install-task.ps1', import.meta.url));
    const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
    const runner = fileURLToPath(new URL('../windows/run-tick.cmd', import.meta.url));
    const script = `
    $ErrorActionPreference = 'Stop'
    Import-Module ScheduledTasks

    # Capture registration while using the real cmdlets to construct task definitions.
    # No task is registered, started, or removed by this test.
    function Capture-ScheduledTask {
      [CmdletBinding()]
      param($TaskName, $Action, $Trigger, $Settings, $Principal, $Password, [switch]$Force)

      $global:capturedTaskRegistration = $PSBoundParameters
    }

    # Alias precedence prevents module command imports from replacing the mock.
    Set-Alias -Name Register-ScheduledTask -Value Capture-ScheduledTask -Scope Global
    if ((Get-Command Register-ScheduledTask).ResolvedCommand.Name -ne 'Capture-ScheduledTask') {
      throw 'Scheduler registration interception is unavailable'
    }

    foreach ($name in @('AttendanceBot', 'AttendanceBot-validation')) {
      if ($name -eq 'AttendanceBot') {
        & '${installer.replaceAll("'", "''")}' 6>$null
      } else {
        & '${installer.replaceAll("'", "''")}' -TaskName $name 6>$null
      }

      $task = $global:capturedTaskRegistration
      [pscustomobject]@{
        name = $task.TaskName
        logonType = [string]$task.Principal.LogonType
        runLevel = [string]$task.Principal.RunLevel
        currentUser = $task.Principal.UserId -eq [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        hidden = $task.Settings.Hidden
        multipleInstances = [string]$task.Settings.MultipleInstances
        executable = $task.Action.Execute
        arguments = $task.Action.Arguments
        workingDirectory = $task.Action.WorkingDirectory
        interval = $task.Trigger.Repetition.Interval
        hasPassword = $task.ContainsKey('Password')
        force = [bool]$task.Force
      } | ConvertTo-Json -Compress
    }
  `;
    const output = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
      },
    );
    const registrations = output
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));

    assert.deepEqual(
      registrations,
      ['AttendanceBot', 'AttendanceBot-validation'].map((name) => ({
        name,
        logonType: 'S4U',
        runLevel: 'Limited',
        currentUser: true,
        hidden: true,
        multipleInstances: 'IgnoreNew',
        executable: process.env.ComSpec,
        arguments: `/d /c ""${runner}""`,
        workingDirectory: root,
        interval: 'PT1M',
        hasPassword: false,
        force: true,
      })),
    );
  },
);
