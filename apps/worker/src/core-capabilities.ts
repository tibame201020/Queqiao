import type { ProcessExecutionMode, ToolCapability } from "@queqiao/contracts";
import type { ProcessRunner } from "@queqiao/process-runtime";
import { workspaceAllowsTool, workspaceRequiresStepUp, type WorkspaceEntry } from "./workspace-catalog.js";
import { WorkerToolError } from "./tool-errors.js";

export type NativeShellName = "default" | "bash" | "powershell" | "cmd" | "git-bash";
export type WorkerProcessExecutor = Pick<ProcessRunner, "run" | "start">;

function sameCapabilities(left: readonly ToolCapability[], right: readonly ToolCapability[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

/**
 * Per-invocation Core capability surface. The raw Workspace reader/catalog and
 * ProcessRunner never enter extension context. The granted capability ceiling is
 * the original registered tool contract, not replacement metadata.
 */
export class WorkerCoreCapabilities {
  readonly #toolName: string;
  readonly #granted: readonly ToolCapability[];
  readonly #workspace: WorkspaceEntry;
  readonly #processes: WorkerProcessExecutor;
  readonly #signal?: AbortSignal;

  constructor(input: {
    toolName: string;
    grantedCapabilities: readonly ToolCapability[];
    workspace: WorkspaceEntry;
    processes: WorkerProcessExecutor;
    signal?: AbortSignal;
  }) {
    this.#toolName = input.toolName;
    this.#granted = Object.freeze([...input.grantedCapabilities]);
    this.#workspace = input.workspace;
    this.#processes = input.processes;
    if (input.signal) this.#signal = input.signal;
  }

  workspaceId(): string { return this.#workspace.config.id; }

  assertInvocation(toolName: string, requiredCapabilities: readonly ToolCapability[], requestedWorkspaceId: string): void {
    if (toolName !== this.#toolName || !sameCapabilities(requiredCapabilities, this.#granted)) {
      throw new WorkerToolError(403, "capability_contract_mismatch", "Tool capability contract does not match the bound invocation");
    }
    if (requestedWorkspaceId !== this.#workspace.config.id) {
      throw new WorkerToolError(403, "workspace_mismatch", "Tool invocation is bound to a different Workspace");
    }
    if (workspaceRequiresStepUp(this.#workspace.config, toolName)) {
      throw new WorkerToolError(403, "step_up_required", "Step-up approval is required, but approval grants are not available in the verified runtime");
    }
    if (!workspaceAllowsTool(this.#workspace.config, toolName, requiredCapabilities)) {
      throw new WorkerToolError(403, "tool_denied", `${toolName} is denied by Workspace policy or profile`);
    }
  }

  #require(capability: ToolCapability): void {
    if (!this.#granted.includes(capability)) {
      throw new WorkerToolError(403, "capability_denied", `${this.#toolName} is not granted ${capability}`);
    }
  }

  listDirectory(path: string, depth: number, limit: number, cursor: string | undefined, includeHidden: boolean) {
    this.#require("workspace:read");
    return this.#workspace.reader.listDirectory(path, depth, limit, cursor, includeHidden);
  }

  searchText(input: { query: string; path?: string; globs?: string[]; maxResults?: number; caseSensitive?: boolean; timeoutMs?: number }) {
    this.#require("workspace:read");
    return this.#workspace.reader.searchText({ ...input, ...(this.#signal ? { signal: this.#signal } : {}) });
  }

  readFile(path: string, offset: number, limit: number) {
    this.#require("workspace:read");
    return this.#workspace.reader.read(path, offset, limit);
  }

  writeFile(path: string, content: string) {
    this.#require("workspace:write");
    return this.#workspace.reader.write(path, content);
  }

  editFile(path: string, oldText: string, newText: string) {
    this.#require("workspace:write");
    return this.#workspace.reader.edit(path, oldText, newText);
  }

  resolveExecutionDirectory(path: string) {
    this.#require("workspace:exec");
    return this.#workspace.reader.resolveStrictDirectory(path);
  }

  assertExecutionPathContained(absolutePath: string) {
    this.#require("workspace:exec");
    return this.#workspace.reader.assertContainedExistingPath(absolutePath);
  }

  relativeExecutionPath(absolutePath: string) {
    this.#require("workspace:exec");
    return this.#workspace.reader.relativeContainedExistingPath(absolutePath);
  }

  resolveNewDirectoryTarget(path: string) {
    this.#require("workspace:write");
    return this.#workspace.reader.resolveNewDirectoryTarget(path);
  }
  async run(input: { executable: string; args: readonly string[]; cwd: string; timeoutMs: number; mode: ProcessExecutionMode }) {
    this.#require("workspace:exec");
    const normalizedExecutable = input.executable.toLowerCase();
    if (!this.#workspace.config.commands.allow.some((allowed) => allowed.toLowerCase() === normalizedExecutable)) {
      throw new WorkerToolError(403, "command_denied", `${input.executable} is not allowed by Workspace command policy`);
    }
    const cwd = await this.#workspace.reader.resolveStrictDirectory(input.cwd);
    const request = { executable: input.executable, args: input.args, cwd, timeoutMs: input.timeoutMs, ...(this.#signal ? { signal: this.#signal } : {}) };
    return input.mode === "async" ? this.#processes.start(request) : this.#processes.run(request);
  }

  async shell(input: { shell: NativeShellName; command: string; cwd: string; timeoutMs: number; mode: ProcessExecutionMode }) {
    this.#require("workspace:exec");
    if (this.#toolName !== "shell") {
      throw new WorkerToolError(403, "capability_denied", "Native shell is only available to the shell Core contract");
    }
    const cwd = await this.#workspace.reader.resolveStrictDirectory(input.cwd);
    const invocation = nativeShellInvocation(input.shell, input.command);
    const request = { executable: invocation.executable, args: invocation.args, cwd, timeoutMs: input.timeoutMs, ...(this.#signal ? { signal: this.#signal } : {}) };
    return { shell: invocation.name, ...(input.mode === "async" ? await this.#processes.start(request) : await this.#processes.run(request)) };
  }
}

function nativeShellInvocation(shell: NativeShellName, command: string): { name: string; executable: string; args: string[] } {
  if (process.platform === "win32") {
    if (shell === "default" || shell === "powershell") return { name: "powershell", executable: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] };
    if (shell === "cmd") return { name: "cmd", executable: "cmd.exe", args: ["/d", "/s", "/c", command] };
    if (shell === "bash" || shell === "git-bash") return { name: "git-bash", executable: "bash.exe", args: ["-lc", command] };
  } else if (shell === "default" || shell === "bash") {
    return { name: "bash", executable: "bash", args: ["-lc", command] };
  }
  throw new WorkerToolError(400, "shell_unavailable", `${shell} is not supported by this ${process.platform} Worker`);
}
