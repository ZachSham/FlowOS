import * as vscode from "vscode";
import WebSocket from "ws";

// Types mirrored from @flowos/shared (avoid workspace dependency — extension uses CommonJS)
interface VscodeDiagnostic {
  file: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
}

interface VscodeGitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
}

interface VscodeEditorGroup {
  index: number;
  activeFile: string | null;
  openFiles: string[];
}

interface VscodeTerminal {
  name: string;
  processId: number | null;
}

interface VscodeSnapshot {
  app: "vscode";
  workspaceName: string | null;
  workspaceRoot: string | null;
  activeFile: string | null;
  activeLanguageId: string | null;
  activeLine: number | null;
  activeColumn: number | null;
  selectedText: string | null;
  editorGroups: VscodeEditorGroup[];
  openTabs: string[];
  diagnostics: VscodeDiagnostic[];
  git: VscodeGitStatus | null;
  terminals: VscodeTerminal[];
  capturedAt: string;
}

type RealtimeMessage =
  | { type: "extension.handshake"; source: string; version: string; clientId: string; token: string; sentAt: string }
  | { type: "extension.handshake.ack"; clientId: string; heartbeatIntervalMs: number; authRequired: boolean; serverTime: string; source: string }
  | { type: "extension.heartbeat"; source: string; clientId: string; sentAt: string }
  | { type: "extension.heartbeat.ack"; clientId: string; serverTime: string; source: string }
  | { type: "vscode.snapshot"; payload: VscodeSnapshot }
  | { type: "vscode.command.request"; payload: VscodeCommandRequest }
  | { type: "vscode.command.result"; payload: VscodeCommandResult };

interface VscodeCommandRequest {
  requestId: string;
  command: string;
  payload: Record<string, unknown>;
  issuedAt: string;
}

interface VscodeCommandResult {
  requestId: string;
  command: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  completedAt: string;
}

// ─── Safe VS Code command allowlist ──────────────────────────────────────────
// Only commands that cannot destroy work are allowed through vscode.command.execute
const SAFE_VSCODE_COMMANDS = new Set([
  "editor.action.formatDocument",
  "editor.action.formatSelection",
  "editor.action.organizeImports",
  "editor.action.fixAll",
  "editor.foldAll",
  "editor.unfoldAll",
  "editor.foldLevel1",
  "editor.foldLevel2",
  "editor.foldLevel3",
  "workbench.action.splitEditor",
  "workbench.action.splitEditorRight",
  "workbench.action.splitEditorDown",
  "workbench.action.closeActiveEditor",
  "workbench.action.closeEditorsInGroup",
  "workbench.action.files.saveAll",
  "workbench.action.files.save",
  "workbench.action.gotoLine",
  "workbench.action.quickOpen",
  "workbench.action.findInFiles",
  "workbench.action.showAllSymbols",
  "workbench.action.focusActiveEditorGroup",
  "workbench.action.terminal.focus",
  "workbench.action.terminal.new",
  "workbench.action.terminal.kill",
  "workbench.action.terminal.copySelection",
  "workbench.actions.view.problems",
  "workbench.action.output.toggleOutput",
  "workbench.view.explorer",
  "workbench.view.scm",
  "workbench.view.extensions",
  "editor.action.goToDeclaration",
  "editor.action.peekDefinition",
  "editor.action.referenceSearch.trigger",
  "editor.action.rename",
  "git.refresh",
  "git.stageAll",
  "git.unstageAll",
  "editor.action.addCommentLine",
  "editor.action.removeCommentLine",
  "editor.action.indentLines",
  "editor.action.outdentLines",
  "editor.action.sortLinesAscending",
  "editor.action.trimTrailingWhitespace",
  "workbench.action.reloadWindow",
  "workbench.action.toggleSidebarVisibility",
  "workbench.action.togglePanel",
  "workbench.action.toggleMaximizedPanel",
  "workbench.action.toggleZenMode",
  "workbench.action.zoomIn",
  "workbench.action.zoomOut",
  "workbench.action.zoomReset",
]);

// ─── State ────────────────────────────────────────────────────────────────────

