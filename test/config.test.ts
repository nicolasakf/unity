import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureScope, loadConfig, saveConfig } from "../src/config.js";
import { expandPath, resolveTargetPath, sourceDir } from "../src/paths.js";
import { getStatus } from "../src/status.js";
import { createTempProject, exists } from "./helpers.js";

describe("configuration and paths", () => {
  it("creates user and project source directories", async () => {
    const { root, home } = await createTempProject();

    await ensureScope("user", root);
    await ensureScope("project", root);

    await expect(exists(path.join(home, ".agent", "skills"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".agent", "skills"))).resolves.toBe(true);
  });

  it("expands home and project-relative target paths", async () => {
    const { root, home } = await createTempProject();

    expect(expandPath("~/skills", root)).toBe(path.join(home, "skills"));
    expect(resolveTargetPath(".agents/skills", "project", root)).toBe(path.join(root, ".agents", "skills"));
  });

  it("persists target enablement", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.cursor.enabled.project = false;
    await saveConfig("project", config, root);

    const reloaded = await loadConfig("project", root);

    expect(reloaded.targets.cursor.enabled.project).toBe(false);
    expect(sourceDir("project", root)).toBe(path.join(root, ".agent", "skills"));
  });

  it("reports verbose status details", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);

    const status = await getStatus("project", root);

    expect(status.targets.map((target) => target.id)).toContain("cursor");
    expect(status.skillNames).toEqual([]);
    expect(status.invalidSkillDetails).toEqual([]);
  });
});
