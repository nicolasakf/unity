import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError } from "commander";
import { appendLogEntry, clearLog, dailyLogPath, ensureLogDir, openLogDir, readLogTail } from "./action-log.js";
import type { LogCategory } from "./action-log.js";
import { addRegisteredProject, ensureScope, listRegisteredProjects, loadConfig, removeRegisteredProject, saveConfig } from "./config.js";
import { buildEnvPushPlan, pushEnvFiles } from "./env.js";
import { formatMigrateResults, migrateLayout } from "./migrate.js";
import { configExists, expandScopes, logDir, resolveTargetPath, rulesSourceDir, sourceDir } from "./paths.js";
import { getStatus } from "./status.js";
import { pruneTarget, pullScope, pushScope, syncScope } from "./sync.js";
import type { Scope, ScopeInput, SyncResult, TargetConfig, UnityConfig, UnityMessage } from "./types.js";
import { watchGlobal, watchScopes } from "./watch.js";
import { listValidSkills } from "./skills.js";
import { ensureUnitySkill } from "./unity-skill.js";
import { claimWatcher, getWatcherState, releaseWatcher, stopExistingWatcher } from "./watch-state.js";
import { readLineWithEscape } from "./init-prompt.js";

function targetsListUseColor(): boolean {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function gray(text: string): string {
  return targetsListUseColor() ? `\x1b[90m${text}\x1b[0m` : text;
}

function printTargetsListBlock(scope: Scope, config: UnityConfig): void {
  const targets = Object.values(config.targets).sort((a, b) => a.id.localeCompare(b.id));
  const enabledList = targets.filter((t) => t.enabled[scope]);
  const disabledList = targets.filter((t) => !t.enabled[scope]);

  console.log(`${scope}`);
  console.log("    enabled");
  for (const target of enabledList) {
    const targetPath = resolveTargetPath(scope === "user" ? target.userPath : target.projectPath, scope);
    const kind = target.builtIn ? "built-in" : "custom";
    console.log(`        ${target.id} (${kind}) -> ${targetPath}`);
  }
  console.log(gray("    disabled"));
  for (const target of disabledList) {
    const targetPath = resolveTargetPath(scope === "user" ? target.userPath : target.projectPath, scope);
    const kind = target.builtIn ? "built-in" : "custom";
    console.log(gray(`        ${target.id} (${kind}) -> ${targetPath}`));
  }
}

const program = new Command();

type InitMode =
  | { interactive: true }
  | {
      interactive: false;
      targetsCsv: string | undefined;
      projectsCsv: string | undefined;
    };

program
  .name("unity")
  .description("Keep one Agent Skills source of truth mirrored into coding-agent skill directories.")
  .version("0.1.0");

program.hook("preAction", async () => {
  await ensureLogDir();
  await appendLogEntry("info", "command", `$ ${process.argv.slice(2).join(" ") || "help"}`);
});

program.hook("postAction", async () => {
  await appendLogEntry("info", "command", "completed");
});

program
  .command("init")
  .description("Create Unity user source, config, and state directories.")
  .option("--non-interactive", "skip prompts (for scripts and agents); use --targets/--projects or UNITY_INIT_* env")
  .option("--targets <ids>", "comma-separated built-in target ids to enable for user scope (non-interactive)")
  .option("--projects <paths>", "comma-separated project roots to register for the watcher (non-interactive)")
  .action(
    async (options: {
      nonInteractive?: boolean;
      targets?: string;
      projects?: string;
    }) => {
      const firstInit = !(await configExists("user"));
      await ensureScope("user");
      if (firstInit) {
        const mode = resolveInitMode(options);
        await configureTargets("user", mode);
        await configureInitProjects(mode);
      }
      log({ level: "info", message: `Initialized user scope at ${sourceDir("user")}` }, "config");
      const skillState = await ensureUnitySkill();
      log({
        level: "info",
        message: `${skillState === "created" ? "Created" : "Found"} user unity-skill at ${sourceDir("user")}/unity-skill`
      }, "config");
      printResult(await pushScope("user"));
    }
  );

program
  .command("sync")
  .description("Pull new target skills into Unity, then push Unity skills into enabled target directories.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--force", "overwrite conflicting target skills during push", false)
  .option("--dry-run", "preview changes without writing Unity source files, target directories, or state", false)
  .action(async (options: { scope: ScopeInput; force: boolean; dryRun: boolean }) => {
    await syncScopes(options);
  });

program
  .command("push")
  .description("Push Unity source skills into enabled target directories.")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--force", "overwrite conflicting target skills", false)
  .option("--dry-run", "preview changes without writing target directories or state", false)
  .action(async (options: { scope: ScopeInput; force: boolean; dryRun: boolean }) => {
    await pushScopes(options);
  });

program
  .command("pull")
  .description("Pull new skills from enabled target directories, a target id, or a path into the Unity source.")
  .option("--from <agent-or-path>", "built-in/custom target id or directory path")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--fix-names", "pull folder/name mismatches by rewriting copied SKILL.md names to match folders", false)
  .option("--dry-run", "preview pulls without writing Unity source files", false)
  .action(async (options: { from?: string; scope: ScopeInput; fixNames: boolean; dryRun: boolean }) => {
    for (const scope of expandScopes(options.scope)) {
      printResult(
        await pullScope(scope, {
          from: options.from,
          fixNames: options.fixNames,
          dryRun: options.dryRun
        }),
        options.dryRun
      );
    }
  });

const env = program.command("env").description("Manage repository environment files.");

env
  .command("push")
  .description("Push root .env files from the current repo to configured target worktrees.")
  .option("--to <ids>", "comma-separated target ids to receive env files")
  .option("--dry-run", "preview destination paths without writing files", false)
  .option("-y, --yes", "skip the confirmation prompt", false)
  .action(async (options: { to?: string; dryRun: boolean; yes: boolean }) => {
    const plan = await buildEnvPushPlan({ to: parseCommaList(options.to) });
    if (!plan.envFiles.length) {
      console.log(`No .env files found in ${plan.repoRoot}.`);
      return;
    }

    if (!plan.destinations.length) {
      console.log("No existing target worktrees found for .env push.");
      plan.messages.forEach((message) => log(message, "env"));
      return;
    }

    if (options.dryRun) {
      console.log("Would push .env files to these paths:");
      printEnvDestinationPaths(plan.destinations.map((destination) => destination.destinationPath));
      printResult(await pushEnvFiles(plan, true), true);
      return;
    }

    if (!options.yes) {
      console.log("do you want to push .env files to these paths?");
      printEnvDestinationPaths(plan.destinations.map((destination) => destination.destinationPath));
      if (!(await confirm("Continue? [y/N] "))) {
        console.log("Canceled.");
        return;
      }
    }

    printResult(await pushEnvFiles(plan), false);
  });

program
  .command("watch")
  .description("Run a background watcher that syncs after skill changes.")
  .option("--scope <scope>", "global, user, project, or all", parseWatchScope, "global")
  .option("--pull", "also watch enabled target directories and pull new target skills before syncing", false)
  .option("--fix-names", "when used with --pull, repair folder/name mismatches in pulled skills", false)
  .option("--foreground", "run watcher in the current terminal", false)
  .action(async (options: { scope: WatchScopeInput; pull: boolean; fixNames: boolean; foreground: boolean }) => {
    if (options.foreground) {
      await runWatcher(options);
      return;
    }

    await stopExistingWatcher();
    const child = spawn(process.execPath, [process.argv[1], "watch-run", ...watchArgs(options)], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: process.env
    });
    child.unref();
    await waitForBackgroundWatcher(child.pid);
    logOutput(`Started Unity watcher in background (pid ${child.pid}).`, "watcher");
  });

