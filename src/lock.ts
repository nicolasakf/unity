import fs from "node:fs/promises";
import path from "node:path";
import { findScopeLockPath, lockPath } from "./paths.js";
import type { Scope } from "./types.js";

const STALE_LOCK_MS = 30 * 60 * 1000;

export async function withScopeLock<T>(scope: Scope, cwd: string, task: () => Promise<T>): Promise<T> {
  const existing = await findScopeLockPath(scope, cwd);
  if (existing && existing !== lockPath(scope, cwd)) {
    if (!(await isStaleLockFile(existing))) {
      throw new Error(`Another Unity operation is already running for ${scope}. Lock file: ${existing}`);
    }
    await fs.rm(existing, { force: true });
  }

  const filePath = lockPath(scope, cwd);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const release = await acquireLock(filePath, scope);

  try {
    return await task();
  } finally {
    await release();
  }
}

async function acquireLock(filePath: string, scope: Scope): Promise<() => Promise<void>> {
  try {
    const handle = await fs.open(filePath, "wx");
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, scope, createdAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8"
    );
    await handle.close();
    return async () => {
      await fs.rm(filePath, { force: true });
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  if (await isStaleLockFile(filePath)) {
    await fs.rm(filePath, { force: true });
    return acquireLock(filePath, scope);
  }

  throw new Error(`Another Unity operation is already running for ${scope}. Lock file: ${filePath}`);
}

export async function isStaleLockFile(filePath: string): Promise<boolean> {
  const pid = await readLockPid(filePath);
  if (pid !== undefined && pid !== process.pid && !isProcessAlive(pid)) return true;

  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat) return true;
  return Date.now() - stat.mtimeMs > STALE_LOCK_MS;
}

async function readLockPid(filePath: string): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed.pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
