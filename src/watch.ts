import chokidar from "chokidar";
import path from "node:path";
import { enabledTargets, listRegisteredProjects, loadConfig } from "./config.js";
import { configPath, isPathWithin, pathsEqual, resolveTargetPath, rulesSourceDir, sourceDir } from "./paths.js";
import { pullScope, pushScope } from "./sync.js";
import type { Scope, TargetConfig, UnityMessage } from "./types.js";

export type WatchOptions = {
  pull?: boolean;
  fixNames?: boolean;
};

export type WatchTarget = {
  scope: Scope;
  cwd: string;
};

export async function watchScopes(
  scopes: Scope[],
  cwd = process.cwd(),
  onMessage: (message: UnityMessage) => void,
  options: WatchOptions = {}
): Promise<void> {
  await watchTargets(scopes.map((scope) => ({ scope, cwd })), onMessage, options);
}

export async function watchTargets(
  initialTargets: WatchTarget[],
  onMessage: (message: UnityMessage) => void,
  options: WatchOptions = {}
): Promise<void> {
  await watchTargetSet(initialTargets, [], onMessage, options);
}

export async function watchGlobal(
  cwd = process.cwd(),
  onMessage: (message: UnityMessage) => void,
  options: WatchOptions = {}
): Promise<void> {
  const userConfigPath = configPath("user", cwd);
  await watchTargetSet(await globalTargets(cwd), [userConfigPath], onMessage, options, {
    reloadTargets: () => globalTargets(cwd),
    reloadPath: userConfigPath
  });
}

