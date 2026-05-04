import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempProject(): Promise<{ root: string; home: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unity-project-"));
  const home = path.join(root, "home");
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.mkdir(home, { recursive: true });
  process.env.HOME = home;
  return { root, home };
}

export async function writeSkill(parent: string, name: string, body = "Follow the instructions."): Promise<string> {
  const directory = path.join(parent, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill for tests.\n---\n\n${body}\n`,
    "utf8"
  );
  return directory;
}

export async function writeRule(parent: string, name: string, body = "Follow the rules."): Promise<string> {
  const filePath = path.join(parent, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
  return filePath;
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
