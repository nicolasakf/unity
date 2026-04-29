import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }

  if (!(await pathExists(root))) return files;
  await walk(root);
  return files.sort();
}

export async function hashFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function hashTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const relative of await listFiles(root)) {
    result[relative] = await hashFile(path.join(root, relative));
  }
  return result;
}

export function sameHashTree(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  if (!a || !b) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  for (const relative of await listFiles(source)) {
    const from = path.join(source, relative);
    const to = path.join(destination, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
}

export async function removeDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true });
}
