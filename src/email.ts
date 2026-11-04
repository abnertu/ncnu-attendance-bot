import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { type Action, type Config, type EmailResult, type Plan, log } from './common.js';
import { describeEmailError } from './email-errors.js';

type EmailOptions = {
  send?: (smtp: SMTPTransport.Options, message: Mail.Options) => Promise<void>;
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

export async function sendEmail(
  email: Config['email'],
  message: Pick<Mail.Options, 'subject' | 'text'>,
  options: Pick<EmailOptions, 'send'> = {},
): Promise<void> {
  if (!email.enabled) {
    throw new Error('請先在 config.json 設定 email.enabled=true');
  }

  if (email.user && !email.password) {
    throw new Error('SMTP 密碼未設定，請填入 email.password');
  }

  await (options.send ?? sendSmtp)(
    {
      host: email.host,
      port: email.port,
      secure: email.secure,
      requireTLS: !email.secure,
      auth: email.user ? { user: email.user, pass: email.password } : undefined,
      connectionTimeout: email.timeoutMs,
      greetingTimeout: email.timeoutMs,
      socketTimeout: email.timeoutMs,
      dnsTimeout: email.timeoutMs,
      disableFileAccess: true,
      disableUrlAccess: true,
    },
    { ...message, from: email.from, to: email.to },
  );
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
    await sendEmail(
      email,
      {
        subject: `${plan.date} ${label}成功`,
        text: [
          `${plan.date} ${label}成功。`,
          `確認時間：${job.updatedAt}。`,
          `網站回覆：${job.detail}。`,
          '出勤報表可能延後更新。',
        ].join('\n'),
      },
      options,
    );
    writeLog(`${plan.date} ${action}: EMAIL_SENT`);

    return { status: 'sent', updatedAt: new Date().toISOString(), detail: 'SMTP 已接受郵件' };
  } catch (error) {
    // SMTP errors can contain credentials or server responses. Keep them out of logs and state.
    const detail = `寄信失敗。${describeEmailError(error)} 打卡成功狀態不變。`;

    writeLog(`${plan.date} ${action}: EMAIL_FAILED ${detail}`);

    return { status: 'failed', updatedAt: new Date().toISOString(), detail };
  }
}
