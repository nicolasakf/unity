export type Scope = "user" | "project";
export type ScopeInput = Scope | "all";

export type TargetConfig = {
  id: string;
  userPath: string;
  projectPath: string;
  enabled: Record<Scope, boolean>;
  builtIn?: boolean;
};

export type UnityConfig = {
  version: 1;
  targets: Record<string, TargetConfig>;
};

export type ManagedSkill = {
  files: Record<string, string>;
};

export type TargetState = {
  targetPath: string;
  skills: Record<string, ManagedSkill>;
};

export type UnityState = {
  version: 1;
  targets: Record<string, TargetState>;
};

export type SkillMetadata = {
  name: string;
  description: string;
  directory: string;
};

export type InvalidSkillValidation = {
  ok: false;
  directory: string;
  reason: string;
};

export type SkillValidation =
  | { ok: true; skill: SkillMetadata }
  | InvalidSkillValidation;

export type MessageLevel = "info" | "warning" | "error";

export type UnityMessage = {
  level: MessageLevel;
  message: string;
};

export type SyncResult = {
  scope: Scope;
  copied: number;
  removed: number;
  skipped: number;
  errors: number;
  messages: UnityMessage[];
};
