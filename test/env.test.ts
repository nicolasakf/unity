import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureScope, loadConfig, saveConfig } from "../src/config.js";
import { buildEnvPushPlan, pushEnvFiles } from "../src/env.js";
import { createTempProject, exists, readText } from "./helpers.js";

describe("env push", () => {
  it("copies root .env files to existing configured target worktrees", async () => {
    const { root } = await createTempProject();
    const targetRoot = await createWorktreeRoot(root, "claude");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=source\n", "utf8");
    await fs.writeFile(path.join(root, ".env.local"), "LOCAL=source\n", "utf8");
    await fs.writeFile(path.join(root, ".envrc"), "ignored\n", "utf8");

    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.claude.projectPath = path.join(targetRoot, ".claude", "skills");
    await saveConfig("project", config, root);

    const plan = await buildEnvPushPlan({ cwd: root });
    expect(plan.destinations.map((destination) => path.basename(destination.destinationPath))).toEqual([".env", ".env.local"]);

    const result = await pushEnvFiles(plan);

    expect(result.copied).toBe(2);
    await expect(readText(path.join(targetRoot, ".env"))).resolves.toBe("TOKEN=source\n");
    await expect(readText(path.join(targetRoot, ".env.local"))).resolves.toBe("LOCAL=source\n");
    await expect(exists(path.join(targetRoot, ".envrc"))).resolves.toBe(false);
  });

  it("limits destinations to explicit --to targets even when a target is disabled", async () => {
    const { root } = await createTempProject();
    const claudeRoot = await createWorktreeRoot(root, "claude");
    const cursorRoot = await createWorktreeRoot(root, "cursor");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=source\n", "utf8");

    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.claude.enabled.project = false;
    config.targets.claude.projectPath = path.join(claudeRoot, ".claude", "skills");
    config.targets.cursor.projectPath = path.join(cursorRoot, ".cursor", "skills");
    await saveConfig("project", config, root);

    const plan = await buildEnvPushPlan({ cwd: root, to: ["claude"] });
    await pushEnvFiles(plan);

    await expect(readText(path.join(claudeRoot, ".env"))).resolves.toBe("TOKEN=source\n");
    await expect(exists(path.join(cursorRoot, ".env"))).resolves.toBe(false);
  });

  it("discovers configured target worktrees under user-level target stores", async () => {
    const { root, home } = await createTempProject();
    const codexRoot = await createStoredWorktreeRoot(root, home, "codex", "abcd", path.basename(root));
    const cursorRoot = await createStoredWorktreeRoot(root, home, "cursor", path.basename(root), "xyz");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=source\n", "utf8");

    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.codex.enabled.project = false;
    await saveConfig("project", config, root);

    const plan = await buildEnvPushPlan({ cwd: root });
    expect(plan.destinations.map((destination) => destination.destinationPath)).toContain(path.join(codexRoot, ".env"));
    expect(plan.destinations.map((destination) => destination.destinationPath)).toContain(path.join(cursorRoot, ".env"));

    await pushEnvFiles(plan);

    await expect(readText(path.join(codexRoot, ".env"))).resolves.toBe("TOKEN=source\n");
    await expect(readText(path.join(cursorRoot, ".env"))).resolves.toBe("TOKEN=source\n");
  });

  it("does not throw when a scanned worktree has a stale or missing .git target", async () => {
    const { root, home } = await createTempProject();
    const staleRoot = path.join(home, ".cursor", "worktrees", "stale-repo");
    await fs.mkdir(staleRoot, { recursive: true });
    await fs.writeFile(
      path.join(staleRoot, ".git"),
      `gitdir: ${path.join(staleRoot, ".git")}\n`,
      "utf8"
    );
    await fs.writeFile(path.join(root, ".env"), "TOKEN=source\n", "utf8");

    await expect(buildEnvPushPlan({ cwd: root })).resolves.toBeDefined();
  });

  it("skips destinations that are symbolic links", async () => {
    const { root } = await createTempProject();
    const targetRoot = await createWorktreeRoot(root, "claude");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=source\n", "utf8");
    await fs.writeFile(path.join(targetRoot, "real.env"), "TOKEN=target\n", "utf8");
    await fs.symlink(path.join(targetRoot, "real.env"), path.join(targetRoot, ".env"));

    await ensureScope("project", root);
    const config = await loadConfig("project", root);
    config.targets.claude.projectPath = path.join(targetRoot, ".claude", "skills");
    await saveConfig("project", config, root);

    const result = await pushEnvFiles(await buildEnvPushPlan({ cwd: root, to: ["claude"] }));

    expect(result.skipped).toBe(1);
    await expect(readText(path.join(targetRoot, "real.env"))).resolves.toBe("TOKEN=target\n");
  });
});

async function createWorktreeRoot(root: string, name: string): Promise<string> {
  const worktreeRoot = path.join(path.dirname(root), `${path.basename(root)}-${name}`);
  await fs.mkdir(path.join(worktreeRoot, ".git"), { recursive: true });
  return worktreeRoot;
}

async function createStoredWorktreeRoot(root: string, home: string, targetId: string, ...segments: string[]): Promise<string> {
  const worktreeRoot = path.join(home, `.${targetId}`, "worktrees", ...segments);
  const worktreeGitDir = path.join(root, ".git", "worktrees", `${targetId}-${segments.join("-")}`);
  await fs.mkdir(worktreeRoot, { recursive: true });
  await fs.mkdir(worktreeGitDir, { recursive: true });
  await fs.writeFile(path.join(worktreeRoot, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");
  return worktreeRoot;
}
