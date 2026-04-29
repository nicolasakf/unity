import type { TargetConfig } from "./types.js";

export const BUILT_IN_TARGETS: Record<string, TargetConfig> = {
  codex: {
    id: "codex",
    userPath: "~/.agents/skills",
    projectPath: ".agents/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  orion: {
    id: "orion",
    userPath: "~/.agents/skills",
    projectPath: ".agents/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  claude: {
    id: "claude",
    userPath: "~/.claude/skills",
    projectPath: ".claude/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  cursor: {
    id: "cursor",
    userPath: "~/.cursor/skills",
    projectPath: ".cursor/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  opencode: {
    id: "opencode",
    userPath: "~/.config/opencode/skills",
    projectPath: ".opencode/skills",
    enabled: { user: true, project: true },
    builtIn: true
  }
};

export function defaultConfigTargets(): Record<string, TargetConfig> {
  return Object.fromEntries(
    Object.entries(BUILT_IN_TARGETS).map(([id, target]) => [
      id,
      {
        ...target,
        enabled: { ...target.enabled }
      }
    ])
  );
}
