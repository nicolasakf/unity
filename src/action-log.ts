import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { logDir } from "./paths.js";
import type { MessageLevel } from "./types.js";

export type LogCategory = "command" | "sync" | "watch" | "config" | "env" | "watcher";

function formatDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dailyLogPath(date = new Date(), cwd = process.cwd()): string {
  return path.join(logDir(cwd), `unity-${formatDate(date)}.log`);
}

export async function ensureLogDir(cwd = process.cwd()): Promise<string> {
  const dir = logDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

let activeLogDate = formatDate();

async function resolveLogFile(cwd = process.cwd()): Promise<string> {
  await ensureLogDir(cwd);
  const today = formatDate();
  if (today !== activeLogDate) activeLogDate = today;
  return dailyLogPath(new Date(), cwd);
}

export async function appendLogEntry(
  level: MessageLevel,
  category: LogCategory,
  message: string,
  cwd = process.cwd()
): Promise<void> {
  try {
    const logFile = await resolveLogFile(cwd);
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${level.toUpperCase().padEnd(7)} ${category.padEnd(8)} ${message}\n`;
    await fs.appendFile(logFile, line, "utf8");
  } catch {
    // Logging must never break CLI operations.
  }
}

export async function listLogFiles(cwd = process.cwd()): Promise<string[]> {
  const dir = logDir(cwd);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((name) => name.startsWith("unity-") && name.endsWith(".log"))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

export async function readLogTail(lines = 50, filePath?: string, cwd = process.cwd()): Promise<string> {
  const target =
    filePath ??
    (await listLogFiles(cwd)).at(-1) ??
    dailyLogPath(new Date(), cwd);

  try {
    const content = await fs.readFile(target, "utf8");
    const allLines = content.split("\n").filter((line) => line.length > 0);
    return allLines.slice(-lines).join("\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function clearLog(date = new Date(), cwd = process.cwd()): Promise<string> {
  await ensureLogDir(cwd);
  const target = dailyLogPath(date, cwd);
  await fs.writeFile(target, "", "utf8");
  return target;
}

export async function openLogDir(cwd = process.cwd()): Promise<string> {
  const dir = await ensureLogDir(cwd);
  await openPath(dir);
  return dir;
}

async function openPath(target: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [target], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to open ${target} (exit ${code ?? "unknown"})`));
    });
  });
}
