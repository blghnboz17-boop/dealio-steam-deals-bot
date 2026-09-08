import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";

import {
  collectGitState,
  type GitCommandRunner,
  type GitState,
} from "./git-state.js";

const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const GIT_TIMEOUT_MS = 5_000;

const nodeGitRunner: GitCommandRunner = (args, cwd) => new Promise((resolve, reject) => {
  execFile(
    "git",
    [...args],
    {
      cwd,
      encoding: "buffer",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    },
    (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(stdout);
    },
  );
});

export async function collectNodeGitState(worktree: string): Promise<GitState> {
  const state = await collectGitState({ cwd: worktree, runner: nodeGitRunner, canonicalizePath: realpath });
  return { ...state, worktreePath: state.worktreePath.replaceAll("\\", "/") };
}
