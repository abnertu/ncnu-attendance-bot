import type { Dialog, Page } from 'playwright';
import { type Action, type Config, localClock, log } from './common.js';
import { readAttendance, readSiteSnapshot, type SiteSnapshot } from './site-data.js';

export type PunchResult = {
  status: 'success' | 'already' | 'skipped' | 'missed';
  detail: string;
  snapshot: SiteSnapshot;
};
export type PunchOptions = {
  beforeSend: () => void;
  now?: () => Date;
  latestSeconds?: number;
  onSnapshot?: (snapshot: SiteSnapshot) => void | Promise<void>;
  logger?: (message: string) => void;
};

/** The only function that clicks attendance buttons. Tests use local fixture pages. */
export async function punchOnPage(
  page: Page,
  action: Action,
  date: string,
  config: Config,
  options: PunchOptions,
): Promise<PunchResult> {
  if (!config.execution.enabled) {
    throw new Error('實際送出已關閉；唯讀檢查請使用 pnpm run sync');
  }

  const { snapshot, root } = await readSiteSnapshot(page, date, config);

  await options.onSnapshot?.(snapshot);
  const result = (status: PunchResult['status'], detail: string): PunchResult => ({
    status,
    detail,
    snapshot,
  });
  const currentClock = () => localClock(config.schedule.timezone, options.now?.() ?? new Date());

  if (currentClock().date !== date) {
    throw new Error('日期已變更，停止操作');
  }

  if (!snapshot.day.working) {
    return result('skipped', snapshot.day.note || '網站行事曆顯示今日放假');
  }

  if (snapshot.attendance[action].at) {
    return result('already', `網站已有紀錄：${snapshot.attendance[action].at}`);
  }

  if (options.latestSeconds !== undefined && currentClock().seconds > options.latestSeconds) {
    return result('missed', '完成網站查核時已超出允許的執行時間，未送出');
  }

  const rule = config.site[action];
  const writeLog = options.logger ?? log;
  const timeout = config.execution.verificationTimeoutMs;
  const button = root.locator(rule.buttonSelector);

  await button.waitFor({ state: 'visible', timeout });

  if ((await button.count()) !== 1 || !(await button.isEnabled())) {
    throw new Error('打卡按鈕不唯一或無法操作');
  }

  const success = rule.successSelector ? root.locator(rule.successSelector) : null;

  if (success && (await success.first().isVisible())) {
    throw new Error('送出前已存在成功文字，無法確認本次結果');
  }

  let actionStarted = false;
  let resolveDialog!: (value: string) => void;
  let rejectDialog!: (error: Error) => void;
  const dialogResult = new Promise<string>((resolve, reject) => {
    resolveDialog = resolve;
    rejectDialog = reject;
  });
  let resolvePopup!: (value: string) => void;
  const popupResult = new Promise<string>((resolve) => {
    resolvePopup = resolve;
  });
  const onDialog = (dialog: Dialog) => {
    void (async () => {
      const type = dialog.type();
      const message = dialog.message();

      writeLog(`${date} ${action}: DIALOG [${type}] ${message}`);
      const expectedConfirm =
        type === 'confirm' &&
        actionStarted &&
        rule.acceptConfirmDialogs === true &&
        Boolean(rule.confirmDialogContains && message.includes(rule.confirmDialogContains));
      const accepted = type === 'alert' || expectedConfirm;
      // Capture success before accepting a dialog can trigger a navigation.
      const matched =
        actionStarted &&
        accepted &&
        type === (rule.successDialogType ?? 'alert') &&
        Boolean(rule.successDialogContains && message.includes(rule.successDialogContains));

      if (accepted) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }

      if (matched) {
        resolveDialog(`JavaScript ${type}：${message}`);
      }

      if (type === 'confirm' && !expectedConfirm) {
        rejectDialog(new Error('遇到未允許的確認視窗，已取消'));
      }
    })().catch((error) => rejectDialog(error instanceof Error ? error : new Error(String(error))));
  };
  const onPopup = (popup: Page) => {
    popup.on('dialog', onDialog);

    if (actionStarted && rule.successPopupSelector) {
      void popup
        .locator(rule.successPopupSelector)
        .waitFor({ state: 'visible', timeout })
        .then(() => resolvePopup('新開視窗成功訊息'))
        .catch(() => {});
    }
  };

  page.on('dialog', onDialog);
  page.context().on('page', onPopup);
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const outcomes: Promise<string>[] = [dialogResult];

    if (success) {
      outcomes.push(success.waitFor({ state: 'visible', timeout }).then(() => '頁面成功文字'));
    }

    if (rule.alreadySelector) {
      outcomes.push(
        root
          .locator(rule.alreadySelector)
          .waitFor({ state: 'visible', timeout })
          .then(() => '頁面已完成狀態'),
      );
    }

    if (rule.successPopupSelector) {
      outcomes.push(popupResult);
    }

    const confirmed = Promise.any(outcomes);

    // Attach a rejection handler before click; a failed click must not leave an unhandled rejection.
    void confirmed.catch(() => {});

    // Re-read records immediately before sending, after all UI waits have completed.
    const latest = await readAttendance(root, date, config);

    snapshot.attendance = latest;

    if (latest[action].at) {
      return result('already', `送出前查到網站紀錄：${latest[action].at}`);
    }

    const clock = currentClock();

    if (clock.date !== date) {
      throw new Error('日期已變更，停止操作');
    }

    if (options.latestSeconds !== undefined && clock.seconds > options.latestSeconds) {
      return result('missed', '已超出允許時間，未送出');
    }

    options.beforeSend();
    actionStarted = true;
    const operation = (async () => {
      await button.click({ timeout });

      if (rule.confirmSelector) {
        await root.locator(rule.confirmSelector).click({ timeout });
      }

      return await confirmed;
    })();
    const source = await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('超時：未收到可確認的成功訊息，請查核網站紀錄')),
          timeout,
        );
      }),
    ]);

    writeLog(`${date} ${action}: SUCCESS (${source})`);

    return result('success', source);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }

    page.off('dialog', onDialog);
    page.context().off('page', onPopup);
  }
}
