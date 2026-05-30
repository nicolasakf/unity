import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendLogEntry, clearLog, dailyLogPath, ensureLogDir, listLogFiles, readLogTail } from "../src/action-log.js";
import { ensureScope } from "../src/config.js";
import { logDir } from "../src/paths.js";
import { createTempProject, exists } from "./helpers.js";

describe("action log", () => {
  it("creates the user log directory during user scope init", async () => {
    const { root, home } = await createTempProject();

    await ensureScope("user", root);

    await expect(exists(path.join(home, ".agents", "logs"))).resolves.toBe(true);
    expect(logDir(root)).toBe(path.join(home, ".agents", "logs"));
  });

  it("writes and reads daily log entries", async () => {
    const { root } = await createTempProject();
    await ensureLogDir(root);

    await appendLogEntry("info", "command", "unity sync --scope all", root);
    await appendLogEntry("info", "sync", "user: copied 1, removed 0, skipped 0, errors 0", root);

    const content = await readLogTail(10, undefined, root);
    expect(content).toContain("command  unity sync --scope all");
    expect(content).toContain("sync     user: copied 1, removed 0, skipped 0, errors 0");

    const files = await listLogFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(dailyLogPath(new Date(), root));
  });

  it("clears a daily log file", async () => {
    const { root } = await createTempProject();
    await ensureLogDir(root);
    await appendLogEntry("info", "command", "temporary entry", root);

    const cleared = await clearLog(new Date(), root);
    expect(cleared).toBe(dailyLogPath(new Date(), root));
    await expect(readLogTail(10, cleared, root)).resolves.toBe("");
  });
});
