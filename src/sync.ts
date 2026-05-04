import fs from "node:fs/promises";
import path from "node:path";
import { ensureScope, enabledTargets, loadConfig } from "./config.js";
import { copyDirectory, hashFile, hashTree, listFiles, pathExists, removeDirectory, sameHashTree } from "./file-tree.js";
import { withScopeLock } from "./lock.js";
import { pathsEqual, resolveTargetPath, rulesSourceDir, sourceDir } from "./paths.js";
import { getNameMismatchRepair, listValidSkills } from "./skills.js";
import { loadState, saveState } from "./state.js";
import type { ManagedRule, ManagedSkill, RuleMapping, Scope, SyncResult, TargetConfig, TargetState, UnityMessage } from "./types.js";

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
  const rulesSource = rulesSourceDir(scope, cwd);
  const { skills, invalid } = await listValidSkills(source);
  const sourceSkillNames = new Set(skills.map((skill) => skill.name));
  const sourceRules = await listRuleFiles(rulesSource);
  const sourceRuleNames = new Set(sourceRules.map((rule) => rule.name));
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
    const targetIsUnitySource = pathsEqual(targetPath, source);
    if (targetIsUnitySource) {
      messages.push({ level: "info", message: `Skipped ${target.id}: target is the Unity source` });
    }
    if (!targetIsUnitySource && !dryRun) await fs.mkdir(targetPath, { recursive: true });
    const targetState = state.targets[target.id] && pathsEqual(state.targets[target.id].targetPath, targetPath)
      ? state.targets[target.id]
      : { targetPath, skills: {}, rules: state.targets[target.id]?.rules ?? {} };
    targetState.rules ??= {};

    if (!targetIsUnitySource) {
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
    }

    for (const mapping of rulesForScope(target, scope)) {
      const sourceRule = sourceRules.find((rule) => rule.name === mapping.source);
      if (!sourceRule) continue;
      const targetRulePath = resolveTargetPath(mapping.target, scope, cwd);
      const managed = targetState.rules[mapping.source];
      const copied = await syncRule({
        targetId: target.id,
        sourceName: mapping.source,
        sourcePath: sourceRule.path,
        sourceHash: sourceRule.hash,
        targetPath: targetRulePath,
        managed: managed && pathsEqual(managed.targetPath, targetRulePath) ? managed : undefined,
        force,
        dryRun,
        messages
      });

      if (copied === "copied") result.copied += 1;
      if (copied === "skipped") result.skipped += 1;
      if (!dryRun && copied !== "skipped") {
        targetState.rules[mapping.source] = { targetPath: targetRulePath, hash: await hashFile(targetRulePath) };
      }
    }

    const supportedRules = new Set(rulesForScope(target, scope).map((rule) => rule.source));
    for (const [sourceName, managed] of Object.entries(targetState.rules)) {
      if (sourceRuleNames.has(sourceName) && supportedRules.has(sourceName)) continue;
      const removed = await removeManagedRule({
        targetId: target.id,
        sourceName,
        managed,
        force,
        dryRun,
        messages
      });

      if (!dryRun && removed === "removed") {
        delete targetState.rules[sourceName];
      }
      if (removed === "removed") {
        result.removed += 1;
      } else if (removed === "skipped") {
        result.skipped += 1;
      }
    }

    if (!targetIsUnitySource) {
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
  const targetState = state.targets[targetId] ?? { targetPath, skills: {}, rules: {} };
  targetState.rules ??= {};
  const result: SyncResult = {
    scope,
    copied: 0,
    removed: 0,
    skipped: 0,
    errors: 0,
    messages
  };

  const targetIsUnitySource = pathsEqual(targetPath, sourceDir(scope, cwd));
  if (targetIsUnitySource) {
    messages.push({ level: "info", message: `Skipped ${targetId}: target is the Unity source` });
  }

  if (!targetIsUnitySource) {
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
  }

  for (const [sourceName, managed] of Object.entries(targetState.rules)) {
    const removed = await removeManagedRule({
      targetId,
      sourceName,
      managed,
      force,
      dryRun,
      messages
    });
    if (!dryRun && removed === "removed") {
      delete targetState.rules[sourceName];
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
    if (pathsEqual(sourcePath, sourceDir(scope, cwd)) && !(await hasTargetRules(target, scope, cwd))) {
      result.messages.push({ level: "info", message: `Skipped ${target.id}: target is the Unity source` });
      continue;
    }
    if (!(await pathExists(sourcePath)) && !(await hasTargetRules(target, scope, cwd))) {
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
  const rulesDestination = rulesSourceDir(scope, cwd);
  const messages: UnityMessage[] = [];
  const result: SyncResult = { scope, copied: 0, removed: 0, skipped: 0, errors: 0, messages };

  const sourceTarget = config.targets[from];
  if (pathsEqual(sourcePath, destination) && !sourceTarget) {
    messages.push({ level: "info", message: `Skipped ${from}: import source is the Unity source` });
    return result;
  }

  const hasRules = sourceTarget ? await hasTargetRules(sourceTarget, scope, cwd) : false;
  if (!(await pathExists(sourcePath)) && !hasRules) {
    result.errors += 1;
    messages.push({ level: "error", message: `Pull source does not exist: ${sourcePath}` });
    return result;
  }

  if (!pathsEqual(sourcePath, destination)) {
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
  }

  if (sourceTarget) {
    for (const mapping of rulesForScope(sourceTarget, scope)) {
      const rulePath = resolveTargetPath(mapping.target, scope, cwd);
      if (!(await pathIsFile(rulePath))) continue;

      const targetRule = path.join(rulesDestination, mapping.source);
      if (await pathExists(targetRule)) {
        result.skipped += 1;
        messages.push({ level: "warning", message: `Skipped ${mapping.source}: already exists in ${rulesDestination}` });
        continue;
      }

      if (dryRun) {
        messages.push({ level: "info", message: `Would pull ${mapping.source} into ${rulesDestination}` });
      } else {
        await fs.mkdir(path.dirname(targetRule), { recursive: true });
        await fs.copyFile(rulePath, targetRule);
      }
      result.copied += 1;
    }
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

type RuleFile = {
  name: string;
  path: string;
  hash: string;
};

async function listRuleFiles(source: string): Promise<RuleFile[]> {
  return Promise.all(
    (await listFiles(source)).map(async (name) => ({
      name,
      path: path.join(source, name),
      hash: await hashFile(path.join(source, name))
    }))
  );
}

function pathForScope(target: TargetConfig, scope: Scope): string {
  return scope === "user" ? target.userPath : target.projectPath;
}

function rulesForScope(target: TargetConfig, scope: Scope): RuleMapping[] {
  return scope === "user" ? target.userRules ?? [] : target.projectRules ?? [];
}

async function hasTargetRules(target: TargetConfig, scope: Scope, cwd: string): Promise<boolean> {
  for (const mapping of rulesForScope(target, scope)) {
    if (await pathIsFile(resolveTargetPath(mapping.target, scope, cwd))) return true;
  }
  return false;
}

async function pathIsFile(filePath: string): Promise<boolean> {
  const stat = await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  return Boolean(stat?.isFile());
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

async function syncRule(input: {
  targetId: string;
  sourceName: string;
  sourcePath: string;
  sourceHash: string;
  targetPath: string;
  managed?: ManagedRule;
  force: boolean;
  dryRun: boolean;
  messages: UnityMessage[];
}): Promise<"copied" | "unchanged" | "skipped"> {
  const stat = await fs.lstat(input.targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });

  if (stat?.isSymbolicLink()) {
    input.messages.push({
      level: "warning",
      message: `Skipped ${input.sourceName} in ${input.targetId}: target is a symbolic link`
    });
    return "skipped";
  }

  if (stat && !stat.isFile()) {
    input.messages.push({
      level: "warning",
      message: `Skipped ${input.sourceName} in ${input.targetId}: target is not a file`
    });
    return "skipped";
  }

  if (!stat) {
    if (!input.dryRun) {
      await fs.mkdir(path.dirname(input.targetPath), { recursive: true });
      await fs.copyFile(input.sourcePath, input.targetPath);
    }
    input.messages.push({ level: "info", message: `${input.dryRun ? "Would copy" : "Copied"} ${input.sourceName} to ${input.targetId}` });
    return "copied";
  }

  const currentHash = await hashFile(input.targetPath);
  if (!input.managed && !input.force) {
    input.messages.push({
      level: "warning",
      message: `Skipped ${input.sourceName} in ${input.targetId}: target exists but is not Unity-managed`
    });
    return "skipped";
  }

  if (input.managed && currentHash !== input.managed.hash && !input.force) {
    input.messages.push({
      level: "warning",
      message: `Skipped ${input.sourceName} in ${input.targetId}: target changed outside Unity`
    });
    return "skipped";
  }

  if (currentHash === input.sourceHash) return "unchanged";

  if (!input.dryRun) {
    await fs.mkdir(path.dirname(input.targetPath), { recursive: true });
    await fs.copyFile(input.sourcePath, input.targetPath);
  }
  input.messages.push({ level: "info", message: `${input.dryRun ? "Would update" : "Updated"} ${input.sourceName} in ${input.targetId}` });
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

async function removeManagedRule(input: {
  targetId: string;
  sourceName: string;
  managed: ManagedRule;
  force: boolean;
  dryRun: boolean;
  messages: UnityMessage[];
}): Promise<"removed" | "missing" | "skipped"> {
  const stat = await fs.lstat(input.managed.targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return "missing";
  if (!stat.isFile()) {
    input.messages.push({
      level: "warning",
      message: `Skipped removing ${input.sourceName} from ${input.targetId}: target is not a file`
    });
    return "skipped";
  }

  const currentHash = await hashFile(input.managed.targetPath);
  if (currentHash !== input.managed.hash && !input.force) {
    input.messages.push({
      level: "warning",
      message: `Skipped removing ${input.sourceName} from ${input.targetId}: target changed outside Unity`
    });
    return "skipped";
  }

  if (!input.dryRun) await fs.rm(input.managed.targetPath, { force: true });
  input.messages.push({ level: "info", message: `${input.dryRun ? "Would remove" : "Removed"} ${input.sourceName} from ${input.targetId}` });
  return "removed";
}

async function copyDirectoryWithSkillName(source: string, destination: string, name: string): Promise<void> {
  await copyDirectory(source, destination);
  const skillFile = path.join(destination, "SKILL.md");
  const raw = await fs.readFile(skillFile, "utf8");
  await fs.writeFile(skillFile, raw.replace(/^name:\s*.*$/m, `name: ${name}`), "utf8");
}
