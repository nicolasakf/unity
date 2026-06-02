import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enabledTargets, ensureScope, loadConfig, saveConfig } from "../src/config.js";
import { resolveTargetPath, rulesSourceDir, sourceDir } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { pruneTarget, pullScope, pushScope, syncScope } from "../src/sync.js";
import { createTempProject, exists, readText, writeRule, writeSkill } from "./helpers.js";

describe("sync", () => {
  it("mirrors project skills into all built-in project targets", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "code-review");

    const result = await pushScope("project", { cwd: root });

    await expect(expectedCopiedTargets("project", root)).resolves.toBe(result.copied);
    await expect(exists(path.join(root, ".agents", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".claude", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".cursor", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".opencode", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".augment", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".windsurf", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".qwen", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
  });

  it("mirrors user skills into all built-in user targets", async () => {
    const { root, home } = await createTempProject();
    await ensureScope("user", root);
    await writeSkill(sourceDir("user", root), "release-notes");

    const result = await pushScope("user", { cwd: root });

    await expect(expectedCopiedTargets("user", root)).resolves.toBe(result.copied);
    await expect(exists(path.join(home, ".agents", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".claude", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".cursor", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".config", "opencode", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".augment", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".codeium", "windsurf", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".openclaw", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".qwen", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
  });

  it("mirrors project rules into built-in project rule files", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeRule(rulesSourceDir("project", root), "AGENTS.md", "Use repo instructions.");
    await writeRule(rulesSourceDir("project", root), "CLAUDE.md", "Use Claude instructions.");

    const result = await pushScope("project", { cwd: root });

    expect(result.copied).toBe(2);
    await expect(readText(path.join(root, "AGENTS.md"))).resolves.toBe("Use repo instructions.");
    await expect(readText(path.join(root, "CLAUDE.md"))).resolves.toBe("Use Claude instructions.");
  });

  it("pulls project rules from configured targets into the Unity source", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await fs.writeFile(path.join(root, "CLAUDE.md"), "Claude rules.", "utf8");

    const result = await pullScope("project", { cwd: root, from: "claude" });

    expect(result.copied).toBe(1);
    await expect(readText(path.join(root, ".agents", "rules", "CLAUDE.md"))).resolves.toBe("Claude rules.");
  });

  it("updates existing source rules when a changed target rule is pulled", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.claude.projectRules = [{ source: "AGENTS.md", target: "CLAUDE.md" }];
    await saveConfig("project", config, root);
    await writeRule(rulesSourceDir("project", root), "AGENTS.md", "Old shared rules.");
    await pushScope("project", { cwd: root });

    await fs.writeFile(path.join(root, "CLAUDE.md"), "New shared rules.", "utf8");
    const result = await pullScope("project", { cwd: root, from: "claude" });
    await pushScope("project", { cwd: root });

    expect(result.copied).toBe(1);
    await expect(readText(path.join(root, ".agents", "rules", "AGENTS.md"))).resolves.toBe("New shared rules.");
    await expect(readText(path.join(root, "AGENTS.md"))).resolves.toBe("New shared rules.");
  });

  it("adopts matching existing target rules into state", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeRule(rulesSourceDir("project", root), "CLAUDE.md", "Shared rules.");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "Shared rules.", "utf8");

    const result = await pushScope("project", { cwd: root });
    const state = await loadState("project", root);

    expect(result.skipped).toBe(0);
    expect(state.targets.claude.rules?.["CLAUDE.md"]).toBeDefined();
  });

  it("mirrors user rules into built-in user rule files", async () => {
    const { root, home } = await createTempProject();
    await ensureScope("user", root);
    await writeRule(rulesSourceDir("user", root), "CLAUDE.md", "User Claude rules.");

    const result = await pushScope("user", { cwd: root });

    expect(result.copied).toBe(1);
    await expect(readText(path.join(home, ".claude", "CLAUDE.md"))).resolves.toBe("User Claude rules.");
  });

  it("removes managed target rules when source rules are deleted", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const rulePath = await writeRule(rulesSourceDir("project", root), "CLAUDE.md", "Temporary rules.");
    await pushScope("project", { cwd: root });

    await fs.rm(rulePath);
    const result = await pushScope("project", { cwd: root });

    expect(result.removed).toBe(1);
    await expect(exists(path.join(root, "CLAUDE.md"))).resolves.toBe(false);
  });

  it("does not overwrite unmanaged target rules unless forced", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeRule(rulesSourceDir("project", root), "CLAUDE.md", "Source rules.");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "unmanaged", "utf8");

    const result = await pushScope("project", { cwd: root });
    expect(result.skipped).toBe(1);
    await expect(readText(path.join(root, "CLAUDE.md"))).resolves.toBe("unmanaged");

    const forced = await pushScope("project", { cwd: root, force: true });
    expect(forced.copied).toBe(1);
    await expect(readText(path.join(root, "CLAUDE.md"))).resolves.toBe("Source rules.");
  });

  it("previews rule sync changes without writing targets or state", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeRule(rulesSourceDir("project", root), "CLAUDE.md", "Preview rules.");

    const result = await pushScope("project", { cwd: root, dryRun: true });

    expect(result.copied).toBe(1);
    await expect(exists(path.join(root, "CLAUDE.md"))).resolves.toBe(false);
    await expect(exists(path.join(root, ".agents", "unity", "state.json"))).resolves.toBe(false);
  });

  it("removes managed target skills when source skills are deleted", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const skillDir = await writeSkill(sourceDir("project", root), "temporary-skill");
    await pushScope("project", { cwd: root });

    await fs.rm(skillDir, { recursive: true });
    const result = await pushScope("project", { cwd: root });

    await expect(expectedCopiedTargets("project", root)).resolves.toBe(result.removed);
    await expect(exists(path.join(root, ".agents", "skills", "temporary-skill"))).resolves.toBe(false);
  });

  it("skips disabled targets", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.claude.enabled.project = false;
    await saveConfig("project", config, root);
    await writeSkill(sourceDir("project", root), "cursor-only");

    const result = await pushScope("project", { cwd: root });

    await expect(expectedCopiedTargets("project", root, ["claude"])).resolves.toBe(result.copied);
    await expect(exists(path.join(root, ".claude", "skills", "cursor-only"))).resolves.toBe(false);
  });

  it("does not overwrite unmanaged target skills unless forced", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "conflict-skill", "Source version.");
    const targetDir = path.join(root, ".claude", "skills", "conflict-skill");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "SKILL.md"), "unmanaged", "utf8");

    const result = await pushScope("project", { cwd: root });
    expect(result.skipped).toBe(1);
    await expect(readText(path.join(targetDir, "SKILL.md"))).resolves.toBe("unmanaged");

    const forced = await pushScope("project", { cwd: root, force: true });
    expect(forced.copied).toBe(1);
    await expect(readText(path.join(targetDir, "SKILL.md"))).resolves.toContain("Source version.");
  });

  it("previews sync changes without writing targets or state", async () => {
    const { root } = await createTempProject();
    await writeSkill(sourceDir("project", root), "preview-skill");

    const result = await pushScope("project", { cwd: root, dryRun: true });

    await expect(expectedCopiedTargets("project", root)).resolves.toBe(result.copied);
    await expect(exists(path.join(root, ".claude", "skills", "preview-skill"))).resolves.toBe(false);
    await expect(exists(path.join(root, ".agents", "unity", "state.json"))).resolves.toBe(false);
  });

  it("prunes only Unity-managed skills from disabled targets", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "managed-skill");
    await pushScope("project", { cwd: root });

    const config = await loadConfig("project", root);
    config.targets.claude.enabled.project = false;
    await saveConfig("project", config, root);
    const result = await pruneTarget("project", "claude", root);

    expect(result.removed).toBe(1);
    await expect(exists(path.join(root, ".claude", "skills", "managed-skill"))).resolves.toBe(false);
    await expect(exists(path.join(root, ".agents", "skills", "managed-skill"))).resolves.toBe(true);
  });

  it("pulls skills from a configured target into the Unity source", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(path.join(root, ".claude", "skills"), "pulled-skill");

    const result = await pullScope("project", { cwd: root, from: "claude" });

    expect(result.copied).toBe(1);
    await expect(exists(path.join(root, ".agents", "skills", "pulled-skill", "SKILL.md"))).resolves.toBe(true);
  });

  it("pulls new skills from enabled targets into the Unity source", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(path.join(root, ".claude", "skills"), "claude-skill");
    await writeSkill(path.join(root, ".cursor", "skills"), "cursor-skill");

    const result = await pullScope("project", { cwd: root });

    expect(result.copied).toBe(2);
    await expect(exists(path.join(root, ".agents", "skills", "claude-skill", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".agents", "skills", "cursor-skill", "SKILL.md"))).resolves.toBe(true);
  });

  it("sync pulls new target skills before pushing Unity source skills", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(path.join(root, ".claude", "skills"), "claude-skill");
    await writeSkill(sourceDir("project", root), "source-skill");

    const result = await syncScope("project", { cwd: root });

    expect(result.copied).toBeGreaterThanOrEqual(2);
    await expect(exists(path.join(root, ".agents", "skills", "claude-skill", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".cursor", "skills", "claude-skill", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".claude", "skills", "source-skill", "SKILL.md"))).resolves.toBe(true);
  });

  it("pull skips target skills that already exist in the Unity source", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "shared-skill", "Source version.");
    await writeSkill(path.join(root, ".claude", "skills"), "shared-skill", "Target version.");

    const result = await pullScope("project", { cwd: root });

    expect(result.copied).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    await expect(readText(path.join(root, ".agents", "skills", "shared-skill", "SKILL.md"))).resolves.toContain("Source version.");
  });

  it("repairs folder/name mismatches during pull when requested", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const skillDir = path.join(root, ".cursor", "skills", "create-skill-local");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: create-skill\ndescription: Skill creator.\n---\n\nBody.\n",
      "utf8"
    );

    const result = await pullScope("project", { cwd: root, from: "cursor", fixNames: true });

    expect(result.copied).toBe(1);
    const pulled = await readText(path.join(root, ".agents", "skills", "create-skill-local", "SKILL.md"));
    expect(pulled).toContain("name: create-skill-local");
  });

  it("does not repair folder/name mismatches unless requested", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const skillDir = path.join(root, ".cursor", "skills", "create-skill-local");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: create-skill\ndescription: Skill creator.\n---\n",
      "utf8"
    );

    const result = await pullScope("project", { cwd: root, from: "cursor" });

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("refuses to sync while a scope lock exists", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "locked-skill");
    await fs.writeFile(path.join(root, ".agents", "sync.lock"), "locked", "utf8");

    await expect(pushScope("project", { cwd: root })).rejects.toThrow("Another Unity operation");
  });

  it("breaks a stale lock whose recorded pid is no longer alive", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "stale-lock-skill");
    const deadPid = await findDeadPid();
    await fs.mkdir(path.join(root, ".agents"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".agents", "sync.lock"),
      JSON.stringify({ pid: deadPid, scope: "project", createdAt: new Date().toISOString() }),
      "utf8"
    );

    const result = await pushScope("project", { cwd: root });
    expect(result.copied).toBeGreaterThan(0);
  });

  it("does not copy node_modules or dot-directories nested inside skills", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const skillDir = await writeSkill(sourceDir("project", root), "noisy-skill");
    await fs.mkdir(path.join(skillDir, "node_modules", "junk"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "node_modules", "junk", "x.js"), "x", "utf8");
    await fs.mkdir(path.join(skillDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(skillDir, ".git", "HEAD"), "ref", "utf8");

    await pushScope("project", { cwd: root });

    const target = path.join(root, ".claude", "skills", "noisy-skill");
    await expect(exists(path.join(target, "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(target, "node_modules"))).resolves.toBe(false);
    await expect(exists(path.join(target, ".git"))).resolves.toBe(false);
  });

  it("does not copy symlinked directories nested inside skills", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const skillDir = await writeSkill(sourceDir("project", root), "linked-content");
    const outsideDir = path.join(root, "outside");
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "secret", "utf8");
    await fs.symlink(outsideDir, path.join(skillDir, "linked"), "dir");

    await pushScope("project", { cwd: root });

    const target = path.join(root, ".claude", "skills", "linked-content");
    await expect(exists(path.join(target, "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(target, "linked"))).resolves.toBe(false);
    await expect(exists(path.join(target, "linked", "secret.txt"))).resolves.toBe(false);
  });

  it("refuses to overwrite a target that is a symbolic link", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "linked-skill");
    const elsewhere = path.join(root, "elsewhere");
    await fs.mkdir(elsewhere, { recursive: true });
    const targetParent = path.join(root, ".claude", "skills");
    await fs.mkdir(targetParent, { recursive: true });
    await fs.symlink(elsewhere, path.join(targetParent, "linked-skill"), "dir");

    const result = await pushScope("project", { cwd: root });
    expect(result.skipped).toBeGreaterThan(0);
    const stat = await fs.lstat(path.join(targetParent, "linked-skill"));
    expect(stat.isSymbolicLink()).toBe(true);
  });
});

async function findDeadPid(): Promise<number> {
  for (let candidate = 999000; candidate > 1; candidate--) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return candidate;
    }
  }
  throw new Error("could not find a dead pid for the test");
}

async function expectedCopiedTargets(scope: "user" | "project", root: string, disabled: string[] = []): Promise<number> {
  const config = await loadConfig(scope, root);
  const source = sourceDir(scope, root);
  return enabledTargets(config, scope).filter((target) => {
    if (disabled.includes(target.id)) return false;
    const targetPath = resolveTargetPath(scope === "user" ? target.userPath : target.projectPath, scope, root);
    return path.resolve(targetPath) !== path.resolve(source);
  }).length;
}
