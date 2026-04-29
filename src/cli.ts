import fs from "node:fs/promises";
import { Command, InvalidArgumentError } from "commander";
import { ensureScope, loadConfig, saveConfig } from "./config.js";
import { expandScopes, resolveTargetPath, sourceDir } from "./paths.js";
import { getStatus } from "./status.js";
import { importSkills, pruneTarget, syncScope } from "./sync.js";
import type { Scope, ScopeInput, SyncResult, TargetConfig, UnityMessage } from "./types.js";
import { watchScopes } from "./watch.js";
import { listValidSkills } from "./skills.js";

const program = new Command();

program
  .name("unity")
  .description("Keep one Agent Skills source of truth mirrored into coding-agent skill directories.")
  .version("0.1.0");

program
  .command("init")
  .description("Create Unity source, config, and state directories.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .action(async (options: { scope: ScopeInput }) => {
    for (const scope of expandScopes(options.scope)) {
      await ensureScope(scope);
      log({ level: "info", message: `Initialized ${scope} scope at ${sourceDir(scope)}` });
    }
  });

program
  .command("sync")
  .description("Mirror Unity skills into enabled target directories.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--force", "overwrite conflicting target skills", false)
  .option("--dry-run", "preview changes without writing target directories or state", false)
  .action(async (options: { scope: ScopeInput; force: boolean; dryRun: boolean }) => {
    for (const scope of expandScopes(options.scope)) {
      printResult(await syncScope(scope, { force: options.force, dryRun: options.dryRun }), options.dryRun);
    }
  });

program
  .command("watch")
  .description("Run a foreground watcher that syncs after source skill changes.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .action(async (options: { scope: ScopeInput }) => {
    const scopes = expandScopes(options.scope);
    for (const scope of scopes) await ensureScope(scope);
    await watchScopes(scopes, process.cwd(), log);
  });

program
  .command("status")
  .description("Show source, target, and manifest status.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--verbose", "show source skills and managed skills per target", false)
  .action(async (options: { scope: ScopeInput; verbose: boolean }) => {
    for (const scope of expandScopes(options.scope)) {
      const status = await getStatus(scope);
      console.log(`${scope}`);
      console.log(`  source: ${status.source}`);
      console.log(`  valid skills: ${status.validSkills}`);
      console.log(`  invalid skills: ${status.invalidSkills}`);
      console.log(`  enabled targets: ${status.enabledTargets}`);
      console.log(`  managed target skills: ${status.managedSkills}`);
      if (options.verbose) {
        console.log(`  source skill names: ${status.skillNames.length ? status.skillNames.join(", ") : "(none)"}`);
        for (const validation of status.invalidSkillDetails) {
          if (!validation.ok) console.log(`  invalid: ${validation.directory} (${validation.reason})`);
        }
        for (const target of status.targets) {
          const state = target.enabled ? "enabled" : "disabled";
          const managed = target.managedSkills.length ? target.managedSkills.join(", ") : "(none)";
          console.log(`  target ${target.id}: ${state} -> ${target.path}`);
          console.log(`    managed: ${managed}`);
        }
      }
    }
  });

program
  .command("doctor")
  .description("Validate configured sources and target paths.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--fix", "create missing Unity source/config directories and enabled target directories", false)
  .action(async (options: { scope: ScopeInput; fix: boolean }) => {
    for (const scope of expandScopes(options.scope)) {
      if (options.fix) await ensureScope(scope);
      const config = await loadConfig(scope);
      const source = sourceDir(scope);
      const skills = await listValidSkills(source);
      console.log(`${scope}`);
      console.log(`  source: ${source}`);
      console.log(`  valid skills: ${skills.skills.length}`);
      for (const validation of skills.invalid) {
        if (!validation.ok) console.log(`  invalid: ${validation.directory} (${validation.reason})`);
      }
      for (const target of Object.values(config.targets)) {
        const targetPath = resolveTargetPath(scope === "user" ? target.userPath : target.projectPath, scope);
        const state = target.enabled[scope] ? "enabled" : "disabled";
        if (options.fix && target.enabled[scope]) await fs.mkdir(targetPath, { recursive: true });
        console.log(`  ${target.id}: ${state} -> ${targetPath}`);
      }
      if (options.fix) console.log("  fixed: ensured source/config and enabled target directories exist");
    }
  });

const targets = program.command("targets").description("Manage sync targets.");

