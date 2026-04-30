import fs from "node:fs/promises";
import { defaultConfigTargets } from "./agents.js";
import { configPath, expandPath, findProjectRoot, sourceDir } from "./paths.js";
import type { Scope, TargetConfig, UnityConfig } from "./types.js";
import { readJsonFile, writeJsonFile } from "./json.js";

export function defaultConfig(): UnityConfig {
  return {
    version: 1,
    targets: defaultConfigTargets(),
    projects: []
  };
}

/**
 * When project scope has no config file yet (no `.agents/config.json`), avoid treating
 * that as "all built-in targets enabled" — there is no project-level Unity setup.
 */
function projectConfigFallback(): UnityConfig {
  const base = defaultConfig();
  const targets: Record<string, TargetConfig> = {};
  for (const [id, target] of Object.entries(base.targets)) {
    targets[id] = { ...target, enabled: { user: false, project: false } };
  }
  return { version: 1, targets, projects: [] };
}

async function configFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(scope: Scope, cwd = process.cwd()): Promise<UnityConfig> {
  const cfgPath = configPath(scope, cwd);
  const fallback =
    scope === "project" && !(await configFileExists(cfgPath)) ? projectConfigFallback() : defaultConfig();
  const loaded = await readJsonFile<UnityConfig>(cfgPath, fallback);
  return normalizeConfig(loaded);
}

export async function saveConfig(scope: Scope, config: UnityConfig, cwd = process.cwd()): Promise<void> {
  await writeJsonFile(configPath(scope, cwd), normalizeConfig(config));
}

export async function ensureScope(scope: Scope, cwd = process.cwd()): Promise<UnityConfig> {
  await fs.mkdir(sourceDir(scope, cwd), { recursive: true });
  const cfgPath = configPath(scope, cwd);
  const configExisted = await configFileExists(cfgPath);
  const config = await loadConfig(scope, cwd);
  if (scope === "project" && !configExisted) {
    copyTargetSelectionFromUserToProject(await loadConfig("user", cwd), config);
  }
  await saveConfig(scope, config, cwd);
  return config;
}

/**
 * Use the user's target selection (`enabled.user` in ~/.agents/config.json) for both scopes
 * in a new repo config so project-scope sync mirrors the targets chosen during init / user config.
 */
export function copyTargetSelectionFromUserToProject(userConfig: UnityConfig, projectConfig: UnityConfig): void {
  for (const [id, source] of Object.entries(userConfig.targets)) {
    const on = source.enabled?.user ?? true;
    if (!projectConfig.targets[id]) {
      projectConfig.targets[id] = { ...source, enabled: { user: on, project: on } };
      continue;
    }
    const target = projectConfig.targets[id];
    target.enabled.user = on;
    target.enabled.project = on;
  }
}

export function normalizeConfig(config: UnityConfig): UnityConfig {
  const defaults = defaultConfig();
  const targets: Record<string, TargetConfig> = {};

  for (const [id, target] of Object.entries(defaults.targets)) {
    targets[id] = {
      ...target,
      ...(config.targets?.[id] ?? {}),
      id,
      enabled: {
        user: config.targets?.[id]?.enabled?.user ?? target.enabled.user,
        project: config.targets?.[id]?.enabled?.project ?? target.enabled.project
      },
      builtIn: true
    };
  }

  for (const [id, target] of Object.entries(config.targets ?? {})) {
    if (targets[id]) continue;
    targets[id] = {
      id,
      userPath: target.userPath,
      projectPath: target.projectPath,
      enabled: {
        user: target.enabled?.user ?? true,
        project: target.enabled?.project ?? true
      },
      builtIn: false
    };
  }

  return {
    version: 1,
    targets,
    projects: normalizeProjects(config.projects)
  };
}

export function enabledTargets(config: UnityConfig, scope: Scope): TargetConfig[] {
  return Object.values(config.targets).filter((target) => target.enabled[scope]);
}

export async function listRegisteredProjects(cwd = process.cwd()): Promise<string[]> {
  const config = await loadConfig("user", cwd);
  return config.projects;
}

export async function addRegisteredProject(input = ".", cwd = process.cwd()): Promise<string> {
  await ensureScope("user", cwd);
  const config = await loadConfig("user", cwd);
  const projectRoot = findProjectRoot(expandPath(input, cwd));
  config.projects = normalizeProjects([...config.projects, projectRoot]);
  await saveConfig("user", config, cwd);
  await ensureScope("project", projectRoot);
  return projectRoot;
}

export async function removeRegisteredProject(input = ".", cwd = process.cwd()): Promise<string | undefined> {
  await ensureScope("user", cwd);
  const config = await loadConfig("user", cwd);
  const projectRoot = findProjectRoot(expandPath(input, cwd));
  const before = config.projects.length;
  config.projects = config.projects.filter((project) => project !== projectRoot);
  await saveConfig("user", config, cwd);
  return config.projects.length === before ? undefined : projectRoot;
}

function normalizeProjects(projects: string[] | undefined): string[] {
  return [...new Set(projects ?? [])].sort();
}
