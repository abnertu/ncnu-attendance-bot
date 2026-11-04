import { randomInt } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const AUTH = resolve(ROOT, '.auth', 'state.json');
export const STATE_DIR = resolve(ROOT, '.state');
export const LOG_DIR = resolve(ROOT, 'logs');
export type Action = 'checkIn' | 'checkOut';
export type Status =
  'pending' | 'started' | 'success' | 'already' | 'missed' | 'needs-review' | 'skipped';
export type Window = { from: string; to: string };
export type Rule = {
  buttonSelector: string;
  submitField?: string;
  alreadySelector: string;
  successSelector: string;
  successDialogContains?: string;
  successDialogType?: 'alert' | 'confirm';
  successPopupSelector?: string;
  acceptConfirmDialogs?: boolean;
  confirmDialogContains?: string;
  confirmSelector?: string;
};
export type CalendarRule = {
  enabled: boolean;
  url: string;
  tableSelector: string;
  titleSelector: string;
  dayCellSelector: string;
  monthPattern: string;
  dayPattern: string;
  holidayTexts: string[];
  workingTexts: string[];
  neutralTexts: string[];
};
export type RecordRule = {
  tableSelector: string;
  rowSelector: string;
  dateSelector: string;
  labelColumn: number;
  timestampColumn: number;
  timestampPattern: string;
  emptyTexts: string[];
  labels: Record<Action, string>;
};
export type Config = {
  email: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
    to: string;
    timeoutMs: number;
  };
  site: {
    url: string;
    attendanceUrl?: string;
    loginUrl?: string;
    loginUrlContains?: string;
    frameSelector?: string;
    navigationSelector?: string;
    navigationHoverSelector?: string;
    navigationFrameSelector?: string;
    calendar: CalendarRule;
    records: RecordRule;
    checkIn: Rule;
    checkOut: Rule;
  };
  schedule: {
    timezone: string;
    workingDays: number[];
    skipDates: string[];
    checkIn: Window;
    checkOut: Window;
  };
  execution: {
    enabled: boolean;
    headless: boolean;
    maxLateSeconds: number;
    navigationTimeoutMs: number;
    verificationTimeoutMs: number;
  };
};
export type EmailResult = { status: 'sent' | 'failed'; updatedAt: string; detail: string };
export type Job = {
  at: string;
  status: Status;
  updatedAt?: string;
  detail?: string;
  email?: EmailResult;
};
export type Plan = { date: string; checkIn: Job; checkOut: Job };