let socket: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let clientId = "";
let currentContext: vscode.ExtensionContext | null = null;
let isConnecting = false;
const RECONNECT_DELAY_MS = 2000;
const MAX_SELECTED_TEXT_LEN = 500;
const MAX_DIAGNOSTICS = 40;
const MAX_SEARCH_RESULTS = 20;

// ─── Activate / deactivate ────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  currentContext = context;

  context.subscriptions.push(
    vscode.commands.registerCommand("flowos.pushSnapshot", () => { void pushSnapshot(); }),
    vscode.commands.registerCommand("flowos.reconnect", () => {
      socket?.close();
      reconnect();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => { void pushSnapshot(); }),
    vscode.window.onDidChangeTextEditorSelection(() => { void pushSnapshot(); }),
    vscode.languages.onDidChangeDiagnostics(() => { void pushSnapshot(); }),
    vscode.window.tabGroups.onDidChangeTabs(() => { void pushSnapshot(); }),
    vscode.window.onDidOpenTerminal(() => { void pushSnapshot(); }),
    vscode.window.onDidCloseTerminal(() => { void pushSnapshot(); }),
    vscode.workspace.onDidSaveTextDocument(() => { void pushSnapshot(); }),
  );

  void connect();
}

export function deactivate() {
  stopHeartbeat();
  clearTimeout(reconnectTimer ?? undefined);
  socket?.close();
  socket = null;
  currentContext = null;
}

// ─── WebSocket connection ─────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("flowos");
  return {
    port: cfg.get<number>("port") ?? 7331,
    token: cfg.get<string>("token") ?? "",
  };
}

async function connect() {
  if (isConnecting || !currentContext) return;
  isConnecting = true;

  clientId = await getOrCreateClientId(currentContext);
  const { port, token } = getConfig();

  socket = new WebSocket(`ws://127.0.0.1:${port}`);

  socket.on("open", () => {
    isConnecting = false;
    send({
      type: "extension.handshake",
      source: "vscode-extension",
      version: currentContext?.extension.packageJSON.version as string ?? "0.2.0",
      clientId,
      token,
      sentAt: new Date().toISOString(),
    });
  });

  socket.on("message", (raw) => { handleMessage(String(raw)); });

  socket.on("error", () => { /* reconnect on close */ });

  socket.on("close", () => {
    isConnecting = false;
    stopHeartbeat();
    reconnect();
  });
}

function reconnect() {
  clearTimeout(reconnectTimer ?? undefined);
  reconnectTimer = setTimeout(() => { void connect(); }, RECONNECT_DELAY_MS);
}

function send(message: RealtimeMessage) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// ─── Message handling ─────────────────────────────────────────────────────────