program
  .command("watch-run", { hidden: true })
  .description("Internal foreground watcher process.")
  .option("--scope <scope>", "global, user, project, or all", parseWatchScope, "global")
  .option("--pull", "also watch enabled target directories and pull new target skills before syncing", false)
  .option("--fix-names", "when used with --pull, repair folder/name mismatches in pulled skills", false)
  .action(runWatcher);

program
  .command("watch-status")
  .description("Show the currently registered Unity watcher, if any.")
  .action(async () => {
    const state = await getWatcherState();
    if (!state) {
      console.log("No Unity watcher is running.");
      return;
    }
    console.log(`pid: ${state.pid}`);
    console.log(`scope: ${state.scope}`);
    console.log(`pull: ${state.pull}`);
    console.log(`fix names: ${state.fixNames}`);
    console.log(`cwd: ${state.cwd}`);
    console.log(`started: ${state.startedAt}`);
  });

program
  .command("stop")
  .description("Stop the Unity watcher if one is registered in ~/.agents/unity/watch.json.")
  .action(async () => {
    const state = await getWatcherState();
    if (!state) {
      console.log("No Unity watcher is running.");
      return;
    }
    const pid = state.pid;
    await stopExistingWatcher();
    await getWatcherState();
    logOutput(`Stopped Unity watcher (pid ${pid}).`, "watcher");
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
      console.log(`  source rules: ${status.sourceRules}`);
      console.log(`  enabled targets: ${status.enabledTargets}`);
      console.log(`  managed target skills: ${status.managedSkills}`);
      console.log(`  managed target rules: ${status.managedRules}`);
      if (options.verbose) {
        console.log(`  source skill names: ${status.skillNames.length ? status.skillNames.join(", ") : "(none)"}`);
        console.log(`  source rule names: ${status.ruleNames.length ? status.ruleNames.join(", ") : "(none)"}`);
        for (const validation of status.invalidSkillDetails) {
          if (!validation.ok) console.log(`  invalid: ${validation.directory} (${validation.reason})`);
        }
        for (const target of status.targets) {
          const state = target.enabled ? "enabled" : "disabled";
          const managed = target.managedSkills.length ? target.managedSkills.join(", ") : "(none)";
          const managedRules = target.managedRules.length ? target.managedRules.join(", ") : "(none)";
          console.log(`  target ${target.id}: ${state} -> ${target.path}`);
          console.log(`    managed: ${managed}`);
          console.log(`    managed rules: ${managedRules}`);
        }
      }
    }
  });

