import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { isStaleLockFile } from "./lock.js";
import {
  expandScopes,
  findProjectRoot,
  legacyLogDir,
  legacyWatchStatePath,
  logDir,
  scopeBaseDir,
  unityDataDir,
  watchStatePath
} from "./paths.js";
import type { Scope, ScopeInput } from "./types.js";

export type MigrateAction = "moved" | "merged" | "replaced" | "skipped" | "removed" | "unchanged";

export type MigrateItem = {
  label: string;
  legacyPath: string;
  canonicalPath: string;
  action: MigrateAction;
  detail?: string;
};

export type MigrateResult = {
  scope: Scope;
  baseDir: string;
  items: MigrateItem[];
};

export type MigrateOptions = {
  dryRun?: boolean;
  force?: boolean;
  removeLegacy?: boolean;
};

const SCOPE_FILES = ["config.json", "state.json", "sync.lock"] as const;

export async function migrateLayout(
  scopeInput: ScopeInput,
  cwd = process.cwd(),
  options: MigrateOptions = {}
): Promise<MigrateResult[]> {
  const results: MigrateResult[] = [];
  const scopes = expandScopes(scopeInput);

  if (scopes.includes("user")) {
    results.push(await migrateScope("user", cwd, options));
  }

  if (scopes.includes("project")) {
    const projectRoots = new Set<string>([findProjectRoot(cwd)]);
    if (scopeInput === "all") {
      try {
        const config = await loadConfig("user", cwd);
        for (const projectRoot of config.projects) projectRoots.add(projectRoot);
      } catch {
        // User config may not exist yet.
      }
    }
    for (const projectRoot of projectRoots) {
      results.push(await migrateScope("project", projectRoot, options));
    }
  }

  return results;
}

export async function migrateScope(
  scope: Scope,
  cwd = process.cwd(),
  options: MigrateOptions = {}
): Promise<MigrateResult> {
  const baseDir = scopeBaseDir(scope, cwd);
  const items: MigrateItem[] = [];

  await fs.mkdir(unityDataDir(scope, cwd), { recursive: true });

  for (const fileName of SCOPE_FILES) {
    items.push(await migrateUnityFile(scope, cwd, fileName, options));
  }

  if (scope === "user") {
    items.push(await migrateUnityFile(scope, cwd, "watch.json", options, watchStatePath(cwd), legacyWatchStatePath(cwd)));
    items.push(...(await migrateLogDirectory(cwd, options)));
  }

  return { scope, baseDir, items };
}

async function migrateUnityFile(
  scope: Scope,
  cwd: string,
  fileName: string,
  options: MigrateOptions,
  canonicalPath = path.join(unityDataDir(scope, cwd), fileName),
  legacyPath = path.join(scopeBaseDir(scope, cwd), fileName)
): Promise<MigrateItem> {
  const item: MigrateItem = { label: fileName, legacyPath, canonicalPath, action: "unchanged" };
  const hasLegacy = await isFile(legacyPath);
  const hasCanonical = await isFile(canonicalPath);

  if (!hasLegacy) {
    item.action = "unchanged";
    item.detail = hasCanonical ? "already under .agents/unity" : "nothing to migrate";
    return item;
  }

  if (fileName === "sync.lock") {
    if (!(await isStaleLockFile(legacyPath))) {
      item.action = "skipped";
      item.detail = "active lock at legacy path; stop other Unity processes first";
      return item;
    }
  }

  if (!hasCanonical) {
    item.action = "moved";
    item.detail = options.dryRun ? `would move to ${canonicalPath}` : undefined;
    if (!options.dryRun) {
      await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
      await fs.rename(legacyPath, canonicalPath);
    }
    return item;
  }

  const same = await filesEqual(legacyPath, canonicalPath);
  if (same) {
    item.action = options.removeLegacy ? "removed" : "skipped";
    item.detail = options.removeLegacy
      ? options.dryRun
        ? `would remove duplicate legacy ${legacyPath}`
        : undefined
      : "duplicate of canonical file; pass --remove-legacy to delete legacy copy";
    if (options.removeLegacy && !options.dryRun) await fs.rm(legacyPath, { force: true });
    return item;
  }

  if (!options.force) {
    item.action = "skipped";
    item.detail = "both exist with different content; pass --force to replace canonical with legacy, then remove legacy";
    return item;
  }

  item.action = "replaced";
  item.detail = options.dryRun ? `would replace ${canonicalPath} with legacy copy` : undefined;
  if (!options.dryRun) {
    await fs.copyFile(legacyPath, canonicalPath);
    await fs.rm(legacyPath, { force: true });
  }
  return item;
}

