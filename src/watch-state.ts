import fs from "node:fs/promises";
import { readJsonFile, writeJsonFile } from "./json.js";
import { watchStatePath } from "./paths.js";
import type { ScopeInput } from "./types.js";

export type WatchState = {
  pid: number;
  scope: ScopeInput | "global";
  pull: boolean;
  fixNames: boolean;
  cwd: string;
  startedAt: string;
};

export async function claimWatcher(state: Omit<WatchState, "pid" | "startedAt">, cwd = process.cwd()): Promise<void> {
  const filePath = watchStatePath(cwd);
  await stopExistingWatcher(cwd);

  await writeJsonFile(filePath, {
    ...state,
    pid: process.pid,
    startedAt: new Date().toISOString()
  });
}

export async function stopExistingWatcher(cwd = process.cwd()): Promise<void> {
  const filePath = watchStatePath(cwd);
  const existing = await readJsonFile<WatchState | undefined>(filePath, undefined);
  if (!existing) return;
  if (!isProcessRunning(existing.pid)) {
    await fs.rm(filePath, { force: true });
    return;
  }

  try {
    process.kill(existing.pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") {
      throw new Error(`A Unity watcher is already running as PID ${existing.pid}, but Unity cannot terminate it. Stop it manually or run the new watcher with permission to signal that process.`);
    }
    throw error;
  }
  await waitForExit(existing.pid);
}

export async function releaseWatcher(cwd = process.cwd()): Promise<void> {
  const filePath = watchStatePath(cwd);
  const existing = await readJsonFile<WatchState | undefined>(filePath, undefined);
  if (existing?.pid === process.pid) await fs.rm(filePath, { force: true });
}

export async function getWatcherState(cwd = process.cwd()): Promise<WatchState | undefined> {
  const filePath = watchStatePath(cwd);
  const existing = await readJsonFile<WatchState | undefined>(filePath, undefined);
  if (!existing) return undefined;
  if (isProcessRunning(existing.pid)) return existing;
  await fs.rm(filePath, { force: true });
  return undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForExit(pid: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (!isProcessRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (isProcessRunning(pid)) process.kill(pid, "SIGKILL");
}
