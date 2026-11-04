import { readConfig } from './common.js';
import { sendEmail } from './email.js';
import { describeEmailError } from './email-errors.js';

async function main(): Promise<void> {
  if (process.argv.slice(2).some((argument) => argument !== '--')) {
    throw new Error('不接受額外參數');
  }

  const config = readConfig();

  await sendEmail(config.email, {
    subject: '[attendance-bot] test email',
    text: '這是一封打卡工具的測試郵件。\n本次操作未執行打卡，也未修改出勤狀態。',
  });
  console.log('測試信已由 SMTP 接受，請檢查收件匣及垃圾郵件資料夾。');
}

main().catch((error) => {
  console.error(`測試信寄送失敗。${describeEmailError(error)}`);
  process.exitCode = 1;
});
