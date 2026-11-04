import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:tls';
import { promisify } from 'node:util';
import test from 'node:test';
import { ROOT } from '../src/common.js';

const execute = promisify(execFile);

test('email:test sends through local TLS SMTP without touching attendance and exits nonzero on failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'attendance-email-cli-'));
  // Use public fixture credentials and a self-signed certificate only on this local server.
  const cert = join(ROOT, 'tests', 'fixtures', 'smtp-test-cert.pem');
  const key = join(ROOT, 'tests', 'fixtures', 'smtp-test-key.pem');
  const messages: string[] = [];
  let connections = 0;
  let rejectRecipient = false;
  let authenticated = false;
  const smtp = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (socket) => {
    connections++;
    let buffer = '';
    let data: string[] | undefined;

    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.write('220 localhost fixture SMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;

      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);

        buffer = buffer.slice(end + 2);

        if (data) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = undefined;
            socket.write('250 accepted\r\n');
          } else {
            data.push(line);
          }
        } else if (line.startsWith('EHLO')) {
          socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        } else if (line.startsWith('AUTH PLAIN ')) {
          authenticated =
            Buffer.from(line.slice(11), 'base64').toString() === '\0fixture\0fixture-secret';
          socket.write(
            authenticated ? '235 authenticated\r\n' : '535 invalid fixture credentials\r\n',
          );
        } else if (line.startsWith('RCPT TO:') && rejectRecipient) {
          socket.write('550 fixture-secret recipient rejected\r\n');
        } else if (line === 'DATA') {
          data = [];
          socket.write('354 send message\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  try {
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    cpSync(join(ROOT, 'src'), join(root, 'src'), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(root, 'package.json'));
    cpSync(join(ROOT, 'config.defaults.json'), join(root, 'config.defaults.json'));
    symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'junction');
    mkdirSync(join(root, '.state'));
    mkdirSync(join(root, '.auth'));
    writeFileSync(join(root, '.state', 'unchanged.json'), 'attendance must not change');
    writeFileSync(join(root, '.auth', 'state.json'), 'not a real browser session');
    const config = {
      site: { url: 'http://127.0.0.1:1', attendanceUrl: 'http://127.0.0.1:1' },
      execution: { enabled: false },
      email: {
        enabled: true,
        host: '127.0.0.1',
        port: (smtp.address() as { port: number }).port,
        secure: true,
        user: 'fixture',
        password: 'fixture-secret',
        from: 'sender@example.test',
        to: 'recipient@example.test',
        timeoutMs: 3000,
      },
    };
    const saveConfig = () => writeFileSync(join(root, 'config.json'), JSON.stringify(config));
    const run = (password = 'fixture-secret', args: string[] = []) => {
      config.email.password = password;
      saveConfig();

      return execute(
        process.execPath,
        ['--import', 'tsx', join(root, 'src', 'email-test.ts'), ...args],
        {
          cwd: root,
          env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
          timeout: 15_000,
          windowsHide: true,
        },
      );
    };
    const expectFailure = async (operation: ReturnType<typeof run>, reason: RegExp) => {
      await assert.rejects(
        operation,
        (error: Error & { code?: number; stdout?: string; stderr?: string }) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr ?? '', /測試信寄送失敗/);
          assert.match(error.stderr ?? '', reason);
          assert.doesNotMatch(
            `${error.stdout}${error.stderr}`,
            /fixture-secret|recipient rejected/,
          );

          return true;
        },
      );
    };

    const success = await run();

    assert.match(success.stdout, /測試信已由 SMTP 接受/);
    assert.equal(authenticated, true);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Subject: \[attendance-bot\] test email/);
    assert.match(messages[0], /To: recipient@example.test/);
    assert.doesNotMatch(messages[0], /fixture-secret/);
    rejectRecipient = true;
    await expectFailure(run(), /EENVELOPE.*550/);
    assert.equal(messages.length, 1);
    await expectFailure(run('wrong-fixture-secret'), /EAUTH.*535/);
    assert.equal(messages.length, 1);
    const beforePreflight = connections;

    await expectFailure(run(''), /email\.password/);
    await expectFailure(run('fixture-secret', ['--unexpected']), /不接受額外參數/);
    config.email.enabled = false;
    await expectFailure(run(), /email\.enabled=true/);
    assert.equal(connections, beforePreflight);
    assert.deepEqual(readdirSync(join(root, '.state')), ['unchanged.json']);
    assert.equal(
      readFileSync(join(root, '.state', 'unchanged.json'), 'utf8'),
      'attendance must not change',
    );
    assert.equal(
      readFileSync(join(root, '.auth', 'state.json'), 'utf8'),
      'not a real browser session',
    );
    assert.equal(readdirSync(root).includes('logs'), false);
  } finally {
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
