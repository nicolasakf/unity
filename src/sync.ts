import fs from "node:fs/promises";
import path from "node:path";
import { ensureScope, enabledTargets, loadConfig } from "./config.js";
import { copyDirectory, hashTree, pathExists, removeDirectory, sameHashTree } from "./file-tree.js";
import { withScopeLock } from "./lock.js";
import { pathsEqual, resolveTargetPath, sourceDir } from "./paths.js";
import { getNameMismatchRepair, listValidSkills } from "./skills.js";
import { loadState, saveState } from "./state.js";
import type { ManagedSkill, Scope, SyncResult, TargetConfig, TargetState, UnityMessage } from "./types.js";

export type SyncOptions = {
  cwd?: string;
  force?: boolean;
  dryRun?: boolean;
};

export type PullOptions = {
  cwd?: string;
  from?: string;
  fixNames?: boolean;
  dryRun?: boolean;
};

export async function syncScope(scope: Scope, options: SyncOptions = {}): Promise<SyncResult> {
  const pullResult = await pullScope(scope, options);
  const pushResult = await pushScope(scope, options);

  return combineResults(scope, [
    { label: "pull", result: pullResult },
    { label: "push", result: pushResult }
  ]);
}

export async function pushScope(scope: Scope, options: SyncOptions = {}): Promise<SyncResult> {
  const cwd = options.cwd ?? process.cwd();
  if (options.dryRun) return pushScopeUnlocked(scope, options);

  await ensureScope(scope, cwd);
  return withScopeLock(scope, cwd, () => pushScopeUnlocked(scope, options));
}

async function pushScopeUnlocked(scope: Scope, options: SyncOptions = {}): Promise<SyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;

  const config = await loadConfig(scope, cwd);
  const state = await loadState(scope, cwd);
  const messages: UnityMessage[] = [];
  const source = sourceDir(scope, cwd);
  const { skills, invalid } = await listValidSkills(source);
  const sourceSkillNames = new Set(skills.map((skill) => skill.name));
  const result: SyncResult = {
    scope,
    copied: 0,
    removed: 0,
    skipped: 0,
    errors: 0,
    messages
  };

  for (const validation of invalid) {
    if (!validation.ok) {
      result.skipped += 1;
      messages.push({ level: "warning", message: `Skipped invalid skill at ${validation.directory}: ${validation.reason}` });
    }
  }

  for (const target of enabledTargets(config, scope)) {
    const targetPath = resolveTargetPath(pathForScope(target, scope), scope, cwd);
    if (pathsEqual(targetPath, source)) {
      messages.push({ level: "info", message: `Skipped ${target.id}: target is the Unity source` });
      continue;
    }
    if (!dryRun) await fs.mkdir(targetPath, { recursive: true });
    const targetState = state.targets[target.id] && pathsEqual(state.targets[target.id].targetPath, targetPath)
      ? state.targets[target.id]
      : { targetPath, skills: {} };

    for (const skill of skills) {
      const sourceFiles = await hashTree(skill.directory);
      const targetSkillDir = path.join(targetPath, skill.name);
      const managed = targetState.skills[skill.name];
      const copied = await syncSkill({
        targetId: target.id,
        skillName: skill.name,
        sourceDir: skill.directory,
        sourceFiles,
        targetSkillDir,
        managed,
        force,
        dryRun,
        messages
      });

      if (copied === "copied") result.copied += 1;
      if (copied === "skipped") result.skipped += 1;
      if (!dryRun && copied !== "skipped") {
        targetState.skills[skill.name] = { files: await hashTree(targetSkillDir) };
      }
    }

    for (const [skillName, managed] of Object.entries(targetState.skills)) {
      if (sourceSkillNames.has(skillName)) continue;
      const targetSkillDir = path.join(targetPath, skillName);
      const removed = await removeManagedSkill({
        targetId: target.id,
        skillName,
        targetSkillDir,
        managed,
        force,
        dryRun,
        messages
      });

      if (!dryRun && removed === "removed") {
        delete targetState.skills[skillName];
      }
      if (removed === "removed") {
        result.removed += 1;
      } else if (removed === "skipped") {
        result.skipped += 1;
      }
    }

    if (!dryRun) state.targets[target.id] = targetState;
  }

  if (!dryRun) await saveState(scope, state, cwd);
  return result;
}

export async function pruneTarget(
  scope: Scope,
  targetId: string,
  cwd = process.cwd(),
  force = false,
  dryRun = false
): Promise<SyncResult> {
  if (!dryRun) return withScopeLock(scope, cwd, () => pruneTargetUnlocked(scope, targetId, cwd, force, dryRun));
  return pruneTargetUnlocked(scope, targetId, cwd, force, dryRun);
}