program
  .command("migrate")
  .description("Move Unity metadata from .agents/* into .agents/unity (config, state, locks, logs).")
  .option("--scope <scope>", "user, project, or all", parseScope, "all")
  .option("--dry-run", "preview moves without changing files", false)
  .option("--force", "when legacy and canonical files differ, replace canonical with legacy", false)
  .option("--remove-legacy", "delete legacy copies after migration (including identical duplicates)", false)
  .action(async (options: { scope: ScopeInput; dryRun: boolean; force: boolean; removeLegacy: boolean }) => {
    const results = await migrateLayout(options.scope, process.cwd(), {
      dryRun: options.dryRun,
      force: options.force,
      removeLegacy: options.removeLegacy
    });
    const lines = formatMigrateResults(results);
    if (!lines.length) {
      logOutput("Nothing to migrate.");
      return;
    }
    for (const line of lines) logOutput(line, "config");
    const changed = results.some((result) => result.items.some((item) => item.action !== "unchanged"));
    if (!changed) return;
    if (options.dryRun) {
      logOutput("Dry run only. Re-run without --dry-run to apply.");
      return;
    }
    logOutput("Migration complete. Unity now uses .agents/unity for metadata.");
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
      const rulesSource = rulesSourceDir(scope);
      const skills = await listValidSkills(source);
      console.log(`${scope}`);
      console.log(`  source: ${source}`);
      console.log(`  rules source: ${rulesSource}`);
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
      printTargetsListBlock(scope, config);
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
      log({ level: "info", message: `Enabled ${agent} for ${scope}` }, "config");
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
      log({ level: "info", message: `Disabled ${agent} for ${scope}` }, "config");
      if (options.prune) printResult(await pruneTarget(scope, agent));
    }
  });

targets
  .command("add")
  .description("Add a custom target with user and project paths.")
  .argument("<id>", "target id")
  .requiredOption("--user-path <path>", "user-level skills path")
  .requiredOption("--project-path <path>", "project-level skills path")
  .option("--user-rule <source=target>", "user-level rule mapping; may be repeated", collect, [])
  .option("--project-rule <source=target>", "project-level rule mapping; may be repeated", collect, [])
  .action(async (id: string, options: { userPath: string; projectPath: string; userRule: string[]; projectRule: string[] }) => {
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
        userRules: parseRuleMappings(options.userRule),
        projectRules: parseRuleMappings(options.projectRule),
        enabled: { user: true, project: true },
        builtIn: false
      };
      config.targets[id] = target;
      await saveConfig(scope, config);
    }
    log({ level: "info", message: `Added custom target ${id}` }, "config");
  });

const projects = program.command("projects").description("Manage projects watched by the global watcher.");

projects
  .command("list")
  .description("List project roots watched by `unity watch`.")
  .action(async () => {
    const registered = await listRegisteredProjects();
    if (!registered.length) {
      console.log("(none)");
      return;
    }
    for (const project of registered) console.log(project);
  });

