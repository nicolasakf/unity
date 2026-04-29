import chokidar from "chokidar";
import { sourceDir } from "./paths.js";
import { syncScope } from "./sync.js";
import type { Scope, UnityMessage } from "./types.js";

export async function watchScopes(scopes: Scope[], cwd = process.cwd(), onMessage: (message: UnityMessage) => void): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      for (const scope of scopes) {
        const result = await syncScope(scope, { cwd });
        onMessage({
          level: "info",
          message: `${scope}: copied ${result.copied}, removed ${result.removed}, skipped ${result.skipped}`
        });
        result.messages.forEach(onMessage);
      }
    }, 150);
  };

  const watcher = chokidar.watch(scopes.map((scope) => sourceDir(scope, cwd)), {
    ignoreInitial: true,
    persistent: true
  });

  watcher.on("add", run);
  watcher.on("change", run);
  watcher.on("unlink", run);
  watcher.on("addDir", run);
  watcher.on("unlinkDir", run);
  watcher.on("error", (error) => onMessage({ level: "error", message: String(error) }));

  onMessage({ level: "info", message: `Watching ${scopes.map((scope) => sourceDir(scope, cwd)).join(", ")}` });

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await watcher.close();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
