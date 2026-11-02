import { chromium } from 'playwright';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTH, STATE_DIR, ensureDirs, localClock, readConfig } from './common.js';
import { installReadOnlyGuard, readSiteSnapshot, type SiteSnapshot } from './site-data.js';

export function saveSnapshot(snapshot: SiteSnapshot): void {
  ensureDirs();
  const file = resolve(STATE_DIR, `site-${snapshot.date}.json`);
  const temp = `${file}.${process.pid}.tmp`;

  writeFileSync(temp, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, file);
}

export function cachedSnapshot(date: string): SiteSnapshot | null {
  const file = resolve(STATE_DIR, `site-${date}.json`);

  if (!existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SiteSnapshot;
  } catch {
    return null;
  }
}

export async function syncSite(): Promise<void> {
  const config = readConfig();

  if (!existsSync(AUTH)) {
    throw new Error('Session 不存在，請先執行 pnpm run login');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      storageState: AUTH,
      timezoneId: config.schedule.timezone,
      serviceWorkers: 'block',
    });
    const guard = await installReadOnlyGuard(context, config);
    const page = await context.newPage();

    page.setDefaultTimeout(config.execution.navigationTimeoutMs);
    page.on('dialog', (dialog) => {
      void dialog.dismiss();
    });
    const { snapshot } = await readSiteSnapshot(
      page,
      localClock(config.schedule.timezone).date,
      config,
    );

    if (guard.blockedRequests) {
      throw new Error('唯讀檢查攔截到非預期的打卡請求');
    }

    saveSnapshot(snapshot);
    console.log(
      JSON.stringify(
        { mode: 'read-only', blockedRequests: guard.blockedRequests, ...snapshot },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
