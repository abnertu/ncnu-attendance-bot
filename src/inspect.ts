import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTH, LOG_DIR, ensureDirs, readConfig } from './common.js';
import { openAttendanceView } from './navigation.js';
import { installReadOnlyGuard } from './site-data.js';

async function main() {
  const config = readConfig();

  ensureDirs();

  if (!existsSync(AUTH)) {
    throw new Error('請先執行 pnpm run login');
  }

  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext({
      storageState: AUTH,
      timezoneId: config.schedule.timezone,
      serviceWorkers: 'block',
    });

    await installReadOnlyGuard(context, config);
    const page = await context.newPage();
    const root = await openAttendanceView(page, config);

    console.log('目前網址:', page.url());
    console.log('navigationFrameSelector:', config.site.navigationFrameSelector || '(無)');
    console.log('navigationSelector:', config.site.navigationSelector || '(無)');
    console.log('navigationHoverSelector:', config.site.navigationHoverSelector || '(無)');
    console.log('frameSelector:', config.site.frameSelector || '(無)');
    // 等待 iframe 載入真正的打卡內容, 不只等待 iframe 元素存在。
    const candidates = (['checkIn', 'checkOut'] as const).flatMap((action) => {
      const rule = config.site[action];

      return [rule.buttonSelector, rule.alreadySelector].filter(Boolean);
    });

    if (candidates.length > 0) {
      try {
        await Promise.any(
          candidates.map((selector) =>
            root.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 }),
          ),
        );
      } catch {
        console.warn('未等到可辨識的簽到/簽退元素, 請檢查 Selector 或 iframe 是否完成載入');
      }
    }

    console.log(
      'Frames:',
      page.frames().map((frame) => ({
        name: frame.name(),
        url: frame.url(),
        parent: frame.parentFrame()?.name() ?? '(root)',
      })),
    );

    for (const action of ['checkIn', 'checkOut'] as const) {
      const rule = config.site[action];

      for (const name of [
        'buttonSelector',
        'alreadySelector',
        'successSelector',
        'confirmSelector',
      ] as const) {
        const selector = rule[name];

        if (!selector) {
          continue;
        }

        const locator = root.locator(selector);
        const count = await locator.count();
        const visible = count > 0 && (await locator.first().isVisible());

        console.log(`${action}.${name}: count=${count}, visible=${visible}`);
      }
    }

    const screenshot = resolve(LOG_DIR, 'inspect.png');

    await page.screenshot({ path: screenshot, fullPage: true });
    console.log('Screenshot:', screenshot);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