async function watchTargetSet(
  initialTargets: WatchTarget[],
  extraPaths: string[],
  onMessage: (message: UnityMessage) => void,
  options: WatchOptions,
  dynamic?: {
    reloadPath: string;
    reloadTargets: () => Promise<WatchTarget[]>;
  }
): Promise<void> {
  let targets = initialTargets;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;
  let reloadRequested = false;
  const sourceDeletes = new Set<string>();
  const changedPaths = new Set<string>();
  const run = (eventPath?: string, deleted = false) => {
    if (eventPath) changedPaths.add(eventPath);
    if (dynamic && eventPath && pathsEqual(eventPath, dynamic.reloadPath)) {
      reloadRequested = true;
    }
    if (deleted && eventPath) {
      for (const target of targets) {
        if (
          isPathWithin(sourceDir(target.scope, target.cwd), eventPath) ||
          isPathWithin(rulesSourceDir(target.scope, target.cwd), eventPath)
        ) {
          sourceDeletes.add(targetKey(target));
        }
      }
    }
    clearTimeout(timer);
    timer = setTimeout(execute, 150);
  };

  const paths = [...(await watchedPaths(targets, options)), ...extraPaths];
  let activePaths = new Set(paths);
  const watcher = chokidar.watch(paths, {
    ignoreInitial: true,
    persistent: true
  });

  watcher.on("add", (eventPath) => run(eventPath));
  watcher.on("change", (eventPath) => run(eventPath));
  watcher.on("unlink", (eventPath) => run(eventPath, true));
  watcher.on("addDir", (eventPath) => run(eventPath));
  watcher.on("unlinkDir", (eventPath) => run(eventPath, true));
  watcher.on("error", (error) => onMessage({ level: "error", message: String(error) }));

  onMessage({ level: "info", message: `Watching ${paths.join(", ")}` });

  let resolveShutdown!: () => void;
  const shutdownPromise = new Promise<void>((resolve) => { resolveShutdown = resolve; });
  const shutdown = async () => {
    await watcher.close();
    resolveShutdown();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await execute();
  await shutdownPromise;

  async function execute(): Promise<void> {
    if (running) {
      pending = true;
      return;
    }

    running = true;
    try {
      do {
        pending = false;
        const eventPaths = [...changedPaths];
        changedPaths.clear();
        if (eventPaths.length) {
          onMessage({ level: "info", message: `Changed: ${eventPaths.join(", ")}` });
        }
        if (dynamic && reloadRequested) {
          reloadRequested = false;
          targets = await dynamic.reloadTargets();
          const nextPaths = new Set([...(await watchedPaths(targets, options)), ...extraPaths]);
          const added = [...nextPaths].filter((watchedPath) => !activePaths.has(watchedPath));
          const removed = [...activePaths].filter((watchedPath) => !nextPaths.has(watchedPath));
          if (added.length) watcher.add(added);
          if (removed.length) watcher.unwatch(removed);
          activePaths = nextPaths;
          onMessage({ level: "info", message: `Reloaded project registry (${targets.length - 1} projects)` });
        }
        for (const target of targets) {
          const sourceDeleted = sourceDeletes.has(targetKey(target));
          if (options.pull && !sourceDeleted) {
            const changedTargetIds = await changedTargetIdsForEventPaths(target, eventPaths);
            if (changedTargetIds.length) {
              for (const from of changedTargetIds) {
                const pullResult = await pullScope(target.scope, {
                  cwd: target.cwd,
                  from,
                  fixNames: options.fixNames,
                  updateExisting: true
                });
                onMessage({
                  level: "info",
                  message: `${targetLabel(target)}: pulled ${pullResult.copied}, skipped ${pullResult.skipped}, errors ${pullResult.errors}`
                });
                pullResult.messages.forEach(onMessage);
              }
            } else if (!eventPaths.length) {
              const pullResult = await pullScope(target.scope, { cwd: target.cwd, fixNames: options.fixNames });
              onMessage({
                level: "info",
                message: `${targetLabel(target)}: pulled ${pullResult.copied}, skipped ${pullResult.skipped}, errors ${pullResult.errors}`
              });
              pullResult.messages.forEach(onMessage);
            }
          } else if (options.pull && sourceDeleted) {
            onMessage({ level: "info", message: `${targetLabel(target)}: skipped pull because source deletion was detected` });
          }

          const result = await pushScope(target.scope, { cwd: target.cwd });
          onMessage({
            level: "info",
            message: `${targetLabel(target)}: copied ${result.copied}, removed ${result.removed}, skipped ${result.skipped}`
          });
          result.messages.forEach(onMessage);
          sourceDeletes.delete(targetKey(target));
        }
      } while (pending);
    } catch (error) {
      onMessage({ level: "error", message: String(error) });
    } finally {
      running = false;
    }
  }
}

async function changedTargetIdsForEventPaths(target: WatchTarget, eventPaths: string[]): Promise<string[]> {
  if (!eventPaths.length) return [];

  const config = await loadConfig(target.scope, target.cwd);
  const source = sourceDir(target.scope, target.cwd);
  const rulesSource = rulesSourceDir(target.scope, target.cwd);
  const changedTargetIds = new Set<string>();

  for (const configuredTarget of enabledTargets(config, target.scope)) {
    const targetPath = resolveTargetPath(pathForScope(configuredTarget, target.scope), target.scope, target.cwd);
    for (const eventPath of eventPaths) {
      if (
        !pathsEqual(targetPath, source) &&
        !isPathWithin(source, eventPath) &&
        !isPathWithin(rulesSource, eventPath) &&
        isPathWithin(targetPath, eventPath)
      ) {
        changedTargetIds.add(configuredTarget.id);
      }
    }

    for (const rule of rulesForScope(configuredTarget, target.scope)) {
      const rulePath = resolveTargetPath(rule.target, target.scope, target.cwd);
      if (eventPaths.some((eventPath) => pathsEqual(rulePath, eventPath))) {
        changedTargetIds.add(configuredTarget.id);
      }
    }
  }

  return [...changedTargetIds];
}

async function globalTargets(cwd: string): Promise<WatchTarget[]> {
  const projects = await listRegisteredProjects(cwd);
  return [
    { scope: "user", cwd },
    ...projects.map((project) => ({ scope: "project" as const, cwd: project }))
  ];
}

async function watchedPaths(targets: WatchTarget[], options: WatchOptions): Promise<string[]> {
  const paths = targets.flatMap((target) => [sourceDir(target.scope, target.cwd), rulesSourceDir(target.scope, target.cwd)]);
  if (!options.pull) return paths;

  for (const watchTarget of targets) {
    const config = await loadConfig(watchTarget.scope, watchTarget.cwd);
    for (const target of enabledTargets(config, watchTarget.scope)) {
      paths.push(resolveTargetPath(pathForScope(target, watchTarget.scope), watchTarget.scope, watchTarget.cwd));
      for (const rule of rulesForScope(target, watchTarget.scope)) {
        paths.push(resolveTargetPath(rule.target, watchTarget.scope, watchTarget.cwd));
      }
    }
  }

  return [...new Set(paths)];
}

function pathForScope(target: TargetConfig, scope: Scope): string {
  return scope === "user" ? target.userPath : target.projectPath;
}

function rulesForScope(target: TargetConfig, scope: Scope) {
  return scope === "user" ? target.userRules ?? [] : target.projectRules ?? [];
}

function targetKey(target: WatchTarget): string {
  return `${target.scope}:${path.resolve(target.cwd)}`;
}

function targetLabel(target: WatchTarget): string {
  return target.scope === "user" ? "user" : `project ${path.resolve(target.cwd)}`;
}
