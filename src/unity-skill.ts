import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceDir } from "./paths.js";
import { pathExists } from "./file-tree.js";

const SKILL_NAME = "unity-skill";

export async function ensureUnitySkill(cwd = process.cwd()): Promise<"created" | "exists"> {
  const skillDir = path.join(sourceDir("user", cwd), SKILL_NAME);
  if (await pathExists(skillDir)) return "exists";

  await fs.mkdir(skillDir, { recursive: true });
  const readme = await readPackageReadme();
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${SKILL_NAME}\ndescription: Explains how to use Unity to keep Agent Skills synchronized across coding agents.\n---\n\n${readme}`,
    "utf8"
  );
  return "created";
}

async function readPackageReadme(): Promise<string> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return fs.readFile(path.join(packageRoot, "README.md"), "utf8");
}