function handleMessage(raw: string) {
  try {
    const message = JSON.parse(raw) as RealtimeMessage;

    if (message.type === "extension.handshake.ack") {
      startHeartbeat(message.heartbeatIntervalMs);
      void pushSnapshot();
      return;
    }

    if (message.type === "extension.heartbeat.ack") {
      return;
    }

    if (message.type === "vscode.command.request") {
      void executeCommand(message.payload);
    }
  } catch {
    // malformed message — ignore
  }
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

function startHeartbeat(intervalMs: number) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send({
      type: "extension.heartbeat",
      source: "vscode-extension",
      clientId,
      sentAt: new Date().toISOString(),
    });
  }, intervalMs);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function buildGitStatus(): Promise<VscodeGitStatus | null> {
  try {
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (!gitExt) return null;
    if (!gitExt.isActive) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const api = (gitExt.exports as any).getAPI(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const repo = api.repositories[0] as any;
    if (!repo) return null;

    const state = repo.state;
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      branch: String(state.HEAD?.name ?? "unknown"),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ahead: Number(state.HEAD?.ahead ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      behind: Number(state.HEAD?.behind ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      modified: (state.workingTreeChanges as any[]).map((c: any) => String(c.uri?.fsPath ?? "")),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      staged: (state.indexChanges as any[]).map((c: any) => String(c.uri?.fsPath ?? "")),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      untracked: (state.untrackedChanges as any[]).map((c: any) => String(c.uri?.fsPath ?? "")),
    };
  } catch {
    return null;
  }
}

async function pushSnapshot() {
  if (socket?.readyState !== WebSocket.OPEN) return;

  const activeEditor = vscode.window.activeTextEditor;
  const selection = activeEditor?.selection;
  const selectedText = activeEditor && selection && !selection.isEmpty
    ? activeEditor.document.getText(selection).slice(0, MAX_SELECTED_TEXT_LEN)
    : null;

  const diagnostics: VscodeDiagnostic[] = vscode.languages
    .getDiagnostics()
    .flatMap(([uri, items]) =>
      items.slice(0, 8).map((item) => ({
        file: uri.fsPath,
        severity:
          item.severity === vscode.DiagnosticSeverity.Error ? "error"
          : item.severity === vscode.DiagnosticSeverity.Warning ? "warning"
          : "info",
        message: item.message,
        line: item.range.start.line + 1,
        column: item.range.start.character + 1,
      } satisfies VscodeDiagnostic))
    )
    .slice(0, MAX_DIAGNOSTICS);

  const editorGroups: VscodeEditorGroup[] = vscode.window.tabGroups.all.map((group, i) => ({
    index: i,
    activeFile: group.activeTab?.input instanceof vscode.TabInputText
      ? group.activeTab.input.uri.fsPath
      : null,
    openFiles: group.tabs
      .map((tab) => tab.input instanceof vscode.TabInputText ? tab.input.uri.fsPath : null)
      .filter((f): f is string => f !== null),
  }));

  const openTabs = editorGroups.flatMap((g) => g.openFiles);

  const terminals: VscodeTerminal[] = await Promise.all(
    vscode.window.terminals.map(async (t) => ({
      name: t.name,
      processId: await t.processId ?? null,
    }))
  );

  const git = await buildGitStatus();

  const snapshot: VscodeSnapshot = {
    app: "vscode",
    workspaceName: vscode.workspace.workspaceFolders?.[0]?.name ?? null,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    activeFile: activeEditor?.document.uri.fsPath ?? null,
    activeLanguageId: activeEditor?.document.languageId ?? null,
    activeLine: activeEditor ? activeEditor.selection.active.line + 1 : null,
    activeColumn: activeEditor ? activeEditor.selection.active.character + 1 : null,
    selectedText,
    editorGroups,
    openTabs,
    diagnostics,
    git,
    terminals,
    capturedAt: new Date().toISOString(),
  };

  send({ type: "vscode.snapshot", payload: snapshot });
}

// ─── Command execution ────────────────────────────────────────────────────────

async function executeCommand(request: VscodeCommandRequest) {
  let result: VscodeCommandResult;

  try {
    const output = await dispatchCommand(request.command, request.payload);
    result = {
      requestId: request.requestId,
      command: request.command,
      ok: true,
      result: output,
      completedAt: new Date().toISOString(),
    };
  } catch (err) {
    result = {
      requestId: request.requestId,
      command: request.command,
      ok: false,
      error: {
        code: "VSCODE_COMMAND_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
      completedAt: new Date().toISOString(),
    };
  }

  send({ type: "vscode.command.result", payload: result });
}

async function dispatchCommand(command: string, payload: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case "vscode.file.open":
      return openFile(payload);
    case "vscode.text.search":
      return searchText(payload);
    case "vscode.terminal.run":
      return runInTerminal(payload);
    case "vscode.command.execute":
      return executeSafeCommand(payload);
    case "vscode.editor.split":
      return splitEditor(payload);
    case "vscode.panel.focus":
      return focusPanel(payload);
    case "vscode.symbol.search":
      return searchSymbols(payload);
    default:
      throw new Error(`Unknown FlowOS command: ${command}`);
  }
}

// ─── Individual command implementations ───────────────────────────────────────

async function openFile(payload: Record<string, unknown>) {
  const filePath = String(payload["path"] ?? "");
  if (!filePath) throw new Error("path is required");

  const uri = vscode.Uri.file(filePath);
  const line = typeof payload["line"] === "number" ? payload["line"] - 1 : undefined;
  const column = typeof payload["column"] === "number" ? payload["column"] - 1 : undefined;

  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, {
    preview: payload["preview"] !== false,
    preserveFocus: false,
  });

  if (line !== undefined) {
    const pos = new vscode.Position(Math.max(0, line), column ?? 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  void pushSnapshot();
  return { opened: filePath, line: line !== undefined ? line + 1 : undefined };
}

async function searchText(payload: Record<string, unknown>) {
  const query = String(payload["query"] ?? "");
  if (!query) throw new Error("query is required");

  const includePattern = typeof payload["includePattern"] === "string" ? payload["includePattern"] : "**";
  const excludePattern = typeof payload["excludePattern"] === "string" ? payload["excludePattern"] : undefined;
  const caseSensitive = payload["caseSensitive"] === true;

  const files = await vscode.workspace.findFiles(includePattern, excludePattern, 50);
  const matches: Array<{ file: string; line: number; preview: string }> = [];
  const queryLower = caseSensitive ? query : query.toLowerCase();

  for (const fileUri of files) {
    if (matches.length >= MAX_SEARCH_RESULTS) break;
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      for (let i = 0; i < doc.lineCount && matches.length < MAX_SEARCH_RESULTS; i++) {
        const lineText = doc.lineAt(i).text;
        const haystack = caseSensitive ? lineText : lineText.toLowerCase();
        if (haystack.includes(queryLower)) {
          matches.push({ file: fileUri.fsPath, line: i + 1, preview: lineText.trim().slice(0, 120) });
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return { matches };
}

async function runInTerminal(payload: Record<string, unknown>) {
  const command = String(payload["command"] ?? "");
  if (!command) throw new Error("command is required");

  const terminalName = typeof payload["terminalName"] === "string" ? payload["terminalName"] : "FlowOS";
  const cwd = typeof payload["cwd"] === "string" ? payload["cwd"] : undefined;

  let terminal = vscode.window.terminals.find((t) => t.name === terminalName);
  if (!terminal) {
    terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
  }

  terminal.show(true);
  terminal.sendText(command);
  void pushSnapshot();

  return { terminalName, sent: command };
}

async function executeSafeCommand(payload: Record<string, unknown>) {
  const commandId = String(payload["commandId"] ?? "");
  if (!commandId) throw new Error("commandId is required");
  if (!SAFE_VSCODE_COMMANDS.has(commandId)) {
    throw new Error(`Command '${commandId}' is not in the FlowOS safe command allowlist.`);
  }

  const args = Array.isArray(payload["args"]) ? payload["args"] : [];
  await vscode.commands.executeCommand(commandId, ...args);
  void pushSnapshot();

  return { commandId, executed: true };
}

async function splitEditor(payload: Record<string, unknown>) {
  const direction = payload["direction"] === "down" ? "down" : "right";
  const vsCommand = direction === "down"
    ? "workbench.action.splitEditorDown"
    : "workbench.action.splitEditorRight";
  await vscode.commands.executeCommand(vsCommand);
  return { direction };
}

async function focusPanel(payload: Record<string, unknown>) {
  const panel = String(payload["panel"] ?? "terminal");
  const commandMap: Record<string, string> = {
    terminal: "workbench.action.terminal.focus",
    problems: "workbench.actions.view.problems",
    output: "workbench.action.output.toggleOutput",
    explorer: "workbench.view.explorer",
    "source-control": "workbench.view.scm",
  };
  const vsCommand = commandMap[panel];
  if (!vsCommand) throw new Error(`Unknown panel: ${panel}`);
  await vscode.commands.executeCommand(vsCommand);
  return { panel };
}

async function searchSymbols(payload: Record<string, unknown>) {
  const query = String(payload["query"] ?? "");
  if (!query) throw new Error("query is required");

  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    query
  ) ?? [];

  const results = symbols.slice(0, 20).map((s) => ({
    name: s.name,
    file: s.location.uri.fsPath,
    line: s.location.range.start.line + 1,
    kind: vscode.SymbolKind[s.kind] ?? String(s.kind),
  }));

  return { symbols: results };
}

// ─── Client ID persistence ────────────────────────────────────────────────────

async function getOrCreateClientId(context: vscode.ExtensionContext): Promise<string> {
  const existing = context.globalState.get<string>("flowosClientId");
  if (existing) return existing;
  const next = `vscode_${crypto.randomUUID()}`;
  await context.globalState.update("flowosClientId", next);
  return next;
}