projects
  .command("add")
  .description("Add a project root to the global watcher.")
  .argument("[path]", "project path", ".")
  .action(async (projectPath: string) => {
    const projectRoot = await addRegisteredProject(projectPath);
    log({ level: "info", message: `Watching project ${projectRoot}` }, "config");
  });

projects
  .command("remove")
  .description("Remove a project root from the global watcher.")
  .argument("[path]", "project path", ".")
  .action(async (projectPath: string) => {
    const projectRoot = await removeRegisteredProject(projectPath);
    if (projectRoot) {
      log({ level: "info", message: `Stopped watching project ${projectRoot}` }, "config");
    } else {
      log({ level: "warning", message: "Project was not registered" }, "config");
    }
  });

program
  .command("log")
  .description("Show Unity action logs or open the log directory.")
  .option("--open", "open the log directory in the file manager")
  .option("--path", "print the log directory path")
  .option("--date <YYYY-MM-DD>", "show logs for a specific day")
  .option("-n, --lines <count>", "number of log lines to show", parsePositiveInt, 50)
  .option("--clear", "clear the log file for the selected day")
  .action(async (options: { open?: boolean; path?: boolean; date?: string; lines: number; clear?: boolean }) => {
    await ensureLogDir();

    if (options.path) {
      console.log(logDir());
      return;
    }

    if (options.open) {
      const dir = await openLogDir();
      log({ level: "info", message: `Opened log directory ${dir}` }, "command");
      return;
    }

    const filePath = options.date ? dailyLogPath(new Date(`${options.date}T12:00:00.000Z`)) : undefined;

    if (options.clear) {
      const cleared = await clearLog(options.date ? new Date(`${options.date}T12:00:00.000Z`) : new Date());
      log({ level: "info", message: `Cleared log ${cleared}` }, "command");
      console.log(`Cleared ${cleared}`);
      return;
    }

    const content = await readLogTail(options.lines, filePath);
    if (!content) {
      console.log(`No log entries yet. Logs are written to ${logDir()}`);
      return;
    }

    console.log(content);
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
    void appendLogEntry("error", "command", error.message);
    process.exitCode = 1;
  } else {
    const message = (error as Error).message;
    console.error(message);
    void appendLogEntry("error", "command", message);
    process.exitCode = 1;
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new InvalidArgumentError("lines must be a positive integer");
  }
  return parsed;
}

function parseScope(value: string): ScopeInput {
  if (value === "user" || value === "project" || value === "all") return value;
  throw new InvalidArgumentError("scope must be user, project, or all");
}

function resolveInitMode(options: { nonInteractive?: boolean; targets?: string; projects?: string }): InitMode {
  const forceNonInteractive =
    Boolean(options.nonInteractive) ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.env.UNITY_INIT_NON_INTERACTIVE === "1";

  if (forceNonInteractive) {
    return {
      interactive: false,
      targetsCsv: options.targets ?? process.env.UNITY_INIT_TARGETS,
      projectsCsv: options.projects ?? process.env.UNITY_INIT_PROJECTS
    };
  }
  return { interactive: true };
}

function parseCommaList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function printEnvDestinationPaths(paths: string[]): void {
  for (const destinationPath of paths) console.log(`  ${destinationPath}`);
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Confirmation required. Re-run in an interactive terminal or pass --yes.");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseRuleMappings(values: string[]) {
  return values.map((value) => {
    const index = value.indexOf("=");
    if (index <= 0 || index === value.length - 1) {
      throw new InvalidArgumentError("rule mappings must use source=target");
    }
    return {
      source: value.slice(0, index),
      target: value.slice(index + 1)
    };
  });
}

