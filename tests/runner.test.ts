import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createSmtpServer } from 'node:net';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Plan, ROOT, localClock } from '../src/common.js';

const execute = promisify(execFile);

test('runner saves successful attendance before SMTP and never repeats a punch after email failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'attendance-runner-'));
  const clock = localClock('Asia/Taipei');
  const at = [
    Math.floor(clock.seconds / 3600),
    Math.floor((clock.seconds % 3600) / 60),
    clock.seconds % 60,
  ]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  const stateFile = join(root, '.state', `${clock.date}.json`);
  let posts = 0;
  let smtpConnections = 0;
  let savedBeforeEmail = false;
  const smtp = createSmtpServer((socket) => {
    smtpConnections++;
    savedBeforeEmail = JSON.parse(readFileSync(stateFile, 'utf8')).checkIn.status === 'success';
    socket.on('error', () => {});
    socket.write('220 fixture SMTP\r\n');
    socket.on('data', () => socket.end('454 fixture SMTP unavailable\r\n'));
  });
  const website = createHttpServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'unsafe-inline'; form-action 'self'",
    );
    const submitted = request.method === 'POST';

    if (submitted) {
      posts++;
      request.resume();
    }

    response.end(`<!doctype html><html><body>
      <input id="ContentPlaceHolder1_HiddenField_humwr_date" type="hidden" value="${clock.date}">
      <table id="ContentPlaceHolder1_Table_record"><tbody>
        <tr><td>上班簽到</td><td></td></tr><tr><td>下班簽退</td><td></td></tr>
      </tbody></table>
      <form method="post"><input type="submit" id="ContentPlaceHolder1_Button_humwr_amst_hum_wkrecord"
        name="ctl00$ContentPlaceHolder1$Button_humwr_amst_hum_wkrecord" value="上班簽到"
        onclick="return confirm('確定要簽到?');"></form>
      ${submitted ? '<script>alert("線上刷卡成功");</script>' : ''}
      </body></html>`);
  });

  try {
    await Promise.all([
      new Promise<void>((resolve) => website.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve)),
    ]);
    const url = `http://127.0.0.1:${(website.address() as { port: number }).port}/attendance`;

    cpSync(join(ROOT, 'src'), join(root, 'src'), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(root, 'package.json'));
    cpSync(join(ROOT, 'config.defaults.json'), join(root, 'config.defaults.json'));
    symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'junction');
    mkdirSync(join(root, '.auth'));
    mkdirSync(join(root, '.state'));
    writeFileSync(join(root, '.auth', 'state.json'), JSON.stringify({ cookies: [], origins: [] }));
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({
        site: { url, attendanceUrl: url, calendar: { enabled: false } },
        schedule: {
          workingDays: [clock.weekday],
          checkIn: { from: '00:00', to: '00:00' },
          checkOut: { from: '23:59', to: '23:59' },
        },
        execution: {
          enabled: true,
          headless: true,
          maxLateSeconds: 3600,
          navigationTimeoutMs: 3000,
          verificationTimeoutMs: 1500,
        },
        email: {
          enabled: true,
          host: '127.0.0.1',
          port: (smtp.address() as { port: number }).port,
          from: 'sender@example.test',
          to: 'recipient@example.test',
          timeoutMs: 1000,
        },
      }),
    );
    const plan: Plan = {
      date: clock.date,
      checkIn: { at, status: 'pending' },
      checkOut: { at: '23:59:00', status: 'missed' },
    };

    writeFileSync(stateFile, JSON.stringify(plan));
    const run = () =>
      execute(process.execPath, ['--import', 'tsx', join(root, 'src', 'runner.ts')], {
        cwd: root,
        timeout: 20_000,
        windowsHide: true,
      });
    const first = await run();
    const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as Plan;

    assert.match(first.stdout, /EMAIL_FAILED/);
    assert.equal(savedBeforeEmail, true);
    assert.equal(saved.checkIn.status, 'success');
    assert.equal(saved.checkIn.email?.status, 'failed');
    assert.equal(posts, 1);
    assert.equal(smtpConnections, 1);
    await run();
    assert.equal(posts, 1);
    assert.equal(smtpConnections, 1);
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => website.close(() => resolve())),
      new Promise<void>((resolve) => smtp.close(() => resolve())),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});
