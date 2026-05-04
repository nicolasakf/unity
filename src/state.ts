import { statePath } from "./paths.js";
import type { Scope, UnityState } from "./types.js";
import { readJsonFile, writeJsonFile } from "./json.js";

export function emptyState(): UnityState {
  return { version: 1, targets: {} };
}

export async function loadState(scope: Scope, cwd = process.cwd()): Promise<UnityState> {
  const state = await readJsonFile<UnityState>(statePath(scope, cwd), emptyState());
  return {
    version: 1,
    targets: Object.fromEntries(
      Object.entries(state.targets ?? {}).map(([id, target]) => [
        id,
        {
          targetPath: target.targetPath,
          skills: target.skills ?? {},
          rules: target.rules ?? {}
        }
      ])
    )
  };
}

export async function saveState(scope: Scope, state: UnityState, cwd = process.cwd()): Promise<void> {
  await writeJsonFile(statePath(scope, cwd), {
    version: 1,
    targets: Object.fromEntries(
      Object.entries(state.targets ?? {}).map(([id, target]) => [
        id,
        {
          targetPath: target.targetPath,
          skills: target.skills ?? {},
          rules: target.rules ?? {}
        }
      ])
    )
  });
}