export function ensureDirs() {
  for (const dir of [resolve(ROOT, '.auth'), STATE_DIR, LOG_DIR]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function parseHHMM(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`時間格式應為 HH:mm: ${value}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    throw new Error(`時間不正確: ${value}`);
  }

  return hour * 3600 + minute * 60;
}

function checkWindow(window: Window): [number, number] {
  const from = parseHHMM(window.from);
  const to = parseHHMM(window.to) + 59;

  if (to < from) {
    throw new Error('時間區間不可跨日或倒置');
  }

  return [from, to];
}

export function mergeConfig(defaults: unknown, overrides: unknown): unknown {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    return overrides;
  }

  const result: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };

  for (const [key, value] of Object.entries(overrides)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error('設定含有不允許的欄位');
    }

    result[key] = mergeConfig(result[key], value);
  }

  return result;
}

export function readConfig(file = resolve(ROOT, 'config.json')): Config {
  const defaults = JSON.parse(readFileSync(resolve(ROOT, 'config.defaults.json'), 'utf8'));
  const overrides = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const config = mergeConfig(defaults, overrides) as Config;

  validateConfig(config);

  return config;
}

export function validateConfig(config: Config): void {
  if (!/^https?:\/\//.test(config.site.url)) {
    throw new Error('site.url 必須為 HTTP(S) URL');
  }

  if (config.site.loginUrl && !/^https?:\/\//.test(config.site.loginUrl)) {
    throw new Error('site.loginUrl 必須為 HTTP(S) URL');
  }

  for (const url of [config.site.attendanceUrl, config.site.calendar?.url]) {
    if (url && !/^https?:\/\//.test(url)) {
      throw new Error('網站網址必須為 HTTP(S) URL');
    }
  }

  if (config.site.frameSelector !== undefined && typeof config.site.frameSelector !== 'string') {
    throw new Error('site.frameSelector 必須為字串');
  }

  if (
    config.site.navigationFrameSelector !== undefined &&
    typeof config.site.navigationFrameSelector !== 'string'
  ) {
    throw new Error('site.navigationFrameSelector 必須為字串');
  }

  if (config.site.navigationFrameSelector && !config.site.navigationSelector) {
    throw new Error('使用 navigationFrameSelector 時必須同時設定 navigationSelector');
  }

  if (
    config.site.navigationSelector !== undefined &&
    typeof config.site.navigationSelector !== 'string'
  ) {
    throw new Error('site.navigationSelector 必須為字串');
  }

  if (
    config.site.navigationHoverSelector !== undefined &&
    typeof config.site.navigationHoverSelector !== 'string'
  ) {
    throw new Error('site.navigationHoverSelector 必須為字串');
  }

  if (config.site.navigationHoverSelector && !config.site.navigationSelector) {
    throw new Error('設定 navigationHoverSelector 時也需要 navigationSelector');
  }

  for (const action of ['checkIn', 'checkOut'] as const) {
    const rule = config.site[action];

    if (!rule.buttonSelector) {
      throw new Error(`請設定 site.${action}.buttonSelector`);
    }

    if (!rule.successSelector && !rule.successDialogContains && !rule.successPopupSelector) {
      throw new Error(`site.${action} 需指定至少一種成功訊息判斷方式`);
    }

    if (rule.acceptConfirmDialogs && !rule.confirmDialogContains) {
      throw new Error(`site.${action} 允許 confirm 時必須指定 confirmDialogContains`);
    }
  }

  const [, inEnd] = checkWindow(config.schedule.checkIn);
  const [outStart] = checkWindow(config.schedule.checkOut);

  if (outStart <= inEnd) {
    throw new Error('簽退時間必須在簽到區間之後');
  }

  if (
    !Array.isArray(config.schedule.workingDays) ||
    !config.schedule.workingDays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  ) {
    throw new Error('workingDays 必須為 0 到 6 (星期日為 0)');
  }

  if (!Array.isArray(config.schedule.skipDates) || !config.schedule.skipDates.every(isDate)) {
    throw new Error('skipDates 必須為有效的 YYYY-MM-DD 日期陣列');
  }

  for (const key of ['enabled', 'headless'] as const) {
    if (typeof config.execution[key] !== 'boolean') {
      throw new Error(`execution.${key} 必須為布林值`);
    }
  }

  for (const key of ['maxLateSeconds', 'navigationTimeoutMs', 'verificationTimeoutMs'] as const) {
    const value = config.execution[key];

    if (!Number.isFinite(value) || value < (key === 'maxLateSeconds' ? 0 : 1)) {
      throw new Error(
        `execution.${key} 必須為有效的${key === 'maxLateSeconds' ? '非負' : '正'}數值`,
      );
    }
  }

  const email = config.email;

  if (!email || typeof email.enabled !== 'boolean' || typeof email.secure !== 'boolean') {
    throw new Error('email.enabled 與 email.secure 必須為布林值');
  }

  for (const key of ['host', 'user', 'password', 'from', 'to'] as const) {
    if (typeof email[key] !== 'string' || /[\r\n]/.test(email[key])) {
      throw new Error(`email.${key} 必須為單行字串`);
    }
  }

  if (!Number.isInteger(email.port) || email.port < 1 || email.port > 65535) {
    throw new Error('email.port 必須為 1 到 65535 的整數');
  }

  if (!Number.isFinite(email.timeoutMs) || email.timeoutMs < 1) {
    throw new Error('email.timeoutMs 必須為正數');
  }

  if (email.enabled && [email.host, email.from, email.to].some((value) => !value.trim())) {
    throw new Error('啟用寄信時必須設定 email.host、email.from 與 email.to');
  }

  if (Boolean(email.user) !== Boolean(email.password)) {
    throw new Error('email.user 與 email.password 必須同時設定或留空');
  }

  const calendar = config.site.calendar;

  if (!calendar || typeof calendar.enabled !== 'boolean') {
    throw new Error('請設定 calendar.enabled');
  }

  for (const key of [
    'url',
    'tableSelector',
    'titleSelector',
    'dayCellSelector',
    'monthPattern',
    'dayPattern',
  ] as const) {
    if (typeof calendar[key] !== 'string' || !calendar[key]) {
      throw new Error(`calendar.${key} 不可為空`);
    }
  }

  for (const key of ['holidayTexts', 'workingTexts', 'neutralTexts'] as const) {
    if (
      !Array.isArray(calendar[key]) ||
      !calendar[key].every((v) => typeof v === 'string' && v.length > 0)
    ) {
      throw new Error(`calendar.${key} 必須為非空字串的陣列`);
    }
  }

  const records = config.site.records;

  for (const key of ['tableSelector', 'rowSelector', 'dateSelector', 'timestampPattern'] as const) {
    if (typeof records?.[key] !== 'string' || !records[key]) {
      throw new Error(`records.${key} 不可為空`);
    }
  }

  for (const key of ['labelColumn', 'timestampColumn'] as const) {
    if (!Number.isInteger(records[key]) || records[key] < 0) {
      throw new Error(`records.${key} 必須為非負整數`);
    }
  }

  if (
    !Array.isArray(records.emptyTexts) ||
    !records.emptyTexts.every((v) => typeof v === 'string')
  ) {
    throw new Error('records.emptyTexts 必須為字串陣列');
  }

  for (const action of ['checkIn', 'checkOut'] as const) {
    if (!records.labels?.[action]) {
      throw new Error(`records.labels.${action} 不可為空`);
    }
  }

  new RegExp(calendar.monthPattern);
  new RegExp(calendar.dayPattern);
  new RegExp(records.timestampPattern);
  new Intl.DateTimeFormat('en-US', { timeZone: config.schedule.timezone });
}

export function isDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function localClock(timezone: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const entries = formatter.formatToParts(now).map((part) => [part.type, part.value]);
  const p = Object.fromEntries(entries) as Record<string, string>;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);

  if (weekday === -1) {
    throw new Error(`未知的星期字串: ${p.weekday}`);
  }

  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday,
    seconds: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
  };
}

export function secondsOfTime(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`無效的計畫時間: ${value}`);
  }

  const [hour, minute, second] = match.slice(1).map(Number);

  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`無效的計畫時間: ${value}`);
  }

  return hour * 3600 + minute * 60 + second;
}

export function randomTime(window: Window): string {
  const [start, end] = checkWindow(window);
  const seconds = randomInt(start, end + 1);
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;

  return [hour, minute, second].map((n) => String(n).padStart(2, '0')).join(':');
}

export function stateFile(date: string): string {
  return resolve(STATE_DIR, `${date}.json`);
}

export function loadOrCreatePlan(date: string, config: Config): Plan {
  const file = stateFile(date);

  if (existsSync(file)) {
    const plan = JSON.parse(readFileSync(file, 'utf8')) as Plan;

    if (plan.date !== date) {
      throw new Error('狀態檔日期不符');
    }

    for (const action of ['checkIn', 'checkOut'] as const) {
      const job = plan[action];

      if (
        !job ||
        !['pending', 'started', 'success', 'already', 'missed', 'needs-review', 'skipped'].includes(
          job.status,
        )
      ) {
        throw new Error('狀態檔格式無效，請先人工查核');
      }

      secondsOfTime(job.at);
    }

    return plan;
  }

  const plan: Plan = {
    date,
    checkIn: { at: randomTime(config.schedule.checkIn), status: 'pending' },
    checkOut: { at: randomTime(config.schedule.checkOut), status: 'pending' },
  };

  savePlan(plan);

  return plan;
}

export function savePlan(plan: Plan) {
  ensureDirs();
  const target = stateFile(plan.date);
  const tmp = `${target}.${process.pid}.tmp`;

  writeFileSync(tmp, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, target);
  chmodSync(target, 0o600);
}

export function log(message: string) {
  ensureDirs();
  const line = `${new Date().toISOString()} ${message}`;

  console.log(line);
  appendFileSync(resolve(LOG_DIR, 'attendance.log'), line + '\n', { mode: 0o600 });
}
