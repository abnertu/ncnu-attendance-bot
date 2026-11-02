import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeConfig, readConfig, validateConfig } from '../src/common.js';
import { parseAttendance, parseCalendar } from '../src/site-data.js';
import { acquireRunLock } from '../src/lock.js';

const config = readConfig(join(tmpdir(), 'attendance-test-no-overrides.json'));
const cells = (notes: Record<number, string> = {}) =>
  Array.from({ length: 31 }, (_, i) => `${i + 1} ${notes[i + 1] ?? ''}`);

test('missing user config loads usable JSON defaults with sending disabled', () => {
  assert.equal(config.execution.enabled, false);
  assert.equal(config.site.calendar.enabled, true);
  assert.ok(config.site.records.tableSelector);
  assert.equal(config.site.checkOut.acceptConfirmDialogs, true);
});

test('nested overrides preserve default selectors; arrays replace', () => {
  const merged = mergeConfig(config, {
    execution: { enabled: false },
    schedule: { skipDates: ['2026-10-26'] },
  }) as typeof config;

  validateConfig(merged);
  assert.equal(merged.site.records.tableSelector, config.site.records.tableSelector);
  assert.deepEqual(merged.schedule.skipDates, ['2026-10-26']);
});

test('readConfig merges a real JSON override file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attendance-config-'));

  try {
    const file = join(dir, 'config.json');

    writeFileSync(file, JSON.stringify({ schedule: { checkIn: { from: '08:05' } } }));
    const loaded = readConfig(file);

    assert.equal(loaded.schedule.checkIn.from, '08:05');
    assert.equal(loaded.schedule.checkIn.to, '08:15');
    assert.equal(loaded.execution.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unsafe booleans, invalid dates, timeouts and unscoped confirms fail validation', () => {
  for (const patch of [
    { execution: { enabled: 'false' } },
    { execution: { verificationTimeoutMs: 0 } },
    { execution: { maxLateSeconds: '180' } },
    { schedule: { skipDates: ['2026-02-30'] } },
    { site: { checkIn: { acceptConfirmDialogs: true, confirmDialogContains: '' } } },
  ]) {
    assert.throws(() => validateConfig(mergeConfig(config, patch) as typeof config));
  }
});

test('calendar reads website holidays and Saturday make-up workdays without weekday guessing', () => {
  const month = parseCalendar(
    '2026年10月',
    ['', ...cells({ 9: '國定假日', 18: '休息日', 31: '補行上班' }), ''],
    config.site.calendar,
  );

  assert.equal(month.days.find((d) => d.date === '2026-10-09')?.working, false);
  assert.equal(month.days.find((d) => d.date === '2026-10-18')?.working, false);
  assert.equal(month.days.find((d) => d.date === '2026-10-31')?.working, true);
});

test('unknown or conflicting calendar annotations are not assumed to be workdays', () => {
  const month = parseCalendar(
    '2026年10月',
    cells({ 19: '特殊排班待確認', 20: '國定假日 補班' }),
    config.site.calendar,
  );

  assert.equal(month.days[18].working, null);
  assert.equal(month.days[19].working, null);
});

test('incomplete calendars, duplicate dates and wrong month formats fail', () => {
  assert.throws(() => parseCalendar('2026年10月', cells().slice(1), config.site.calendar));
  assert.throws(() =>
    parseCalendar('2026年10月', [...cells().slice(1), '2'], config.site.calendar),
  );
  assert.throws(() => parseCalendar('not a calendar', cells(), config.site.calendar));
});

test('leap-year calendar validates the actual number of dates', () => {
  const days = Array.from({ length: 29 }, (_, i) => String(i + 1));

  assert.equal(parseCalendar('2028年2月', days, config.site.calendar).days.length, 29);
  assert.throws(() => parseCalendar('2027年2月', days, config.site.calendar));
});

const rows = [
  ['簽到退類別', '簽到退時間'],
  ['上班簽到', '2026-10-19 08:32:00'],
  ['下班簽退', '\u00a0'],
];

test('records distinguish a timestamp from an empty cell', () => {
  const data = parseAttendance('2026-10-19', '2026-10-19', rows, config.site.records);

  assert.equal(data.checkIn.at, '2026-10-19 08:32:00');
  assert.equal(data.checkOut.at, null);
});

test('yesterday, stale timestamps, duplicate rows, missing rows and invalid times stop execution', () => {
  assert.throws(() => parseAttendance('2026-10-19', '2026-10-18', rows, config.site.records));

  for (const badRows of [
    [['上班簽到', '2026-10-18 08:32:00'], rows[2]],
    [...rows, rows[1]],
    rows.slice(0, 2),
    [['上班簽到', '2026-10-19 99:32:00'], rows[2]],
    [['上班簽到', '無法讀取'], rows[2]],
  ]) {
    assert.throws(() => parseAttendance('2026-10-19', '2026-10-19', badRows, config.site.records));
  }
});

test('a second process cannot acquire the same run lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attendance-lock-'));
  const path = join(dir, 'run.lock');

  try {
    const release = acquireRunLock(path);

    assert.throws(() => acquireRunLock(path), /另一個/);
    release();
    acquireRunLock(path)();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a terminated process lock is recovered without leaving a recovery lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attendance-stale-lock-'));
  const path = join(dir, 'run.lock');

  try {
    const pid = Number(
      execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
        encoding: 'utf8',
      }),
    );

    writeFileSync(path, JSON.stringify({ pid }));
    const release = acquireRunLock(path);

    assert.throws(() => acquireRunLock(path), /另一個/);
    release();
    acquireRunLock(path)();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