async function pruneTargetUnlocked(
  scope: Scope,
  targetId: string,
  cwd = process.cwd(),
  force = false,
  dryRun = false
): Promise<SyncResult> {
  const config = await loadConfig(scope, cwd);
  const target = config.targets[targetId];
  if (!target) {
    return {
      scope,
      copied: 0,
      removed: 0,
      skipped: 0,
      errors: 1,
      messages: [{ level: "error", message: `Unknown target "${targetId}"` }]
    };
  }

  const state = await loadState(scope, cwd);
  const messages: UnityMessage[] = [];
  const targetPath = resolveTargetPath(pathForScope(target, scope), scope, cwd);
  const targetState = state.targets[targetId] ?? { targetPath, skills: {} };
  const result: SyncResult = {
    scope,
    copied: 0,
    removed: 0,
    skipped: 0,
    errors: 0,
    messages
  };

  if (pathsEqual(targetPath, sourceDir(scope, cwd))) {
    messages.push({ level: "info", message: `Skipped ${targetId}: target is the Unity source` });
    return result;
  }

  for (const [skillName, managed] of Object.entries(targetState.skills)) {
    const removed = await removeManagedSkill({
      targetId,
      skillName,
      targetSkillDir: path.join(targetPath, skillName),
      managed,
      force,
      dryRun,
      messages
    });
    if (!dryRun && removed === "removed") {
      delete targetState.skills[skillName];
    }
    if (removed === "removed") {
      result.removed += 1;
    } else if (removed === "skipped") {
      result.skipped += 1;
    }
  }

  if (!dryRun) {
    state.targets[targetId] = targetState;
    await saveState(scope, state, cwd);
  }
  return result;
}

export async function pullScope(scope: Scope, options: PullOptions = {}): Promise<SyncResult> {
  const cwd = options.cwd ?? process.cwd();
  if (!options.dryRun) {
    await ensureScope(scope, cwd);
    return withScopeLock(scope, cwd, () => pullScopeUnlocked(scope, options));
  }

  return pullScopeUnlocked(scope, options);
}

async function pullScopeUnlocked(scope: Scope, options: PullOptions = {}): Promise<SyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(scope, cwd);
  const result: SyncResult = { scope, copied: 0, removed: 0, skipped: 0, errors: 0, messages: [] };

  if (options.from) {
    return pullFromSource(options.from, scope, options);
  }

  for (const target of enabledTargets(config, scope)) {
    const sourcePath = resolveTargetPath(pathForScope(target, scope), scope, cwd);
    if (pathsEqual(sourcePath, sourceDir(scope, cwd))) {
      result.messages.push({ level: "info", message: `Skipped ${target.id}: target is the Unity source` });
      continue;
    }
    if (!(await pathExists(sourcePath))) {
      result.skipped += 1;
      result.messages.push({ level: "info", message: `Skipped ${target.id}: target path does not exist (${sourcePath})` });
      continue;
    }

    const pulled = await pullFromSource(target.id, scope, options);
    result.copied += pulled.copied;
    result.removed += pulled.removed;
    result.skipped += pulled.skipped;
    result.errors += pulled.errors;
    for (const message of pulled.messages) {
      result.messages.push({ ...message, message: `${target.id}: ${message.message}` });
    }
  }

  return result;
}

async function pullFromSource(from: string, scope: Scope, options: PullOptions = {}): Promise<SyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const fixNames = options.fixNames ?? false;
  const dryRun = options.dryRun ?? false;
  const config = await loadConfig(scope, cwd);
  const sourcePath = config.targets[from]
    ? resolveTargetPath(pathForScope(config.targets[from], scope), scope, cwd)
    : resolveTargetPath(from, scope, cwd);
  const destination = sourceDir(scope, cwd);
  const messages: UnityMessage[] = [];
  const result: SyncResult = { scope, copied: 0, removed: 0, skipped: 0, errors: 0, messages };

  if (pathsEqual(sourcePath, destination)) {
    messages.push({ level: "info", message: `Skipped ${from}: import source is the Unity source` });
    return result;
  }

  if (!(await pathExists(sourcePath))) {
    result.errors += 1;
    messages.push({ level: "error", message: `Pull source does not exist: ${sourcePath}` });
    return result;
  }

  const { skills, invalid } = await listValidSkills(sourcePath);
  for (const validation of invalid) {
    if (!validation.ok) {
      if (fixNames) {
        const repair = await getNameMismatchRepair(validation.directory);
        if (repair) {
          const targetDir = path.join(destination, repair.fixedName);
          if (await pathExists(targetDir)) {
            result.skipped += 1;
            messages.push({ level: "warning", message: `Skipped ${repair.fixedName}: already exists in ${destination}` });
            continue;
          }

          if (dryRun) {
            messages.push({
              level: "info",
              message: `Would pull ${repair.fixedName} with name fixed from "${repair.currentName}"`
            });
          } else {
            await copyDirectoryWithSkillName(repair.directory, targetDir, repair.fixedName);
            messages.push({
              level: "info",
              message: `Pulled ${repair.fixedName} with name fixed from "${repair.currentName}"`
            });
          }
          result.copied += 1;
          continue;
        }
      }

      result.skipped += 1;
      messages.push({ level: "warning", message: `Skipped invalid pull at ${validation.directory}: ${validation.reason}` });
    }
  }

  for (const skill of skills) {
    const targetDir = path.join(destination, skill.name);
    if (await pathExists(targetDir)) {
      result.skipped += 1;
      messages.push({ level: "warning", message: `Skipped ${skill.name}: already exists in ${destination}` });
      continue;
    }
    if (dryRun) {
      messages.push({ level: "info", message: `Would pull ${skill.name} into ${destination}` });
    } else {
      await copyDirectory(skill.directory, targetDir);
    }
    result.copied += 1;
  }

  return result;
}

