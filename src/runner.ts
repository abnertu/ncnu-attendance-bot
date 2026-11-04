import { chromium } from 'playwright';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  AUTH,
  LOG_DIR,
  type Action,
  type Config,
  type Plan,
  ensureDirs,
  loadOrCreatePlan,
  localClock,
  log,
  readConfig,
  savePlan,
  secondsOfTime,
} from './common.js';
import { acquireRunLock } from './lock.js';
import { notifyPunchSuccess } from './email.js';
import { punchOnPage } from './punch.js';
import { cachedSnapshot, saveSnapshot, syncSite } from './sync.js';

async function runAction(
  action: Action,
  plan: Plan,
  config: Config,
  manual = false,
): Promise<void> {
  const job = plan[action];
  let sent = false;
  let browser;
  let page;

  try {
    if (!existsSync(AUTH)) {
      throw new Error('Session 不存在，請先執行 pnpm run login');
    }

    browser = await chromium.launch({ headless: manual ? false : config.execution.headless });
    const context = await browser.newContext({
      storageState: AUTH,
      timezoneId: config.schedule.timezone,
    });

    page = await context.newPage();
    page.setDefaultTimeout(config.execution.navigationTimeoutMs);
    const result = await punchOnPage(page, action, plan.date, config, {
      latestSeconds: manual ? undefined : secondsOfTime(job.at) + config.execution.maxLateSeconds,
      onSnapshot: saveSnapshot,
      beforeSend: () => {
        if (!manual && !readConfig().execution.enabled) {
          throw new Error('實際送出已關閉');
        }

        job.status = 'started';
        job.updatedAt = new Date().toISOString();
        job.detail = '已確認工作日與網站紀錄，準備送出';
        savePlan(plan);
        sent = true;
      },
    });

    job.status = result.status;
    job.detail = result.detail;

    if (result.status === 'skipped') {
      for (const other of ['checkIn', 'checkOut'] as const) {
        if (plan[other].status === 'pending') {
          plan[other].status = 'skipped';
          plan[other].detail = result.detail;
          plan[other].updatedAt = new Date().toISOString();
        }
      }
    }

    log(`${plan.date} ${action}: ${result.status.toUpperCase()} ${result.detail}`);

    if (result.status === 'success') {
      job.updatedAt = new Date().toISOString();
      savePlan(plan);
      job.email = await notifyPunchSuccess(action, plan, config);
      await page
        .screenshot({
          path: resolve(LOG_DIR, `${plan.date}-${action}-success.png`),
          fullPage: true,
          timeout: 5000,
        })
        .catch(() => {});
    }
  } catch (error) {
    // Only an attempted submission is ambiguous. Read-only preflight failures can retry later.
    job.status = sent ? 'needs-review' : job.status;
    job.detail = String(error);
    log(`${plan.date} ${action}: ${sent ? 'NEEDS_REVIEW' : 'PREFLIGHT_ERROR'} ${job.detail}`);

    if (page) {
      await page
        .screenshot({
          path: resolve(LOG_DIR, `${plan.date}-${action}-error.png`),
          fullPage: true,
          timeout: 5000,
        })
        .catch(() => {});
    }

    process.exitCode = 1;
  } finally {
    job.updatedAt = new Date().toISOString();

    try {
      savePlan(plan);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}

async function manualPunch(action: Action, config: Config): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('手動操作必須在互動式 Terminal 執行，不接受管線或工作排程器輸入');
  }

  const label = action === 'checkIn' ? '上班簽到' : '下班簽退';

  console.log(`手動${label}會操作正式網站，並略過排程時間與 enabled 開關。`);
  const rl = createInterface({ input: stdin, output: stdout });
  let answer: string;

  try {
    answer = await rl.question(`請輸入小寫 y 確認${label}：`);
  } finally {
    rl.close();
  }

  if (answer !== 'y') {
    console.log('已取消。');

    return;
  }

  const plan = loadOrCreatePlan(localClock(config.schedule.timezone).date, config);
  const job = plan[action];

  if (job.status !== 'pending' && job.status !== 'missed') {
    throw new Error(`今日狀態為 ${job.status}，請先查核網站紀錄；不重複送出`);
  }

  await runAction(
    action,
    plan,
    { ...config, execution: { ...config.execution, enabled: true, headless: false } },
    true,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === '--') {
    args.shift();
  }

  const allowed = ['--plan', '--status', '--dry-run', '--manual=checkIn', '--manual=checkOut'];

  if (args.length > 1 || args.some((arg) => !allowed.includes(arg))) {
    throw new Error('未知或互斥的命令參數');
  }

  ensureDirs();
  const config = readConfig();

  if (args.includes('--dry-run')) {
    await syncSite();

    return;
  }

  const clock = localClock(config.schedule.timezone);

  if (args.includes('--status') || args.includes('--plan')) {
    const release = acquireRunLock();

    try {
      const plan = loadOrCreatePlan(clock.date, config);

      console.log(
        JSON.stringify(
          { enabled: config.execution.enabled, plan, site: cachedSnapshot(clock.date) },
          null,
          2,
        ),
      );
    } finally {
      release();
    }

    return;
  }

  const release = acquireRunLock();

  try {
    if (args[0]?.startsWith('--manual=')) {
      await manualPunch(args[0].endsWith('checkIn') ? 'checkIn' : 'checkOut', config);

      return;
    }

    if (!config.execution.enabled) {
      return;
    }

    // With website calendar enabled, do not filter weekends: the site may specify a make-up workday.
    if (
      config.schedule.skipDates.includes(clock.date) ||
      (!config.site.calendar.enabled && !config.schedule.workingDays.includes(clock.weekday))
    ) {
      return;
    }

    const plan = loadOrCreatePlan(clock.date, config);

    for (const action of ['checkIn', 'checkOut'] as const) {
      const job = plan[action];

      if (job.status !== 'pending') {
        continue;
      }

      const now = localClock(config.schedule.timezone);

      if (now.date !== plan.date) {
        return;
      }

      const secondsUntil = secondsOfTime(job.at) - now.seconds;

      if (secondsUntil >= 60) {
        continue;
      }

      if (secondsUntil < -config.execution.maxLateSeconds) {
        job.status = 'missed';
        job.updatedAt = new Date().toISOString();
        job.detail = '超出允許時間，未送出';
        savePlan(plan);
        log(`${plan.date} ${action}: MISSED (${job.at})`);
        continue;
      }

      if (secondsUntil > 0) {
        await sleep(secondsUntil * 1000);
      }

      await runAction(action, plan, config);
    }
  } finally {
    release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
