import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { type Action, type Config, type EmailResult, type Plan, log } from './common.js';

type EmailOptions = {
  send?: (smtp: SMTPTransport.Options, message: Mail.Options) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  logger?: (message: string) => void;
};

async function sendSmtp(smtp: SMTPTransport.Options, message: Mail.Options): Promise<void> {
  const transport = nodemailer.createTransport(smtp);

  try {
    const info = await transport.sendMail(message);

    if (!info.accepted.length || info.rejected.length) {
      throw new Error('SMTP 未接受全部收件者');
    }
  } finally {
    transport.close();
  }
}

/** Call only after saving the confirmed punch result. Email failures never authorize another punch. */
export async function notifyPunchSuccess(
  action: Action,
  plan: Plan,
  config: Config,
  options: EmailOptions = {},
): Promise<EmailResult | undefined> {
  const email = config.email;
  const job = plan[action];

  if (!email.enabled || job.status !== 'success' || job.email) {
    return;
  }

  const writeLog = options.logger ?? log;
  const label = action === 'checkIn' ? '上班簽到' : '下班簽退';

  try {
    const password = email.passwordEnv
      ? (options.env ?? process.env)[email.passwordEnv]
      : undefined;

    if (email.user && !password) {
      throw new Error('SMTP 密碼環境變數未設定');
    }

    await (options.send ?? sendSmtp)(
      {
        host: email.host,
        port: email.port,
        secure: email.secure,
        requireTLS: !email.secure,
        auth: email.user ? { user: email.user, pass: password } : undefined,
        connectionTimeout: email.timeoutMs,
        greetingTimeout: email.timeoutMs,
        socketTimeout: email.timeoutMs,
        dnsTimeout: email.timeoutMs,
        disableFileAccess: true,
        disableUrlAccess: true,
      },
      {
        from: email.from,
        to: email.to,
        subject: `${plan.date} ${label}成功`,
        text: [
          `${plan.date} ${label}成功。`,
          `確認時間：${job.updatedAt}。`,
          `網站回覆：${job.detail}。`,
          '出勤報表可能延後更新。',
        ].join('\n'),
      },
    );
    writeLog(`${plan.date} ${action}: EMAIL_SENT`);

    return { status: 'sent', updatedAt: new Date().toISOString(), detail: 'SMTP 已接受郵件' };
  } catch {
    // SMTP errors can contain credentials or server responses. Keep them out of logs and state.
    const detail = '寄信失敗，請檢查 SMTP 設定、密碼環境變數及連線；打卡成功狀態不變';

    writeLog(`${plan.date} ${action}: EMAIL_FAILED ${detail}`);

    return { status: 'failed', updatedAt: new Date().toISOString(), detail };
  }
}
