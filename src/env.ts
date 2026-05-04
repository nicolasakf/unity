import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { findProjectRoot, homeDir, pathsEqual, resolveTargetPath } from "./paths.js";
import type { SyncResult, TargetConfig, UnityMessage } from "./types.js";

export type EnvPushDestination = {
  targetIds: string[];
  worktreeRoot: string;
  sourcePath: string;
  destinationPath: string;
};

export type EnvPushPlan = {
  repoRoot: string;
  envFiles: string[];
  destinations: EnvPushDestination[];
  messages: UnityMessage[];
};

export type EnvPushPlanOptions = {
  cwd?: string;
  to?: string[];
};

export async function buildEnvPushPlan(options: EnvPushPlanOptions = {}): Promise<EnvPushPlan> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = findProjectRoot(cwd);
  const config = await loadConfig("project", repoRoot);
  const envFiles = await listRootEnvFiles(repoRoot);
  const messages: UnityMessage[] = [];
  const targets = selectTargets(config.targets, options.to);
  const destinations = new Map<string, EnvPushDestination>();

  for (const target of targets) {
    const worktreeRoots = await targetWorktreeRoots(target, repoRoot);
    if (!worktreeRoots.length) {
      messages.push({ level: "info", message: `Skipped ${target.id}: target worktree does not exist` });
      continue;
    }

    for (const worktreeRoot of worktreeRoots) {
      for (const fileName of envFiles) {
        const sourcePath = path.join(repoRoot, fileName);
        const destinationPath = path.join(worktreeRoot, fileName);
        const existing = destinations.get(destinationPath);
        if (existing) {
          existing.targetIds.push(target.id);
        } else {
          destinations.set(destinationPath, {
            targetIds: [target.id],
            worktreeRoot,
            sourcePath,
            destinationPath
          });
        }
      }
    }
  }

  return {
    repoRoot,
    envFiles,
    destinations: [...destinations.values()].sort((a, b) => a.destinationPath.localeCompare(b.destinationPath)),
    messages
  };
}

export async function pushEnvFiles(plan: EnvPushPlan, dryRun = false): Promise<SyncResult> {
  const result: SyncResult = {
    scope: "project",
    copied: 0,
    removed: 0,
    skipped: 0,
    errors: 0,
    messages: [...plan.messages]
  };

  for (const destination of plan.destinations) {
    const targetLabel = destination.targetIds.join(", ");
    const stat = await fs.lstat(destination.destinationPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });

    if (stat?.isSymbolicLink()) {
      result.skipped += 1;
      result.messages.push({
        level: "warning",
        message: `Skipped ${destination.destinationPath} (${targetLabel}): destination is a symbolic link`
      });
      continue;
    }

    if (stat && !stat.isFile()) {
      result.skipped += 1;
      result.messages.push({
        level: "warning",
        message: `Skipped ${destination.destinationPath} (${targetLabel}): destination is not a file`
      });
      continue;
    }

    if (!dryRun) {
      await fs.mkdir(path.dirname(destination.destinationPath), { recursive: true });
      await fs.copyFile(destination.sourcePath, destination.destinationPath);
    }
    result.copied += 1;
    result.messages.push({
      level: "info",
      message: `${dryRun ? "Would copy" : "Copied"} ${path.basename(destination.sourcePath)} to ${destination.destinationPath}`
    });
  }

  return result;
}

async function listRootEnvFiles(repoRoot: string): Promise<string[]> {
  const entries = await fs.readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && (entry.name === ".env" || entry.name.startsWith(".env.")))
    .map((entry) => entry.name)
    .sort();
}

function selectTargets(targets: Record<string, TargetConfig>, to: string[] | undefined): TargetConfig[] {
  if (!to?.length) {
    return Object.values(targets).sort((a, b) => a.id.localeCompare(b.id));
  }

  return to.map((id) => {
    const target = targets[id];
    if (!target) throw new Error(`Unknown target "${id}"`);
    return target;
  });
}

async function targetWorktreeRoots(target: TargetConfig, repoRoot: string): Promise<string[]> {
  const roots = [
    await configuredTargetWorktreeRoot(target, repoRoot),
    ...(await storedTargetWorktreeRoots(target, repoRoot))
  ].filter((root): root is string => Boolean(root));

  return uniquePaths(roots).filter((root) => !pathsEqual(root, repoRoot));
}

async function configuredTargetWorktreeRoot(target: TargetConfig, cwd: string): Promise<string | undefined> {
  const targetPath = resolveTargetPath(target.projectPath, "project", cwd);
  const root = findProjectRoot(targetPath);
  try {
    await fs.access(path.join(root, ".git"));
    return root;
  } catch {
    return undefined;
  }
}

async function storedTargetWorktreeRoots(target: TargetConfig, repoRoot: string): Promise<string[]> {
  const repoGitDir = await gitCommonDir(repoRoot);
  if (!repoGitDir) return [];

  const roots: string[] = [];
  for (const storeDir of targetWorktreeStoreDirs(target)) {
    for (const candidate of await candidateWorktreeRoots(storeDir, 3)) {
      const candidateGitDir = await gitCommonDir(candidate);
      if (candidateGitDir && pathsEqual(candidateGitDir, repoGitDir)) roots.push(candidate);
    }
  }
  return roots;
}

function targetWorktreeStoreDirs(target: TargetConfig): string[] {
  const roots: string[] = [];
  const userPath = resolveTargetPath(target.userPath, "user");
  roots.push(path.join(path.dirname(userPath), "worktrees"));
  roots.push(path.join(homeDir(), `.${target.id}`, "worktrees"));
  return uniquePaths(roots);
}

async function candidateWorktreeRoots(directory: string, maxDepth: number): Promise<string[]> {
  if (await hasGitFile(directory)) return [directory];
  if (maxDepth <= 0) return [];

  const roots: string[] = [];
  for (const entry of await readDirs(directory)) {
    roots.push(...(await candidateWorktreeRoots(path.join(directory, entry), maxDepth - 1)));
  }
  return roots;
}

async function gitCommonDir(repoRoot: string): Promise<string | undefined> {
  const gitPath = path.join(repoRoot, ".git");
  const stat = await fs.lstat(gitPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return undefined;
  if (stat.isDirectory()) return realpathOrUndefined(gitPath);
  if (!stat.isFile()) return undefined;

  const raw = await fs.readFile(gitPath, "utf8");
  const match = raw.match(/^gitdir:\s*(.+)$/m);
  if (!match) return undefined;
  const gitDir = path.isAbsolute(match[1]) ? match[1] : path.resolve(repoRoot, match[1]);
  const parent = path.dirname(gitDir);
  const commonDir = path.basename(parent) === "worktrees" ? path.dirname(parent) : gitDir;
  return realpathOrUndefined(commonDir);
}

async function realpathOrUndefined(p: string): Promise<string | undefined> {
  try {
    return await fs.realpath(p);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") return undefined;
    throw error;
  }
}

async function hasGitFile(directory: string): Promise<boolean> {
  const stat = await fs.lstat(path.join(directory, ".git")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  });
  return Boolean(stat?.isFile() || stat?.isDirectory());
}

async function readDirs(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function uniquePaths(paths: string[]): string[] {
  const result: string[] = [];
  for (const item of paths) {
    if (!result.some((existing) => pathsEqual(existing, item))) result.push(item);
  }
  return result;
}
