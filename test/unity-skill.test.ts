import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureScope } from "../src/config.js";
import { ensureUnitySkill } from "../src/unity-skill.js";
import { createTempProject, exists, readText } from "./helpers.js";

describe("unity skill", () => {
  it("creates a user-level skill with the README content", async () => {
    const { root, home } = await createTempProject();
    await ensureScope("user", root);

    const result = await ensureUnitySkill(root);

    expect(result).toBe("created");
    const skillPath = path.join(home, ".agents", "skills", "unity-skill", "SKILL.md");
    await expect(exists(skillPath)).resolves.toBe(true);
    await expect(readText(skillPath)).resolves.toContain("# Unity");

    await expect(ensureUnitySkill(root)).resolves.toBe("exists");
  });
});
