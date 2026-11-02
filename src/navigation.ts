import { setTimeout as delay } from 'node:timers/promises';
import type { Frame, Page } from 'playwright';
import type { Config } from './common.js';

/**
 * Step 1: 在選單 Frame hover「資料作業」, 再點擊「線上簽到退」。
 * Step 2: 按真正呈現的打卡按鈕/狀態, 自動定位打卡內容所在的 Frame。
 * 因此目標是 <frame> 或 <iframe>, 乃至巢狀子 Frame, 都不影響定位。
 * 此函式只做導覽, 不會點擊簽到/簽退。
 */
export async function openAttendanceView(page: Page, config: Config): Promise<Page | Frame> {
  const timeout = config.execution.navigationTimeoutMs;

  await page.goto(config.site.attendanceUrl || config.site.url, {
    waitUntil: 'domcontentloaded',
    timeout,
  });

  if (config.site.loginUrlContains && page.url().includes(config.site.loginUrlContains)) {
    throw new Error('Session 已過期, 請重新執行 pnpm run login');
  }

  if (!config.site.attendanceUrl && config.site.navigationSelector) {
    // navigationFrameSelector 是 <frame>/<iframe> 元素的 CSS selector,
    // 例如 frame[name="subap_frame"]。
    const navigationRoot = config.site.navigationFrameSelector
      ? page.frameLocator(config.site.navigationFrameSelector)
      : page;

    if (config.site.navigationFrameSelector) {
      await page.locator(config.site.navigationFrameSelector).waitFor({
        state: 'attached',
        timeout,
      });
    }

    // Hover 必須在點擊子選單之前, 否則「線上簽到退」可能仍然隱藏。
    if (config.site.navigationHoverSelector) {
      const hoverTarget = navigationRoot.locator(config.site.navigationHoverSelector);

      await hoverTarget.waitFor({ state: 'visible', timeout });

      if ((await hoverTarget.count()) !== 1) {
        throw new Error(`hover selector 不唯一: ${config.site.navigationHoverSelector}`);
      }

      await hoverTarget.hover({ timeout });
    }

    const entry = navigationRoot.locator(config.site.navigationSelector);

    await entry.waitFor({ state: 'visible', timeout });
    const count = await entry.count();

    if (count !== 1) {
      throw new Error(
        `navigationSelector 匹配到 ${count} 個元素: ${config.site.navigationSelector}`,
      );
    }

    await entry.click({ timeout });
  }

  // 如果沒有指定目標 Frame, 仍優先查找可辨識的簽到/簽退內容。
  // 避免依賴 iframe#main 一定是主頁的直屬 iframe (舊式 frameset 常不是)。
  const selectors = [
    config.site.checkIn.buttonSelector,
    config.site.checkOut.buttonSelector,
    config.site.checkIn.alreadySelector,
    config.site.checkOut.alreadySelector,
  ].filter((selector): selector is string => Boolean(selector));

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const matchedFrames: Frame[] = [];

    for (const frame of page.frames()) {
      let matched = false;

      for (const selector of selectors) {
        try {
          if (await frame.locator(selector).first().isVisible()) {
            matched = true;
            break;
          }
        } catch {
          // Frame 可能正在重新載入或 detach, 下一輪再檢查。
        }
      }

      if (matched) {
        matchedFrames.push(frame);
      }
    }

    if (matchedFrames.length === 1) {
      const frame = matchedFrames[0];

      console.log(`[navigation] 打卡 Frame: name="${frame.name()}", url=${frame.url()}`);

      return frame;
    }

    if (matchedFrames.length > 1) {
      // 如果多個 Frame 有相同文字, frameSelector 可用來明確指定目標。
      if (config.site.frameSelector) {
        const preferred: Frame[] = [];

        for (const frame of matchedFrames) {
          if (!frame.parentFrame()) {
            continue;
          }

          try {
            const matches = await frame
              .frameElement()
              .then((element) =>
                element.evaluate(
                  (node, css) => node instanceof Element && node.matches(css),
                  config.site.frameSelector!,
                ),
              );

            if (matches) {
              preferred.push(frame);
            }
          } catch {
            // 可能 detach, 下一輪再檢查。
          }
        }

        if (preferred.length === 1) {
          return preferred[0];
        }
      }

      throw new Error(
        `多個 Frame 都出現打卡元素, 請指定 frameSelector。候選: ${matchedFrames.map((f) => `${f.name()} (${f.url()})`).join('; ')}`,
      );
    }

    await delay(300);
  }

  const details = page
    .frames()
    .map(
      (frame) =>
        `name="${frame.name()}", url=${frame.url()}, parent="${frame.parentFrame()?.name() ?? '(root)'}"`,
    );

  throw new Error(
    `找不到任何 Frame 內可見的簽到/簽退按鈕或狀態。已載入 Frames: ${details.join(' | ')}`,
  );
}
