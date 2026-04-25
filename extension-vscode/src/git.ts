import * as vscode from "vscode";

export interface GitContext {
  branch: string | undefined;
  changedFiles: string[];
}

export async function getGitContext(): Promise<GitContext> {
  try {
    const gitExtension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) return empty();

    const api = gitExtension.isActive
      ? gitExtension.exports.getAPI(1)
      : ((await gitExtension.activate()) as GitExtension).getAPI(1);

    const repo = api.repositories[0];
    if (!repo) return empty();

    const branch = repo.state.HEAD?.name;
    const changedFiles = [
      ...repo.state.workingTreeChanges,
      ...repo.state.indexChanges,
    ].map((c) => c.uri.fsPath);

    return { branch, changedFiles };
  } catch {
    return empty();
  }
}

function empty(): GitContext {
  return { branch: undefined, changedFiles: [] };
}

// Minimal ambient types for the VS Code Git extension API surface we use.
interface GitExtension {
  getAPI(version: 1): GitAPI;
}
interface GitAPI {
  repositories: GitRepository[];
}
interface GitRepository {
  state: {
    HEAD: { name?: string } | undefined;
    workingTreeChanges: Array<{ uri: vscode.Uri }>;
    indexChanges: Array<{ uri: vscode.Uri }>;
  };
}
