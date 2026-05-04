import type { TargetConfig } from "./types.js";

export const BUILT_IN_TARGETS: Record<string, TargetConfig> = {
  codex: {
    id: "codex",
    userPath: "~/.agents/skills",
    projectPath: ".agents/skills",
    projectRules: [{ source: "AGENTS.md", target: "AGENTS.md" }],
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
    userRules: [{ source: "CLAUDE.md", target: "~/.claude/CLAUDE.md" }],
    projectRules: [{ source: "CLAUDE.md", target: "CLAUDE.md" }],
    enabled: { user: true, project: true },
    builtIn: true
  },
  augment: {
    id: "augment",
    userPath: "~/.augment/skills",
    projectPath: ".augment/skills",
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
  devin: {
    id: "devin",
    userPath: "~/.config/devin/skills",
    projectPath: ".devin/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  factory: {
    id: "factory",
    userPath: "~/.factory/skills",
    projectPath: ".factory/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  goose: {
    id: "goose",
    userPath: "~/.config/goose/skills",
    projectPath: ".goose/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  openclaw: {
    id: "openclaw",
    userPath: "~/.openclaw/skills",
    projectPath: ".agents/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  opencode: {
    id: "opencode",
    userPath: "~/.config/opencode/skills",
    projectPath: ".opencode/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  openhands: {
    id: "openhands",
    userPath: "~/.openhands/skills",
    projectPath: ".openhands/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  qwen: {
    id: "qwen",
    userPath: "~/.qwen/skills",
    projectPath: ".qwen/skills",
    enabled: { user: true, project: true },
    builtIn: true
  },
  windsurf: {
    id: "windsurf",
    userPath: "~/.codeium/windsurf/skills",
    projectPath: ".windsurf/skills",
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
        userRules: target.userRules?.map((rule) => ({ ...rule })),
        projectRules: target.projectRules?.map((rule) => ({ ...rule })),
        enabled: { ...target.enabled }
      }
    ])
  );
}
