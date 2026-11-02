import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readConfig, type Config } from '../src/common.js';
import { punchOnPage as performPunch, type PunchOptions } from '../src/punch.js';
import { installReadOnlyGuard, readSiteSnapshot } from '../src/site-data.js';

let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});
const date = '2026-10-19';
const now = () => new Date('2026-10-19T08:00:00Z');
const punchOnPage = (
  page: Page,
  action: 'checkIn' | 'checkOut',
  date: string,
  config: Config,
  options: PunchOptions,
) => performPunch(page, action, date, config, { ...options, logger: () => {} });

type Options = {
  note?: string;
  checkIn?: string;
  checkOut?: string;
  staleDate?: boolean;
  behavior?: 'alert' | 'toast' | 'none' | 'unexpected' | 'popup';
  delay?: number;
};

async function fixture(
  options: Options,
  run: (f: {
    config: Config;
    context: BrowserContext;
    page: Page;
    posts: () => number;
  }) => Promise<void>,
) {
  let posts = 0;
  const config = readConfig(
    fileURLToPath(new URL('./fixtures/missing-config.json', import.meta.url)),
  );

  config.execution.enabled = true;
  config.execution.verificationTimeoutMs = 1500;
  config.execution.navigationTimeoutMs = 3000;
  config.site.checkIn.successSelector = options.behavior === 'toast' ? '#success' : '';

  if (options.behavior === 'popup') {
    config.site.checkIn.successPopupSelector = '#popup-success';
  }

  const calendar = `<table id="Calendard_Calendar"><tbody><tr><td><table><tr><td>上個月</td><td>2026年10月</td><td>下個月</td></tr></table></td></tr><tr><th>週日</th></tr>${Array.from({ length: 31 }, (_, i) => `<tr><td>${i + 1}${i === 18 && options.note ? `<br><font color="red">${options.note}</font>` : ''}</td></tr>`).join('')}</tbody></table>`;
  const attendance = (submitted = false) => `<!DOCTYPE html><html><body>
    <input id="ContentPlaceHolder1_HiddenField_humwr_date" type="hidden" value="${options.staleDate ? '2026-10-18' : date}">
    <table id="ContentPlaceHolder1_Table_record"><tbody><tr><th>簽到退類別</th><th>簽到退時間</th></tr>
    <tr><td>上班簽到</td><td>${options.checkIn ?? '&nbsp;'}</td></tr>
    <tr><td>下班簽退</td><td>${options.checkOut ?? '&nbsp;'}</td></tr></tbody></table>
    <form method="post"><input type="submit" id="ContentPlaceHolder1_Button_humwr_amst_hum_wkrecord" name="${config.site.checkIn.submitField}" value="上班簽到"
      onclick="${options.behavior === 'popup' ? "window.open('/popup'); return false;" : `return confirm('${options.behavior === 'unexpected' ? '刪除資料?' : '確定要簽到?'}');`}">
    <input type="submit" id="ContentPlaceHolder1_Button_humwr_pmet_hum_wkrecord" name="${config.site.checkOut.submitField}" value="下班簽退" onclick="return confirm('確定要簽退?');"></form>
    ${submitted && (options.behavior ?? 'alert') === 'alert' ? '<script>alert("線上刷卡成功,出勤時間將在10分鐘內更新");</script>' : ''}
    ${submitted && options.behavior === 'toast' ? '<div id="success">線上刷卡成功</div>' : ''}
    </body></html>`;
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;

    response.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (path === '/calendar') {
      response.end(calendar);
    } else if (path === '/popup') {
      response.end('<div id="popup-success">線上刷卡成功</div>');
    } else if (path === '/attendance' && request.method === 'POST') {
      posts++;
      request.resume();
      setTimeout(() => response.end(attendance(true)), options.delay ?? 0);
    } else if (path === '/attendance') {
      response.end(attendance());
    } else {
      response.statusCode = 404;
      response.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  config.site.url = `${base}/attendance`;
  config.site.attendanceUrl = `${base}/attendance`;
  config.site.calendar.url = `${base}/calendar`;
  const context = await browser.newContext({ serviceWorkers: 'block' });

  // No fixture browser request may leave its local server.
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  const page = await context.newPage();

  page.setDefaultTimeout(3000);

  try {
    await run({ config, context, page, posts: () => posts });
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('read-only snapshot reads website holiday and both timestamps without any POST', async () => {
  await fixture(
    { checkIn: `${date} 08:32:00`, checkOut: `${date} 17:32:00` },
    async ({ config, context, page, posts }) => {
      const guard = await installReadOnlyGuard(context, config);
      const { snapshot } = await readSiteSnapshot(page, date, config);

      assert.equal(snapshot.day.working, true);
      assert.equal(snapshot.attendance.checkIn.at, `${date} 08:32:00`);
      assert.equal(snapshot.attendance.checkOut.at, `${date} 17:32:00`);
      assert.equal(posts(), 0);
      assert.equal(guard.blockedRequests, 0);
    },
  );
});

test('read-only request guard blocks a programmatic form submission', async () => {
  await fixture({}, async ({ config, context, page, posts }) => {
    const guard = await installReadOnlyGuard(context, config);

    await readSiteSnapshot(page, date, config);
    const failed = page.waitForEvent('requestfailed', (request) => request.method() === 'POST');

    await page.evaluate(() => {
      (document.querySelector('form') as HTMLFormElement).submit();
    });
    await failed;
    assert.equal(posts(), 0);
    assert.equal(guard.blockedRequests, 1);
  });
});

test('a holiday skips before the submission callback', async () => {
  await fixture({ note: '國定假日' }, async ({ config, page, posts }) => {
    const result = await punchOnPage(page, 'checkIn', date, config, {
      now,
      beforeSend: () => assert.fail('holiday submitted'),
    });

    assert.equal(result.status, 'skipped');
    assert.equal(posts(), 0);
  });
});

test('a manual skip date also prevents submission', async () => {
  await fixture({}, async ({ config, page, posts }) => {
    config.schedule.skipDates = [date];
    const result = await punchOnPage(page, 'checkIn', date, config, {
      now,
      beforeSend: () => assert.fail('skip date submitted'),
    });

    assert.equal(result.status, 'skipped');
    assert.equal(posts(), 0);
  });
});

test('existing check-in and check-out each prevent a duplicate', async () => {
  await fixture(
    { checkIn: `${date} 08:32:00`, checkOut: `${date} 17:32:00` },
    async ({ config, page, posts }) => {
      for (const action of ['checkIn', 'checkOut'] as const) {
        const result = await punchOnPage(page, action, date, config, {
          now,
          beforeSend: () => assert.fail('duplicate submitted'),
        });

        assert.equal(result.status, 'already');
      }

      assert.equal(posts(), 0);
    },
  );
});

test('unknown calendar annotations and stale record dates prevent submission', async () => {
  for (const options of [{ note: '特殊排班待確認' }, { staleDate: true }]) {
    await fixture(options, async ({ config, page, posts }) => {
      await assert.rejects(
        punchOnPage(page, 'checkIn', date, config, {
          now,
          beforeSend: () => assert.fail('unverified submitted'),
        }),
      );
      assert.equal(posts(), 0);
    });
  }
});

test('disabled sending and a changed date prevent submission', async () => {
  await fixture({}, async ({ config, page, posts }) => {
    config.execution.enabled = false;
    await assert.rejects(
      punchOnPage(page, 'checkIn', date, config, { now, beforeSend: () => assert.fail() }),
      /關閉/,
    );
    config.execution.enabled = true;
    await assert.rejects(
      punchOnPage(page, 'checkIn', date, config, {
        now: () => new Date('2026-10-20T08:00:00Z'),
        beforeSend: () => assert.fail(),
      }),
      /日期/,
    );
    assert.equal(posts(), 0);
  });
});

test('lateness is checked again after site navigation', async () => {
  await fixture({}, async ({ config, page, posts }) => {
    const result = await punchOnPage(page, 'checkIn', date, config, {
      now,
      latestSeconds: 1,
      beforeSend: () => assert.fail('late submitted'),
    });

    assert.equal(result.status, 'missed');
    assert.equal(posts(), 0);
  });
});

test('expected confirm followed by success alert submits exactly once on the local fixture', async () => {
  await fixture({}, async ({ config, page, posts }) => {
    let attempts = 0;
    const result = await punchOnPage(page, 'checkIn', date, config, {
      now,
      beforeSend: () => {
        attempts++;
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(attempts, 1);
    assert.equal(posts(), 1);
  });
});

test('check-out uses its own confirmation and submits once on the local fixture', async () => {
  await fixture({}, async ({ config, page, posts }) => {
    let attempts = 0;
    const result = await punchOnPage(page, 'checkOut', date, config, {
      now,
      beforeSend: () => {
        attempts++;
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(attempts, 1);
    assert.equal(posts(), 1);
  });
});

test('a record appearing during UI preparation prevents submission', async () => {
  await fixture({}, async ({ config, page, posts }) => {
    const result = await punchOnPage(page, 'checkIn', date, config, {
      now,
      onSnapshot: async () => {
        await page
          .locator('#ContentPlaceHolder1_Table_record tr')
          .nth(1)
          .locator('td')
          .nth(1)
          .evaluate((e) => {
            e.textContent = '2026-10-19 08:40:00';
          });
      },
      beforeSend: () => assert.fail('record appeared before submission'),
    });

    assert.equal(result.status, 'already');
    assert.equal(result.snapshot.attendance.checkIn.at, '2026-10-19 08:40:00');
    assert.equal(posts(), 0);
  });
});

test('read-only click protection blocks the local fixture submit control before its confirm', async () => {
  await fixture({}, async ({ config, context, page, posts }) => {
    const guard = await installReadOnlyGuard(context, config);
    let dialogs = 0;

    page.on('dialog', (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });
    await readSiteSnapshot(page, date, config);
    await page.locator(config.site.checkIn.buttonSelector).click();
    await page.locator(config.site.checkOut.buttonSelector).click();
    assert.equal(dialogs, 0);
    assert.equal(posts(), 0);
    assert.equal(guard.blockedRequests, 0);
  });
});

test('toast verification works across form navigation', async () => {
  await fixture({ behavior: 'toast' }, async ({ config, page, posts }) => {
    const result = await punchOnPage(page, 'checkIn', date, config, { now, beforeSend: () => {} });

    assert.equal(result.status, 'success');
    assert.equal(posts(), 1);
  });
});

test('popup verification only observes the configured success element', async () => {
  await fixture({ behavior: 'popup' }, async ({ config, page, posts }) => {
    const result = await punchOnPage(page, 'checkIn', date, config, { now, beforeSend: () => {} });

    assert.equal(result.status, 'success');
    assert.equal(posts(), 0);
  });
});

test('an unexpected confirm is dismissed without POST or success', async () => {
  await fixture({ behavior: 'unexpected' }, async ({ config, page, posts }) => {
    await assert.rejects(punchOnPage(page, 'checkIn', date, config, { now, beforeSend: () => {} }));
    assert.equal(posts(), 0);
  });
});

test('a missing success message never resubmits after the first POST', async () => {
  await fixture({ behavior: 'none' }, async ({ config, page, posts }) => {
    await assert.rejects(
      punchOnPage(page, 'checkIn', date, config, { now, beforeSend: () => {} }),
      /超時/,
    );
    assert.equal(posts(), 1);
  });
});

test('a delayed response times out with no second submission or unhandled rejection', async () => {
  await fixture({ delay: 700 }, async ({ config, page, posts }) => {
    config.execution.verificationTimeoutMs = 300;
    await assert.rejects(punchOnPage(page, 'checkIn', date, config, { now, beforeSend: () => {} }));
    assert.equal(posts(), 1);
  });
});
