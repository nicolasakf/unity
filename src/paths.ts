import fs from "node:fs";
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

export function sourceDir(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "skills");
}

export function configPath(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "config.json");
}

export function statePath(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "state.json");
}

export function lockPath(scope: Scope, cwd = process.cwd()): string {
  return path.join(scopeBaseDir(scope, cwd), "sync.lock");
}

export function watchStatePath(cwd = process.cwd()): string {
  return path.join(scopeBaseDir("user", cwd), "watch.json");
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
