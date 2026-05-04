import { enabledTargets, loadConfig } from "./config.js";
import { rulesSourceDir, resolveTargetPath, sourceDir } from "./paths.js";
import { listFiles } from "./file-tree.js";
import { listValidSkills } from "./skills.js";
import { loadState } from "./state.js";
import type { InvalidSkillValidation, Scope } from "./types.js";

export type TargetStatus = {
  id: string;
  enabled: boolean;
  path: string;
  managedSkills: string[];
  managedRules: string[];
};

export type StatusSummary = {
  scope: Scope;
  source: string;
  validSkills: number;
  invalidSkills: number;
  enabledTargets: number;
  managedSkills: number;
  sourceRules: number;
  managedRules: number;
  skillNames: string[];
  ruleNames: string[];
  invalidSkillDetails: InvalidSkillValidation[];
  targets: TargetStatus[];
};

export async function getStatus(scope: Scope, cwd = process.cwd()): Promise<StatusSummary> {
  const config = await loadConfig(scope, cwd);
  const state = await loadState(scope, cwd);
  const source = sourceDir(scope, cwd);
  const skills = await listValidSkills(source);
  const ruleNames = await listFiles(rulesSourceDir(scope, cwd));
  const managedSkills = Object.values(state.targets).reduce(
    (total, target) => total + Object.keys(target.skills ?? {}).length,
    0
  );
  const managedRules = Object.values(state.targets).reduce(
    (total, target) => total + Object.keys(target.rules ?? {}).length,
    0
  );
  const targets = Object.values(config.targets).map((target) => ({
    id: target.id,
    enabled: target.enabled[scope],
    path: resolveTargetPath(scope === "user" ? target.userPath : target.projectPath, scope, cwd),
    managedSkills: Object.keys(state.targets[target.id]?.skills ?? {}).sort(),
    managedRules: Object.keys(state.targets[target.id]?.rules ?? {}).sort()
  }));

  return {
    scope,
    source,
    validSkills: skills.skills.length,
    invalidSkills: skills.invalid.length,
    enabledTargets: enabledTargets(config, scope).length,
    managedSkills,
    sourceRules: ruleNames.length,
    managedRules,
    skillNames: skills.skills.map((skill) => skill.name).sort(),
    ruleNames,
    invalidSkillDetails: skills.invalid,
    targets
  };
}
