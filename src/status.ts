import { enabledTargets, loadConfig } from "./config.js";
import { resolveTargetPath, sourceDir } from "./paths.js";
import { listValidSkills } from "./skills.js";
import { loadState } from "./state.js";
import type { InvalidSkillValidation, Scope } from "./types.js";

export type TargetStatus = {
  id: string;
  enabled: boolean;
  path: string;
  managedSkills: string[];
};

export type StatusSummary = {
  scope: Scope;
  source: string;
  validSkills: number;
  invalidSkills: number;
  enabledTargets: number;
  managedSkills: number;
  skillNames: string[];
  invalidSkillDetails: InvalidSkillValidation[];
  targets: TargetStatus[];
};

export async function getStatus(scope: Scope, cwd = process.cwd()): Promise<StatusSummary> {
  const config = await loadConfig(scope, cwd);
  const state = await loadState(scope, cwd);
  const source = sourceDir(scope, cwd);
  const skills = await listValidSkills(source);
  const managedSkills = Object.values(state.targets).reduce(
    (total, target) => total + Object.keys(target.skills ?? {}).length,
    0
  );
  const targets = Object.values(config.targets).map((target) => ({
    id: target.id,
    enabled: target.enabled[scope],
    path: resolveTargetPath(scope === "user" ? target.userPath : target.projectPath, scope, cwd),
    managedSkills: Object.keys(state.targets[target.id]?.skills ?? {}).sort()
  }));

  return {
    scope,
    source,
    validSkills: skills.skills.length,
    invalidSkills: skills.invalid.length,
    enabledTargets: enabledTargets(config, scope).length,
    managedSkills,
    skillNames: skills.skills.map((skill) => skill.name).sort(),
    invalidSkillDetails: skills.invalid,
    targets
  };
}
