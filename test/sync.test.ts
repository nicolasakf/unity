import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureScope, loadConfig, saveConfig } from "../src/config.js";
import { sourceDir } from "../src/paths.js";
import { importSkills, pruneTarget, pullScope, syncScope } from "../src/sync.js";
import { createTempProject, exists, readText, writeSkill } from "./helpers.js";

describe("sync", () => {
  it("mirrors project skills into all built-in project targets", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "code-review");

    const result = await syncScope("project", { cwd: root });

    expect(result.copied).toBe(3);
    await expect(exists(path.join(root, ".agents", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".claude", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".cursor", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".opencode", "skills", "code-review", "SKILL.md"))).resolves.toBe(true);
  });

  it("mirrors user skills into all built-in user targets", async () => {
    const { root, home } = await createTempProject();
    await ensureScope("user", root);
    await writeSkill(sourceDir("user", root), "release-notes");

    const result = await syncScope("user", { cwd: root });

    expect(result.copied).toBe(3);
    await expect(exists(path.join(home, ".agents", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".claude", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".cursor", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".config", "opencode", "skills", "release-notes", "SKILL.md"))).resolves.toBe(true);
  });

  it("removes managed target skills when source skills are deleted", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const skillDir = await writeSkill(sourceDir("project", root), "temporary-skill");
    await syncScope("project", { cwd: root });

    await fs.rm(skillDir, { recursive: true });
    const result = await syncScope("project", { cwd: root });

    expect(result.removed).toBe(3);
    await expect(exists(path.join(root, ".agents", "skills", "temporary-skill"))).resolves.toBe(false);
  });

  it("skips disabled targets", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.claude.enabled.project = false;
    await saveConfig("project", config, root);
    await writeSkill(sourceDir("project", root), "cursor-only");

    const result = await syncScope("project", { cwd: root });

    expect(result.copied).toBe(2);
    await expect(exists(path.join(root, ".claude", "skills", "cursor-only"))).resolves.toBe(false);
  });

  it("does not overwrite unmanaged target skills unless forced", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "conflict-skill", "Source version.");
    const targetDir = path.join(root, ".claude", "skills", "conflict-skill");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "SKILL.md"), "unmanaged", "utf8");

    const result = await syncScope("project", { cwd: root });
    expect(result.skipped).toBe(1);
    await expect(readText(path.join(targetDir, "SKILL.md"))).resolves.toBe("unmanaged");

    const forced = await syncScope("project", { cwd: root, force: true });
    expect(forced.copied).toBe(1);
    await expect(readText(path.join(targetDir, "SKILL.md"))).resolves.toContain("Source version.");
  });

  it("previews sync changes without writing targets or state", async () => {
    const { root } = await createTempProject();
    await writeSkill(sourceDir("project", root), "preview-skill");

    const result = await syncScope("project", { cwd: root, dryRun: true });

    expect(result.copied).toBe(3);
    await expect(exists(path.join(root, ".claude", "skills", "preview-skill"))).resolves.toBe(false);
    await expect(exists(path.join(root, ".agents", "state.json"))).resolves.toBe(false);
  });

  it("prunes only Unity-managed skills from disabled targets", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "managed-skill");
    await syncScope("project", { cwd: root });

    const config = await loadConfig("project", root);
    config.targets.claude.enabled.project = false;
    await saveConfig("project", config, root);
    const result = await pruneTarget("project", "claude", root);

    expect(result.removed).toBe(1);
    await expect(exists(path.join(root, ".claude", "skills", "managed-skill"))).resolves.toBe(false);
    await expect(exists(path.join(root, ".agents", "skills", "managed-skill"))).resolves.toBe(true);
  });

  it("imports skills from a configured target into the Unity source", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(path.join(root, ".claude", "skills"), "imported-skill");

    const result = await importSkills("claude", "project", root);

    expect(result.copied).toBe(1);
    await expect(exists(path.join(root, ".agents", "skills", "imported-skill", "SKILL.md"))).resolves.toBe(true);
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

  it("repairs folder/name mismatches during import when requested", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const skillDir = path.join(root, ".cursor", "skills", "create-skill-local");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: create-skill\ndescription: Skill creator.\n---\n\nBody.\n",
      "utf8"
    );

    const result = await importSkills("cursor", "project", { cwd: root, fixNames: true });

    expect(result.copied).toBe(1);
    const imported = await readText(path.join(root, ".agents", "skills", "create-skill-local", "SKILL.md"));
    expect(imported).toContain("name: create-skill-local");
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

    const result = await importSkills("cursor", "project", root);

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("refuses to sync while a scope lock exists", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    await writeSkill(sourceDir("project", root), "locked-skill");
    await fs.writeFile(path.join(root, ".agents", "sync.lock"), "locked", "utf8");

    await expect(syncScope("project", { cwd: root })).rejects.toThrow("Another Unity operation");
  });
});