targets
  .command("list")
  .description("List configured targets.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .action(async (options: { scope: ScopeInput }) => {
    for (const scope of expandScopes(options.scope)) {
      const config = await loadConfig(scope);
      console.log(`${scope}`);
      for (const target of Object.values(config.targets)) {
        const targetPath = resolveTargetPath(scope === "user" ? target.userPath : target.projectPath, scope);
        const state = target.enabled[scope] ? "enabled" : "disabled";
        const kind = target.builtIn ? "built-in" : "custom";
        console.log(`  ${target.id} (${kind}, ${state}) -> ${targetPath}`);
      }
    }
  });

targets
  .command("enable")
  .description("Enable a target for one or more scopes.")
  .argument("<agent>", "target id")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .action(async (agent: string, options: { scope: ScopeInput }) => {
    for (const scope of expandScopes(options.scope)) {
      await setTargetEnabled(scope, agent, true);
      log({ level: "info", message: `Enabled ${agent} for ${scope}` });
    }
  });

targets
  .command("disable")
  .description("Disable a target for one or more scopes.")
  .argument("<agent>", "target id")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--prune", "delete Unity-managed skills from the disabled target", false)
  .action(async (agent: string, options: { scope: ScopeInput; prune: boolean }) => {
    for (const scope of expandScopes(options.scope)) {
      await setTargetEnabled(scope, agent, false);
      log({ level: "info", message: `Disabled ${agent} for ${scope}` });
      if (options.prune) printResult(await pruneTarget(scope, agent));
    }
  });

targets
  .command("add")
  .description("Add a custom target with user and project paths.")
  .argument("<id>", "target id")
  .requiredOption("--user-path <path>", "user-level skills path")
  .requiredOption("--project-path <path>", "project-level skills path")
  .action(async (id: string, options: { userPath: string; projectPath: string }) => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      throw new InvalidArgumentError("target id must be lowercase alphanumeric with single hyphen separators");
    }

    for (const scope of expandScopes("all")) {
      await ensureScope(scope);
      const config = await loadConfig(scope);
      if (config.targets[id]) throw new Error(`Target "${id}" already exists in ${scope} config`);
      const target: TargetConfig = {
        id,
        userPath: options.userPath,
        projectPath: options.projectPath,
        enabled: { user: true, project: true },
        builtIn: false
      };
      config.targets[id] = target;
      await saveConfig(scope, config);
    }
    log({ level: "info", message: `Added custom target ${id}` });
  });

program
  .command("import")
  .description("Import existing skills from an agent target or arbitrary path into Unity source.")
  .requiredOption("--from <agent-or-path>", "built-in/custom target id or directory path")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--fix-names", "import folder/name mismatches by rewriting copied SKILL.md names to match folders", false)
  .option("--dry-run", "preview imports without writing Unity source files", false)
  .action(async (options: { from: string; scope: ScopeInput; fixNames: boolean; dryRun: boolean }) => {
    for (const scope of expandScopes(options.scope)) {
      printResult(
        await importSkills(options.from, scope, {
          fixNames: options.fixNames,
          dryRun: options.dryRun
        }),
        options.dryRun
      );
    }
  });

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code === "commander.helpDisplayed" || code === "commander.version") {
    process.exitCode = 0;
  } else if (error instanceof InvalidArgumentError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

function parseScope(value: string): ScopeInput {
  if (value === "user" || value === "project" || value === "all") return value;
  throw new InvalidArgumentError("scope must be user, project, or all");
}

async function setTargetEnabled(scope: Scope, targetId: string, enabled: boolean): Promise<void> {
  await ensureScope(scope);
  const config = await loadConfig(scope);
  const target = config.targets[targetId];
  if (!target) throw new Error(`Unknown target "${targetId}"`);
  target.enabled[scope] = enabled;
  await saveConfig(scope, config);
}

function printResult(result: SyncResult, dryRun = false): void {
  const prefix = dryRun ? "dry-run " : "";
  console.log(`${result.scope}: ${prefix}copied ${result.copied}, removed ${result.removed}, skipped ${result.skipped}, errors ${result.errors}`);
  result.messages.forEach(log);
}

function log(message: UnityMessage): void {
  const prefix = message.level === "error" ? "error" : message.level === "warning" ? "warning" : "info";
  const writer = message.level === "error" ? console.error : console.log;
  writer(`${prefix}: ${message.message}`);
}
