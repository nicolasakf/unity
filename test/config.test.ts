import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRegisteredProject, ensureScope, listRegisteredProjects, loadConfig, removeRegisteredProject, saveConfig } from "../src/config.js";
import { expandPath, isPathWithin, pathsEqual, resolveTargetPath, rulesSourceDir, sourceDir } from "../src/paths.js";
import { getStatus } from "../src/status.js";
import { createTempProject, exists } from "./helpers.js";

describe("configuration and paths", () => {
  it("creates user and project source directories", async () => {
    const { root, home } = await createTempProject();

    await ensureScope("user", root);
    await ensureScope("project", root);

    await expect(exists(path.join(home, ".agents", "skills"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".agents", "skills"))).resolves.toBe(true);
    await expect(exists(path.join(home, ".agents", "rules"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".agents", "rules"))).resolves.toBe(true);
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
    expect(sourceDir("project", root)).toBe(path.join(root, ".agents", "skills"));
    expect(rulesSourceDir("project", root)).toBe(path.join(root, ".agents", "rules"));
  });

  it("reports verbose status details", async () => {
    const { root } = await createTempProject();
    await ensureScope("project", root);

    const status = await getStatus("project", root);

    expect(status.targets.map((target) => target.id)).toContain("cursor");
    expect(status.skillNames).toEqual([]);
    expect(status.invalidSkillDetails).toEqual([]);
  });

  it("new project configs inherit target selection from user config", async () => {
    const { root } = await createTempProject();

    await ensureScope("user", root);
    const userCfg = await loadConfig("user", root);
    for (const target of Object.values(userCfg.targets)) {
      target.enabled.user = target.id === "codex";
      target.enabled.project = target.id !== "codex";
    }
    await saveConfig("user", userCfg, root);

    await ensureScope("project", root);
    const projectCfg = await loadConfig("project", root);

    expect(projectCfg.targets.codex.enabled.project).toBe(true);
    expect(projectCfg.targets.codex.enabled.user).toBe(true);
    expect(projectCfg.targets.cursor.enabled.project).toBe(false);
    expect(projectCfg.targets.claude.enabled.user).toBe(false);
  });

  it("compares paths with platform-appropriate casing", () => {
    const a = path.resolve("/foo/bar");
    const b = path.resolve("/foo/bar/");
    expect(pathsEqual(a, b)).toBe(true);
    expect(pathsEqual("/foo/bar", "/foo/baz")).toBe(false);
    if (process.platform === "win32") {
      expect(pathsEqual("C:\\Foo\\Bar", "c:\\foo\\bar")).toBe(true);
    }
  });

  it("detects paths within parents using platform casing", () => {
    expect(isPathWithin("/foo", "/foo/bar")).toBe(true);
    expect(isPathWithin("/foo", "/foo")).toBe(true);
    expect(isPathWithin("/foo", "/foobar")).toBe(false);
    expect(isPathWithin("/foo/bar", "/foo")).toBe(false);
    if (process.platform === "win32") {
      expect(isPathWithin("C:\\Foo", "c:\\foo\\bar")).toBe(true);
    }
  });

  it("registers project roots for the global watcher", async () => {
    const { root } = await createTempProject();

    const registered = await addRegisteredProject(".", root);

    expect(registered).toBe(root);
    await expect(listRegisteredProjects(root)).resolves.toEqual([root]);
    await expect(exists(path.join(root, ".agents", "skills"))).resolves.toBe(true);

    await addRegisteredProject(".", root);
    await expect(listRegisteredProjects(root)).resolves.toEqual([root]);

    await expect(removeRegisteredProject(".", root)).resolves.toBe(root);
    await expect(listRegisteredProjects(root)).resolves.toEqual([]);
  });
});
