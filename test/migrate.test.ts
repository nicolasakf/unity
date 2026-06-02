import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrateLayout, migrateScope } from "../src/migrate.js";
import {
  configPath,
  legacyConfigPath,
  legacyLogDir,
  legacyStatePath,
  logDir,
  statePath
} from "../src/paths.js";
import { createTempProject, exists, readText } from "./helpers.js";

describe("migrate", () => {
  it("moves legacy config and state into .agents/unity", async () => {
    const { root } = await createTempProject();
    const legacyConfig = legacyConfigPath("project", root);
    const legacyState = legacyStatePath("project", root);
    await fs.mkdir(path.dirname(legacyConfig), { recursive: true });
    await fs.writeFile(legacyConfig, '{"version":1,"targets":{},"projects":[]}\n', "utf8");
    await fs.writeFile(legacyState, '{"version":1,"targets":{}}\n', "utf8");

    const results = await migrateScope("project", root);

    expect(results.items.filter((item) => item.action === "moved").map((item) => item.label)).toEqual(
      expect.arrayContaining(["config.json", "state.json"])
    );
    await expect(exists(configPath("project", root))).resolves.toBe(true);
    await expect(exists(statePath("project", root))).resolves.toBe(true);
    await expect(exists(legacyConfig)).resolves.toBe(false);
    await expect(exists(legacyState)).resolves.toBe(false);
  });

  it("merges legacy logs into .agents/unity/logs", async () => {
    const { root, home } = await createTempProject();
    const legacy = legacyLogDir(root);
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, "unity-2020-01-01.log"), "old entry\n", "utf8");
    await fs.mkdir(logDir(root), { recursive: true });
    await fs.writeFile(path.join(logDir(root), "unity-2020-01-02.log"), "new entry\n", "utf8");

    await migrateScope("user", root);

    await expect(readText(path.join(home, ".agents", "unity", "logs", "unity-2020-01-01.log"))).resolves.toBe(
      "old entry\n"
    );
    await expect(readText(path.join(home, ".agents", "unity", "logs", "unity-2020-01-02.log"))).resolves.toBe(
      "new entry\n"
    );
    await expect(exists(legacy)).resolves.toBe(true);
  });

  it("removes identical legacy config with --remove-legacy", async () => {
    const { root } = await createTempProject();
    const legacy = legacyConfigPath("user", root);
    const canonical = configPath("user", root);
    const body = '{"version":1,"targets":{},"projects":[]}\n';
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, body, "utf8");
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, body, "utf8");

    await migrateScope("user", root, { removeLegacy: true });

    await expect(exists(canonical)).resolves.toBe(true);
    await expect(exists(legacy)).resolves.toBe(false);
  });

  it("dry-run does not move files", async () => {
    const { root } = await createTempProject();
    const legacy = legacyConfigPath("project", root);
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, '{"version":1,"targets":{},"projects":[]}\n', "utf8");

    await migrateLayout("project", root, { dryRun: true });

    await expect(exists(legacy)).resolves.toBe(true);
    await expect(exists(configPath("project", root))).resolves.toBe(false);
  });
});
