import fs from "node:fs/promises";
import path from "node:path";
import { lockPath } from "./paths.js";
import type { Scope } from "./types.js";

const STALE_LOCK_MS = 30 * 60 * 1000;

export async function withScopeLock<T>(scope: Scope, cwd: string, task: () => Promise<T>): Promise<T> {
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

  const stat = await fs.stat(filePath);
  if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
    await fs.rm(filePath, { force: true });
    return acquireLock(filePath, scope);
  }

  throw new Error(`Another Unity operation is already running for ${scope}. Lock file: ${filePath}`);
}
