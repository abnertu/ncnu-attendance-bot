import { chromium } from 'playwright';
import { chmodSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { AUTH, ensureDirs, readConfig } from './common.js';
import { openAttendanceView } from './navigation.js';

async function main() {
  const config = readConfig();

  ensureDirs();
  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext({ timezoneId: config.schedule.timezone });
    const page = await context.newPage();

    await page.goto(config.site.loginUrl ?? config.site.url, { waitUntil: 'domcontentloaded' });
    const rl = createInterface({ input: stdin, output: stdout });

    try {
      await rl.question('請在瀏覽器完成登入, 回到終端機按 Enter 後會檢查打卡頁面... ');
    } finally {
      rl.close();
    }

    // 登入完成後開啟打卡頁面並點擊主頁導覽選單, 讓 iframe 的頁面實際載入。
    // 這個步驟不會點擊簽到或簽退。
    const root = await openAttendanceView(page, config);

    if (config.site.frameSelector) {
      await root.locator('body').first().waitFor({
        state: 'attached',
        timeout: config.execution.navigationTimeoutMs,
      });
    }

    await context.storageState({ path: AUTH, indexedDB: true });
    chmodSync(AUTH, 0o600);
    console.log(`Session 已儲存: ${AUTH}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