async function migrateLogDirectory(cwd: string, options: MigrateOptions): Promise<MigrateItem[]> {
  const legacyPath = legacyLogDir(cwd);
  const canonicalPath = logDir(cwd);
  const items: MigrateItem[] = [];

  const hasLegacy = await isDirectory(legacyPath);
  if (!hasLegacy) {
    return [
      {
        label: "logs/",
        legacyPath,
        canonicalPath,
        action: "unchanged",
        detail: (await isDirectory(canonicalPath)) ? "already under .agents/unity/logs" : "nothing to migrate"
      }
    ];
  }

  const hasCanonical = await isDirectory(canonicalPath);
  if (!hasCanonical) {
    items.push({
      label: "logs/",
      legacyPath,
      canonicalPath,
      action: "moved",
      detail: options.dryRun ? `would move to ${canonicalPath}` : undefined
    });
    if (!options.dryRun) {
      await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
      await fs.rename(legacyPath, canonicalPath);
    }
    return items;
  }

  const legacyEntries = await fs.readdir(legacyPath);
  let merged = 0;
  for (const name of legacyEntries) {
    const from = path.join(legacyPath, name);
    const to = path.join(canonicalPath, name);
    if (await isFile(to) || (await isDirectory(to))) continue;
    merged += 1;
    if (!options.dryRun) {
      await fs.rename(from, to);
    }
  }

  const remaining = options.dryRun ? legacyEntries.length : (await fs.readdir(legacyPath).catch(() => [])).length;
  items.push({
    label: "logs/",
    legacyPath,
    canonicalPath,
    action: merged > 0 ? "merged" : "skipped",
    detail:
      merged > 0
        ? options.dryRun
          ? `would merge ${merged} entr${merged === 1 ? "y" : "ies"} into ${canonicalPath}`
          : `merged ${merged} entr${merged === 1 ? "y" : "ies"}`
        : "no new log files to merge"
  });

  if (options.removeLegacy && remaining === 0) {
    items.push({
      label: "logs/ (cleanup)",
      legacyPath,
      canonicalPath,
      action: options.dryRun ? "removed" : "removed",
      detail: options.dryRun ? `would remove empty legacy directory ${legacyPath}` : undefined
    });
    if (!options.dryRun) await fs.rm(legacyPath, { recursive: true, force: true });
  } else if (remaining > 0) {
    items.push({
      label: "logs/ (cleanup)",
      legacyPath,
      canonicalPath,
      action: "skipped",
      detail: `${remaining} entr${remaining === 1 ? "y" : "ies"} left in legacy directory`
    });
  }

  return items;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function filesEqual(a: string, b: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return left.equals(right);
  } catch {
    return false;
  }
}

export function formatMigrateResults(results: MigrateResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    const changed = result.items.filter((item) => item.action !== "unchanged");
    lines.push(`${result.scope} (${result.baseDir})`);
    if (!changed.length) {
      lines.push("  nothing to migrate");
      continue;
    }
    for (const item of changed) {
      const suffix = item.detail ? ` — ${item.detail}` : "";
      lines.push(`  ${item.label}: ${item.action}${suffix}`);
    }
  }
  return lines;
}