async function configureTargets(scope: Scope, mode: InitMode): Promise<void> {
  const config = await loadConfig(scope);
  const targets = Object.values(config.targets).filter((target) => target.builtIn);

  if (!mode.interactive) {
    const enabled = new Set(parseCommaList(mode.targetsCsv).map((id) => id.toLowerCase()));
    const known = new Set(targets.map((target) => target.id));
    for (const id of enabled) {
      if (!known.has(id)) console.log(`warning: unknown target "${id}"`);
    }
    for (const target of targets) {
      const on = enabled.has(target.id);
      target.enabled.user = on;
      target.enabled.project = on;
    }
    await saveConfig(scope, config);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log("Choose targets to mirror into coding agents at user scope and registered project repos.");
  console.log(`Available: ${targets.map((target) => target.id).join(", ")}`);
  console.log("Enter target ids separated by commas. Press Enter for none.");

  try {
    const answer = await rl.question("Enable targets: ");
    const enabled = new Set(answer.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
    const known = new Set(targets.map((target) => target.id));
    for (const id of enabled) {
      if (!known.has(id)) console.log(`warning: unknown target "${id}"`);
    }
    for (const target of targets) {
      const on = enabled.has(target.id);
      target.enabled.user = on;
      target.enabled.project = on;
    }
  } finally {
    rl.close();
  }

  await saveConfig(scope, config);
}

async function configureInitProjects(mode: InitMode): Promise<void> {
  if (!mode.interactive) {
    for (const input of parseCommaList(mode.projectsCsv)) {
      try {
        const root = await addRegisteredProject(input);
        log({ level: "info", message: `Registered project ${root}` }, "config");
      } catch (error) {
        log({ level: "warning", message: (error as Error).message }, "config");
      }
    }
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  console.log("");
  console.log("Register project roots for `unity watch` (optional).");
  console.log(
    "Type each project path (repository root), then press Enter to add it. Press Enter on an empty line when you are done, or press Escape to stop adding projects."
  );

  while (true) {
    const result = await readLineWithEscape("Project path: ");
    if (result === null) break;
    if (result.trim() === "") break;
    try {
      const root = await addRegisteredProject(result.trim());
      log({ level: "info", message: `Registered project ${root}` }, "config");
    } catch (error) {
      log({ level: "warning", message: (error as Error).message }, "config");
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

type WatchScopeInput = ScopeInput | "global";

function parseWatchScope(value: string): WatchScopeInput {
  if (value === "global" || value === "user" || value === "project" || value === "all") return value;
  throw new InvalidArgumentError("scope must be global, user, project, or all");
}

function watchArgs(options: { scope: WatchScopeInput; pull: boolean; fixNames: boolean }): string[] {
  return [
    "--scope",
    options.scope,
    ...(options.pull ? ["--pull"] : []),
    ...(options.fixNames ? ["--fix-names"] : [])
  ];
}

async function runWatcher(options: { scope: WatchScopeInput; pull: boolean; fixNames: boolean }): Promise<void> {
  await claimWatcher({
    scope: options.scope,
    pull: options.pull,
    fixNames: options.fixNames,
    cwd: process.cwd()
  });
  try {
    if (options.scope === "global") {
      await ensureScope("user");
      await watchGlobal(process.cwd(), watchLog, { pull: options.pull, fixNames: options.fixNames });
    } else {
      const scopes = expandScopes(options.scope);
      for (const scope of scopes) await ensureScope(scope);
      await watchScopes(scopes, process.cwd(), watchLog, { pull: options.pull, fixNames: options.fixNames });
    }
  } finally {
    await releaseWatcher();
  }
}

async function waitForBackgroundWatcher(pid: number | undefined): Promise<void> {
  if (!pid) throw new Error("Failed to start Unity watcher process.");
  for (let index = 0; index < 20; index += 1) {
    const state = await getWatcherState();
    if (state?.pid === pid) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Unity watcher process ${pid} did not report ready state.`);
}

async function pushScopes(options: { scope: ScopeInput; force: boolean; dryRun: boolean }): Promise<void> {
  for (const scope of expandScopes(options.scope)) {
    printResult(await pushScope(scope, { force: options.force, dryRun: options.dryRun }), options.dryRun);
  }
}

async function syncScopes(options: { scope: ScopeInput; force: boolean; dryRun: boolean }): Promise<void> {
  for (const scope of expandScopes(options.scope)) {
    printResult(await syncScope(scope, { force: options.force, dryRun: options.dryRun }), options.dryRun);
  }
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
  const summary = `${result.scope}: ${prefix}copied ${result.copied}, removed ${result.removed}, skipped ${result.skipped}, errors ${result.errors}`;
  console.log(summary);
  void appendLogEntry("info", "sync", summary);
  result.messages.forEach((message) => log(message, "sync"));
}

function watchLog(message: UnityMessage): void {
  log(message, "watch");
}

function log(message: UnityMessage, category: LogCategory = "sync"): void {
  const prefix = message.level === "error" ? "error" : message.level === "warning" ? "warning" : "info";
  const writer = message.level === "error" ? console.error : console.log;
  writer(`${prefix}: ${message.message}`);
  void appendLogEntry(message.level, category, message.message);
}

function logOutput(message: string, category: LogCategory = "command"): void {
  console.log(message);
  void appendLogEntry("info", category, message);
}
