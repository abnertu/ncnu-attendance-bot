import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Plan, readConfig } from '../src/common.js';
import { notifyPunchSuccess } from '../src/email.js';

function fixture() {
  const config = readConfig(join(tmpdir(), 'attendance-email-no-overrides.json'));
  const plan: Plan = {
    date: '2026-10-19',
    checkIn: {
      at: '08:00:00',
      status: 'success',
      updatedAt: '2026-10-19T00:00:01Z',
      detail: '網站成功訊息',
    },
    checkOut: {
      at: '17:00:00',
      status: 'success',
      updatedAt: '2026-10-19T09:00:01Z',
      detail: '網站成功訊息',
    },
  };

  Object.assign(config.email, {
    enabled: true,
    host: 'smtp.example.test',
    from: 'sender@example.test',
    to: 'recipient@example.test',
    user: 'sender@example.test',
    passwordEnv: 'ATTENDANCE_SMTP_PASSWORD',
  });

  return { config, plan };
}

test('successful punches compose an email with the action, date and confirmation through Nodemailer', async () => {
  for (const action of ['checkIn', 'checkOut'] as const) {
    const { config, plan } = fixture();

    config.email.secure = action === 'checkOut';
    config.email.port = config.email.secure ? 465 : 587;
    let sends = 0;
    const result = await notifyPunchSuccess(action, plan, config, {
      logger: () => {},
      env: { ATTENDANCE_SMTP_PASSWORD: 'fixture-secret' },
      send: async (smtp, message) => {
        sends++;
        assert.equal(smtp.secure || smtp.requireTLS, true, 'credentials require TLS');
        assert.equal(smtp.port, config.email.port);
        assert.deepEqual(smtp.auth, { user: config.email.user, pass: 'fixture-secret' });
        const transport = nodemailer.createTransport({ jsonTransport: true });
        const info = await transport.sendMail(message);
        const mail = JSON.parse(info.message);

        assert.equal(mail.from.address, config.email.from);
        assert.equal(mail.to[0].address, config.email.to);
        assert.equal(
          mail.subject,
          `2026-10-19 ${action === 'checkIn' ? '上班簽到' : '下班簽退'}成功`,
        );
        assert.ok(mail.text.includes(plan[action].updatedAt));
        assert.ok(mail.text.includes(plan[action].detail));
        assert.ok(!info.message.includes('fixture-secret'));
      },
    });

    assert.equal(result?.status, 'sent');
    assert.equal(plan[action].status, 'success');
    assert.equal(sends, 1);
  }
});

test('disabled notifications, existing records and unconfirmed submissions never send email', async () => {
  const { config, plan } = fixture();
  const options = { send: async () => assert.fail('unexpected email'), logger: () => {} };

  config.email.enabled = false;
  assert.equal(await notifyPunchSuccess('checkIn', plan, config, options), undefined);
  config.email.enabled = true;

  for (const status of [
    'pending',
    'started',
    'already',
    'missed',
    'needs-review',
    'skipped',
  ] as const) {
    plan.checkIn.status = status;
    assert.equal(await notifyPunchSuccess('checkIn', plan, config, options), undefined);
  }

  plan.checkIn.status = 'success';
  plan.checkIn.email = { status: 'sent', updatedAt: new Date().toISOString(), detail: 'sent' };
  assert.equal(await notifyPunchSuccess('checkIn', plan, config, options), undefined);
  plan.checkIn.email.status = 'failed';
  assert.equal(await notifyPunchSuccess('checkIn', plan, config, options), undefined);
});

test('missing SMTP credentials fail notification without changing attendance or exposing secrets', async () => {
  const { config, plan } = fixture();
  const result = await notifyPunchSuccess('checkIn', plan, config, {
    env: {},
    logger: () => {},
    send: async () => assert.fail('missing credentials must not open a connection'),
  });

  assert.equal(result?.status, 'failed');
  assert.equal(plan.checkIn.status, 'success');
});

test('SMTP errors preserve successful attendance and omit server responses from state and logs', async () => {
  const { config, plan } = fixture();
  const logs: string[] = [];
  const result = await notifyPunchSuccess('checkOut', plan, config, {
    env: { ATTENDANCE_SMTP_PASSWORD: 'fixture-secret' },
    logger: (message) => logs.push(message),
    send: async () => {
      throw new Error('535 fixture-secret server-response');
    },
  });

  assert.equal(result?.status, 'failed');
  assert.equal(plan.checkOut.status, 'success');
  assert.ok(logs[0].includes('EMAIL_FAILED'));
  assert.doesNotMatch(JSON.stringify({ result, logs }), /fixture-secret|server-response/);
});
