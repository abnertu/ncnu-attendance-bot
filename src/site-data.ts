import type { BrowserContext, Frame, Page } from 'playwright';
import {
  type Action,
  type CalendarRule,
  type Config,
  type RecordRule,
  isDate,
  secondsOfTime,
} from './common.js';
import { openAttendanceView } from './navigation.js';

export type CalendarDay = { date: string; working: boolean | null; note: string };
export type CalendarMonth = { month: string; days: CalendarDay[] };
export type Attendance = Record<Action, { at: string | null }>;
export type SiteSnapshot = {
  date: string;
  fetchedAt: string;
  calendar: CalendarMonth | null;
  day: CalendarDay;
  attendance: Attendance;
};

const clean = (text: string) =>
  text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Parse only calendar cells, never the dashboard's unrelated personnel tables. */
export function parseCalendar(title: string, cells: string[], rule: CalendarRule): CalendarMonth {
  const match = new RegExp(rule.monthPattern).exec(clean(title));

  if (!match) {
    throw new Error('無法辨識網站行事曆的年月');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;

  if (!isDate(`${prefix}-01`)) {
    throw new Error('網站行事曆年月無效');
  }

  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: CalendarDay[] = [];

  for (const cell of cells) {
    const text = clean(cell);

    if (!text) {
      continue;
    }

    const dayMatch = new RegExp(rule.dayPattern).exec(text);

    if (!dayMatch) {
      throw new Error('行事曆日期格格式已變更，停止自動判讀');
    }

    const day = Number(dayMatch[1]);

    if (day < 1 || day > count) {
      throw new Error('行事曆包含無效日期');
    }

    const note = text.slice(dayMatch[1].length).trim();
    const holiday = rule.holidayTexts.some((word) => note.includes(word));
    const working = rule.workingTexts.some((word) => note.includes(word));
    const neutral = rule.neutralTexts.includes(note);

    days.push({
      date: `${prefix}-${String(day).padStart(2, '0')}`,
      working:
        holiday && working ? null : holiday ? false : working || !note || neutral ? true : null,
      note,
    });
  }

  if (days.length !== count || new Set(days.map((day) => day.date)).size !== count) {
    throw new Error('網站行事曆日期不完整或重複，停止自動判讀');
  }

  return { month: prefix, days: days.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Minute-only records use the end of that minute to avoid authorizing an early check-out. */
export function attendanceSeconds(date: string, value: string, rule: RecordRule): number {
  const match = new RegExp(rule.timestampPattern).exec(value);

  if (!match || match[1] !== date || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(match[2])) {
    throw new Error('網站時間格式或日期不符');
  }

  return secondsOfTime(match[2].length === 5 ? `${match[2]}:59` : match[2]);
}

export function parseAttendance(
  date: string,
  pageDate: string,
  rows: string[][],
  rule: RecordRule,
): Attendance {
  if (!isDate(date) || clean(pageDate) !== date) {
    throw new Error('打卡頁日期與查核日期不符');
  }

  const result = {} as Attendance;

  for (const action of ['checkIn', 'checkOut'] as const) {
    const matched = rows.filter(
      (row) => clean(row[rule.labelColumn] ?? '') === rule.labels[action],
    );

    if (matched.length !== 1 || matched[0][rule.timestampColumn] === undefined) {
      throw new Error(`無法唯一辨識 ${action} 的網站紀錄`);
    }

    const value = clean(matched[0][rule.timestampColumn]);

    if (rule.emptyTexts.includes(value)) {
      result[action] = { at: null };
      continue;
    }

    attendanceSeconds(date, value, rule);

    result[action] = { at: value };
  }

  return result;
}

export async function readCalendar(page: Page, config: Config): Promise<CalendarMonth> {
  const rule = config.site.calendar;

  await page.goto(rule.url, {
    waitUntil: 'domcontentloaded',
    timeout: config.execution.navigationTimeoutMs,
  });

  if (config.site.loginUrlContains && page.url().includes(config.site.loginUrlContains)) {
    throw new Error('Session 已過期，請重新執行 pnpm run login');
  }

  const table = page.locator(rule.tableSelector);

  await table.waitFor({ state: 'visible', timeout: config.execution.navigationTimeoutMs });

  if ((await table.count()) !== 1) {
    throw new Error('網站行事曆不唯一');
  }

  const title = await table.locator(rule.titleSelector).innerText();
  const cells = await table.locator(rule.dayCellSelector).allInnerTexts();

  return parseCalendar(title, cells, rule);
}

export async function readAttendance(
  root: Page | Frame,
  date: string,
  config: Config,
): Promise<Attendance> {
  const rule = config.site.records;
  const table = root.locator(rule.tableSelector);

  await table.waitFor({ state: 'visible', timeout: config.execution.navigationTimeoutMs });

  if ((await table.count()) !== 1) {
    throw new Error('網站簽到退紀錄表不唯一');
  }

  const pageDate = await root.locator(rule.dateSelector).inputValue();
  const rows = await table
    .locator(rule.rowSelector)
    .evaluateAll((elements) =>
      elements.map((element) =>
        Array.from(
          element.querySelectorAll(':scope > td, :scope > th'),
          (cell) => cell.textContent ?? '',
        ),
      ),
    );

  return parseAttendance(date, pageDate, rows, rule);
}

export async function readSiteSnapshot(page: Page, date: string, config: Config) {
  const calendar = config.site.calendar.enabled ? await readCalendar(page, config) : null;
  const day = calendar
    ? calendar.days.find((day) => day.date === date)
    : {
        date,
        working: config.schedule.workingDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
        note: '使用手動工作日設定',
      };

  if (!day || day.working === null) {
    throw new Error('網站行事曆無法確認今日是否上班，停止操作');
  }

  const effectiveDay = config.schedule.skipDates.includes(date)
    ? { date, working: false, note: '使用者指定暫停日期' }
    : day;
  const root = await openAttendanceView(page, config);
  const attendance = await readAttendance(root, date, config);
  const snapshot: SiteSnapshot = {
    date,
    fetchedAt: new Date().toISOString(),
    calendar,
    day: effectiveDay,
    attendance,
  };

  return { snapshot, root };
}

/** Read-only commands also block attendance writes at the request boundary. */
export async function installReadOnlyGuard(context: BrowserContext, config: Config) {
  const fields = [config.site.checkIn.submitField, config.site.checkOut.submitField].filter(
    Boolean,
  ) as string[];
  const attendanceUrl = config.site.attendanceUrl ? new URL(config.site.attendanceUrl) : null;
  const audit = { blockedRequests: 0 };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const data = new URLSearchParams(request.postData() ?? '');
    const attendanceWrite =
      request.method() !== 'GET' &&
      request.method() !== 'HEAD' &&
      ((attendanceUrl &&
        url.origin === attendanceUrl.origin &&
        url.pathname === attendanceUrl.pathname) ||
        fields.some((field) => data.has(field) || data.get('__EVENTTARGET') === field));

    if (attendanceWrite) {
      audit.blockedRequests++;
      await route.abort('blockedbyclient');
    } else {
      await route.fallback();
    }
  });
  await context.addInitScript(
    ({ fields }) => {
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target;

          if (!(target instanceof Element)) {
            return;
          }

          const control = target.closest('input,button');

          if (control && fields.includes(control.getAttribute('name') ?? '')) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true,
      );
    },
    { fields },
  );

  return audit;
}
