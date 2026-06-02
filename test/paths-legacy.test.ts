import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureScope, loadConfig, saveConfig } from "../src/config.js";
import {
  configPath,
  legacyConfigPath,
  legacyLogDir,
  legacyStatePath,
  logDir,
  resetUnityLayoutWarnings,
  statePath
} from "../src/paths.js";
import { loadState, saveState } from "../src/state.js";
import { createTempProject, exists } from "./helpers.js";

describe("legacy unity data paths", () => {
  afterEach(() => {
    resetUnityLayoutWarnings();
    vi.restoreAllMocks();
  });

  it("reads config from legacy location and writes to unity directory", async () => {
    const { root, home } = await createTempProject();
    const legacy = legacyConfigPath("user", root);
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(
      legacy,
      JSON.stringify({
        version: 1,
        targets: {},
        projects: ["/tmp/legacy-project"]
      }),
      "utf8"
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = await loadConfig("user", root);

    expect(config.projects).toEqual(["/tmp/legacy-project"]);
    expect(warn.mock.calls.some(([message]) => String(message).includes("legacy location"))).toBe(true);

    await saveConfig("user", config, root);
    await expect(exists(configPath("user", root))).resolves.toBe(true);
    await expect(exists(legacy)).resolves.toBe(true);
  });

  it("warns when both legacy and current config exist", async () => {
    const { root } = await createTempProject();
    await fs.mkdir(path.dirname(legacyConfigPath("user", root)), { recursive: true });
    await fs.writeFile(legacyConfigPath("user", root), '{"version":1,"targets":{},"projects":["legacy"]}\n', "utf8");
    await fs.mkdir(path.dirname(configPath("user", root)), { recursive: true });
    await fs.writeFile(configPath("user", root), '{"version":1,"targets":{},"projects":["canonical"]}\n', "utf8");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = await loadConfig("user", root);

    expect(config.projects).toEqual(["canonical"]);
    expect(warn.mock.calls.some(([message]) => String(message).includes("both legacy and current"))).toBe(true);
  });

  it("reads state from legacy path until saved under unity", async () => {
    const { root } = await createTempProject();
    const legacy = legacyStatePath("project", root);
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(
      legacy,
      JSON.stringify({
        version: 1,
        targets: {
          cursor: { targetPath: "/tmp/cursor", skills: { demo: { path: "/tmp/cursor/demo" } } }
        }
      }),
      "utf8"
    );

    const state = await loadState("project", root);
    expect(state.targets.cursor?.skills.demo).toBeDefined();

    await saveState("project", state, root);
    await expect(exists(statePath("project", root))).resolves.toBe(true);
  });

  it("creates new scopes under .agents/unity", async () => {
    const { root, home } = await createTempProject();
    await ensureScope("user", root);
    await ensureScope("project", root);

    await expect(exists(path.join(home, ".agents", "unity", "config.json"))).resolves.toBe(true);
    await expect(exists(path.join(root, ".agents", "unity", "config.json"))).resolves.toBe(true);
    await expect(exists(logDir(root))).resolves.toBe(true);
    await expect(exists(legacyLogDir(root))).resolves.toBe(false);
  });
});
