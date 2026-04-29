import fs from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./file-tree.js";
import type { InvalidSkillValidation, SkillMetadata, SkillValidation } from "./types.js";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type LooseSkillMetadata = {
  directory: string;
  folderName: string;
  name?: string;
  description?: string;
};

export type NameMismatchRepair = {
  directory: string;
  currentName: string;
  fixedName: string;
  description: string;
};

export async function validateSkill(directory: string): Promise<SkillValidation> {
  const skillFile = path.join(directory, "SKILL.md");
  if (!(await pathExists(skillFile))) {
    return { ok: false, directory, reason: "missing SKILL.md" };
  }

  const raw = await fs.readFile(skillFile, "utf8");
  const frontmatter = parseFrontmatter(raw);
  if (!frontmatter) {
    return { ok: false, directory, reason: "SKILL.md must start with YAML frontmatter" };
  }

  const name = readStringField(frontmatter, "name");
  const description = readStringField(frontmatter, "description");
  const folderName = path.basename(directory);

  if (!name) return { ok: false, directory, reason: "frontmatter is missing name" };
  if (!description) return { ok: false, directory, reason: "frontmatter is missing description" };
  if (name.length > 64) return { ok: false, directory, reason: "name must be 64 characters or fewer" };
  if (!isValidSkillName(name)) {
    return { ok: false, directory, reason: "name must be lowercase alphanumeric with single hyphen separators" };
  }
  if (name !== folderName) {
    return { ok: false, directory, reason: `name "${name}" must match directory "${folderName}"` };
  }
  if (description.length > 1024) {
    return { ok: false, directory, reason: "description must be 1024 characters or fewer" };
  }

  return {
    ok: true,
    skill: {
      name,
      description,
      directory
    }
  };
}

export async function readLooseSkillMetadata(directory: string): Promise<LooseSkillMetadata | undefined> {
  const skillFile = path.join(directory, "SKILL.md");
  if (!(await pathExists(skillFile))) return undefined;

  const raw = await fs.readFile(skillFile, "utf8");
  const frontmatter = parseFrontmatter(raw);
  if (!frontmatter) return undefined;

  return {
    directory,
    folderName: path.basename(directory),
    name: readStringField(frontmatter, "name"),
    description: readStringField(frontmatter, "description")
  };
}

export async function getNameMismatchRepair(directory: string): Promise<NameMismatchRepair | undefined> {
  const metadata = await readLooseSkillMetadata(directory);
  if (!metadata?.name || !metadata.description) return undefined;
  if (metadata.name === metadata.folderName) return undefined;
  if (!isValidSkillName(metadata.folderName)) return undefined;
  if (metadata.description.length > 1024) return undefined;

  return {
    directory,
    currentName: metadata.name,
    fixedName: metadata.folderName,
    description: metadata.description
  };
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name);
}

export async function listValidSkills(source: string): Promise<{ skills: SkillMetadata[]; invalid: InvalidSkillValidation[] }> {
  if (!(await pathExists(source))) return { skills: [], invalid: [] };

  const entries = await fs.readdir(source, { withFileTypes: true });
  const validations = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => validateSkill(path.join(source, entry.name)))
  );

  return {
    skills: validations.flatMap((validation) => (validation.ok ? [validation.skill] : [])),
    invalid: validations.filter(isInvalidSkill)
  };
}

function isInvalidSkill(validation: SkillValidation): validation is InvalidSkillValidation {
  return !validation.ok;
}

function parseFrontmatter(raw: string): string | undefined {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return undefined;
  const normalized = raw.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return undefined;
  return normalized.slice(4, end).trim();
}

function readStringField(frontmatter: string, field: string): string | undefined {
  const pattern = new RegExp(`^${field}:\\s*(.*)$`, "m");
  const match = frontmatter.match(pattern);
  if (!match) return undefined;
  const value = match[1].trim();
  if (!value) return undefined;
  return stripQuotes(value);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
