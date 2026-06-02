import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Scope } from "./types.js";

export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

export function expandPath(input: string, baseDir = process.cwd()): string {
  if (input === "~") return homeDir();
  if (input.startsWith("~/")) return path.join(homeDir(), input.slice(2));
  if (path.isAbsolute(input)) return input;
  return path.resolve(baseDir, input);
}

export function findProjectRoot(cwd = process.cwd()): string {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

export function scopeBaseDir(scope: Scope, cwd = process.cwd()): string {
  return scope === "user" ? path.join(homeDir(), ".agents") : path.join(findProjectRoot(cwd), ".agents");
}

/** Unity-owned metadata (config, state, locks, logs) lives under `.agents/unity`. */
export function unityDataDir(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "unity");
}

export function sourceDir(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "skills");
}

export function rulesSourceDir(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "rules");
}

export function configPath(scope: Scope, cwd = process.cwd()): string {
  return path.join(unityDataDir(scope, cwd), "config.json");
}

export function legacyConfigPath(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "config.json");
}

export function statePath(scope: Scope, cwd = process.cwd()): string {
  return path.join(unityDataDir(scope, cwd), "state.json");
}

export function legacyStatePath(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "state.json");
}

export function lockPath(scope: Scope, cwd = process.cwd()): string {
  return path.join(unityDataDir(scope, cwd), "sync.lock");
}

export function legacyLockPath(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "sync.lock");
}

export function watchStatePath(cwd = process.cwd()): string {
  return path.join(unityDataDir("user", cwd), "watch.json");
}

export function legacyWatchStatePath(cwd = process.cwd()): string {
  return path.join(scopeBaseDir("user", cwd), "watch.json");
}

export function logDir(cwd = process.cwd()): string {
  return path.join(unityDataDir("user", cwd), "logs");
}

export function legacyLogDir(cwd = process.cwd()): string {
  return path.join(scopeBaseDir("user", cwd), "logs");
}

export type ResolvedUnityPath = {
  path: string;
  legacy: boolean;
  duplicate?: boolean;
};

const layoutWarnings = new Set<string>();

export function resetUnityLayoutWarnings(): void {
  layoutWarnings.clear();
}

function warnOnce(key: string, message: string): void {
  if (layoutWarnings.has(key)) return;
  layoutWarnings.add(key);
  console.warn(message);
}

export function warnLegacyUnityFile(scope: Scope, fileName: string, legacyPath: string, cwd = process.cwd()): void {
  const key = `legacy:${scope}:${fileName}:${scopeBaseDir(scope, cwd)}`;
  warnOnce(
    key,
    `Unity: reading ${fileName} from legacy location ${legacyPath}. New data is stored under ${unityDataDir(scope, cwd)}.`
  );
}

export function warnDuplicateUnityFile(scope: Scope, fileName: string, cwd = process.cwd()): void {
  const key = `duplicate:${scope}:${fileName}:${scopeBaseDir(scope, cwd)}`;
  warnOnce(
    key,
    `Unity: both legacy and current ${fileName} exist under ${scopeBaseDir(scope, cwd)}. Using ${path.join(unityDataDir(scope, cwd), fileName)}; consider removing the legacy copy.`
  );
}

export function warnLegacyLogDir(legacyPath: string, cwd = process.cwd()): void {
  const key = `legacy:logs:${scopeBaseDir("user", cwd)}`;
  warnOnce(
    key,
    `Unity: reading logs from legacy location ${legacyPath}. New logs are written to ${logDir(cwd)}.`
  );
}

export function warnDuplicateLogDir(cwd = process.cwd()): void {
  const key = `duplicate:logs:${scopeBaseDir("user", cwd)}`;
  warnOnce(
    key,
    `Unity: log directories exist at both ${legacyLogDir(cwd)} and ${logDir(cwd)}. New entries use ${logDir(cwd)}.`
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fsPromises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fsPromises.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function resolveUnityDataFile(
  scope: Scope,
  fileName: string,
  cwd = process.cwd()
): Promise<ResolvedUnityPath> {
  const canonical = path.join(unityDataDir(scope, cwd), fileName);
  const legacy = path.join(scopeBaseDir(scope, cwd), fileName);
  const [hasCanonical, hasLegacy] = await Promise.all([fileExists(canonical), fileExists(legacy)]);

  if (hasCanonical && hasLegacy) {
    warnDuplicateUnityFile(scope, fileName, cwd);
    return { path: canonical, legacy: false, duplicate: true };
  }
  if (hasCanonical) return { path: canonical, legacy: false };
  if (hasLegacy) {
    warnLegacyUnityFile(scope, fileName, legacy, cwd);
    return { path: legacy, legacy: true };
  }
  return { path: canonical, legacy: false };
}

export async function resolveLogDirPath(cwd = process.cwd()): Promise<ResolvedUnityPath> {
  const canonical = logDir(cwd);
  const legacy = legacyLogDir(cwd);
  const [hasCanonical, hasLegacy] = await Promise.all([dirExists(canonical), dirExists(legacy)]);

  if (hasCanonical && hasLegacy) {
    warnDuplicateLogDir(cwd);
    return { path: canonical, legacy: false, duplicate: true };
  }
  if (hasCanonical) return { path: canonical, legacy: false };
  if (hasLegacy) {
    warnLegacyLogDir(legacy, cwd);
    return { path: legacy, legacy: true };
  }
  return { path: canonical, legacy: false };
}

export async function configExists(scope: Scope, cwd = process.cwd()): Promise<boolean> {
  const resolved = await resolveUnityDataFile(scope, "config.json", cwd);
  return fileExists(resolved.path);
}

export async function configReadPath(scope: Scope, cwd = process.cwd()): Promise<string> {
  return (await resolveUnityDataFile(scope, "config.json", cwd)).path;
}

export async function stateReadPath(scope: Scope, cwd = process.cwd()): Promise<string> {
  return (await resolveUnityDataFile(scope, "state.json", cwd)).path;
}

export async function watchStateReadPath(cwd = process.cwd()): Promise<string> {
  return (await resolveUnityDataFile("user", "watch.json", cwd)).path;
}

export async function findScopeLockPath(scope: Scope, cwd = process.cwd()): Promise<string | undefined> {
  const canonical = lockPath(scope, cwd);
  const legacy = legacyLockPath(scope, cwd);
  if (await fileExists(canonical)) return canonical;
  if (await fileExists(legacy)) return legacy;
  return undefined;
}

export async function configWatchPaths(scope: Scope, cwd = process.cwd()): Promise<string[]> {
  const canonical = configPath(scope, cwd);
  const legacy = legacyConfigPath(scope, cwd);
  const paths = new Set<string>([canonical]);
  if (await fileExists(legacy)) paths.add(legacy);
  return [...paths];
}

export function resolveTargetPath(input: string, scope: Scope, cwd = process.cwd()): string {
  const base = scope === "user" ? homeDir() : findProjectRoot(cwd);
  return expandPath(input, base);
}

export function expandScopes(scope: Scope | "all"): Scope[] {
  return scope === "all" ? ["user", "project"] : [scope];
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

export function isPathWithin(parent: string, child: string): boolean {
  const parentN = normalizeForCompare(parent);
  const childN = normalizeForCompare(child);
  if (childN === parentN) return true;
  return childN.startsWith(parentN + path.sep);
}

function normalizeForCompare(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
