import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateSkill } from "../src/skills.js";
import { createTempProject, writeSkill } from "./helpers.js";

describe("skill validation", () => {
  it("accepts a valid Agent Skill", async () => {
    const { root } = await createTempProject();
    const directory = await writeSkill(path.join(root, ".agents", "skills"), "code-review");

    const validation = await validateSkill(directory);

    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.skill.name).toBe("code-review");
    }
  });

  it("requires the frontmatter name to match the folder", async () => {
    const { root } = await createTempProject();
    const directory = path.join(root, ".agents", "skills", "folder-name");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "SKILL.md"),
      "---\nname: other-name\ndescription: Mismatch test.\n---\n",
      "utf8"
    );

    const validation = await validateSkill(directory);

    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reason).toContain("must match directory");
  });

  it("rejects invalid skill names", async () => {
    const { root } = await createTempProject();
    const directory = path.join(root, ".agents", "skills", "BadName");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "SKILL.md"),
      "---\nname: BadName\ndescription: Invalid name test.\n---\n",
      "utf8"
    );

    const validation = await validateSkill(directory);

    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reason).toContain("lowercase");
  });
});