function combineResults(
  scope: Scope,
  items: { label: string; result: SyncResult }[]
): SyncResult {
  const result: SyncResult = { scope, copied: 0, removed: 0, skipped: 0, errors: 0, messages: [] };
  for (const item of items) {
    result.copied += item.result.copied;
    result.removed += item.result.removed;
    result.skipped += item.result.skipped;
    result.errors += item.result.errors;
    for (const message of item.result.messages) {
      result.messages.push({ ...message, message: `${item.label}: ${message.message}` });
    }
  }
  return result;
}

function pathForScope(target: TargetConfig, scope: Scope): string {
  return scope === "user" ? target.userPath : target.projectPath;
}

async function syncSkill(input: {
  targetId: string;
  skillName: string;
  sourceDir: string;
  sourceFiles: Record<string, string>;
  targetSkillDir: string;
  managed?: ManagedSkill;
  force: boolean;
  dryRun: boolean;
  messages: UnityMessage[];
}): Promise<"copied" | "unchanged" | "skipped"> {
  const stat = await fs.lstat(input.targetSkillDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });

  if (stat?.isSymbolicLink()) {
    input.messages.push({
      level: "warning",
      message: `Skipped ${input.skillName} in ${input.targetId}: target is a symbolic link`
    });
    return "skipped";
  }

  if (!stat) {
    if (!input.dryRun) await copyDirectory(input.sourceDir, input.targetSkillDir);
    input.messages.push({ level: "info", message: `${input.dryRun ? "Would copy" : "Copied"} ${input.skillName} to ${input.targetId}` });
    return "copied";
  }

  const currentFiles = await hashTree(input.targetSkillDir);
  if (!input.managed && !input.force) {
    input.messages.push({
      level: "warning",
      message: `Skipped ${input.skillName} in ${input.targetId}: target exists but is not Unity-managed`
    });
    return "skipped";
  }

  if (input.managed && !sameHashTree(currentFiles, input.managed.files) && !input.force) {
    input.messages.push({
      level: "warning",
      message: `Skipped ${input.skillName} in ${input.targetId}: target changed outside Unity`
    });
    return "skipped";
  }

  if (sameHashTree(currentFiles, input.sourceFiles)) {
    return "unchanged";
  }

  if (!input.dryRun) await copyDirectory(input.sourceDir, input.targetSkillDir);
  input.messages.push({ level: "info", message: `${input.dryRun ? "Would update" : "Updated"} ${input.skillName} in ${input.targetId}` });
  return "copied";
}

async function removeManagedSkill(input: {
  targetId: string;
  skillName: string;
  targetSkillDir: string;
  managed: ManagedSkill;
  force: boolean;
  dryRun: boolean;
  messages: UnityMessage[];
}): Promise<"removed" | "missing" | "skipped"> {
  if (!(await pathExists(input.targetSkillDir))) return "missing";

  const currentFiles = await hashTree(input.targetSkillDir);
  if (!sameHashTree(currentFiles, input.managed.files) && !input.force) {
    input.messages.push({
      level: "warning",
      message: `Skipped removing ${input.skillName} from ${input.targetId}: target changed outside Unity`
    });
    return "skipped";
  }

  if (!input.dryRun) await removeDirectory(input.targetSkillDir);
  input.messages.push({ level: "info", message: `${input.dryRun ? "Would remove" : "Removed"} ${input.skillName} from ${input.targetId}` });
  return "removed";
}

async function copyDirectoryWithSkillName(source: string, destination: string, name: string): Promise<void> {
  await copyDirectory(source, destination);
  const skillFile = path.join(destination, "SKILL.md");
  const raw = await fs.readFile(skillFile, "utf8");
  await fs.writeFile(skillFile, raw.replace(/^name:\s*.*$/m, `name: ${name}`), "utf8");
}
