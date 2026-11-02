import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATE_DIR, ensureDirs } from './common.js';

/** A scheduled run and a manual run must not read the same pending plan together. */
export function acquireRunLock(file = resolve(STATE_DIR, 'run.lock')): () => void {
  ensureDirs();

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;

    try {
      fd = openSync(file, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      let pid: number;

      try {
        pid = JSON.parse(readFileSync(file, 'utf8')).pid;
      } catch (cause) {
        throw new Error('執行鎖正在建立或內容無效，停止本次操作', { cause });
      }

      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error('執行鎖內容無效', { cause: error });
      }

      try {
        process.kill(pid, 0);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') {
          // Serialize stale-lock recovery so two processes cannot remove each other's new lock.
          const recovery = `${file}.recovery`;
          let recoveryFd: number;

          try {
            recoveryFd = openSync(recovery, 'wx', 0o600);
          } catch {
            throw new Error('另一個程序正在處理殘留的執行鎖，停止本次操作');
          }

          try {
            if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).pid === pid) {
              unlinkSync(file);
            }
          } finally {
            closeSync(recoveryFd);
            unlinkSync(recovery);
          }

          continue;
        }
      }

      throw new Error('已有另一個打卡程序執行中，停止本次操作', { cause: error });
    }

    writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    closeSync(fd);

    return () => {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    };
  }

  throw new Error('無法取得執行鎖');
}
