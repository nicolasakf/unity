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

export async function loadConfig(scope: Scope, cwd = process.cwd()): Promise<UnityConfig> {
  const loaded = await readJsonFile<UnityConfig>(configPath(scope, cwd), defaultConfig());
  return normalizeConfig(loaded);
}

export async function saveConfig(scope: Scope, config: UnityConfig, cwd = process.cwd()): Promise<void> {
  await writeJsonFile(configPath(scope, cwd), normalizeConfig(config));
}

export async function ensureScope(scope: Scope, cwd = process.cwd()): Promise<UnityConfig> {
  await fs.mkdir(sourceDir(scope, cwd), { recursive: true });
  const config = await loadConfig(scope, cwd);
  await saveConfig(scope, config, cwd);
  return config;
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
