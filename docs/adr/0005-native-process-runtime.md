# ADR-0005: Native process execution without a shell

## Status

Accepted and frozen in manifest revision 2

## Context

The frozen six-tool coding baseline can read and mutate files but cannot run builds,
tests, formatters, or version-control commands. Process execution has a materially
higher risk than filesystem reads and bounded edits. A shell command string would
also make quoting platform-dependent and allow shell operators to bypass executable
policy.

Windows and WSL must execute natively. Sending every command through Windows would
make WSL workflows slow and would change path, environment, and executable semantics.

## Decision

Manifest revision 2 adds one public tool named `run`. It accepts:

- an opaque configured `workspaceId`;
- an executable basename;
- an argument array;
- a workspace-relative existing working directory;
- a bounded timeout.

Queqiao never passes this input to a shell and never accepts a command string.
Executable names cannot contain paths or shell syntax. The Worker resolves a name
against its inherited trusted `PATH`, canonicalizes the selected executable, and then
spawns that absolute path. Windows accepts only native `.exe` or `.com` programs;
`.cmd`, `.bat`, and PowerShell scripts are not implicit shell entry points.

The native Worker is authoritative. A request requires all of:

1. the `queqiao:access` connector handshake;
2. a workspace with the `coding` profile;
3. no workspace tool denial for `run` and any applicable allow rule;
4. an exact executable basename in the local command allowlist;
5. a canonical working directory contained by the workspace.

The default timeout is 30 seconds and the maximum is 120 seconds. Standard output and
standard error are each bounded to 256 KiB. A Worker accepts at most two concurrent
processes. Timeout, output overflow, MCP cancellation, or an interrupted Gateway to
Worker request terminates the complete process tree. Workers pass only a minimal
environment allowlist to child processes.

## Consequences

- Windows and WSL preserve native process and path behavior.
- An allowlisted executable cannot be replaced by a same-name file in the workspace.
- Workflows requiring pipelines, redirects, or shell built-ins must use a separately
  reviewed extension or an explicitly allowlisted native executable.
- The existing six tool schemas and semantics remain unchanged, but adding `run`
  changes the public MCP manifest and requires a new connector binding.
- Local approval and one-time-code step-up remain compatible future policy layers;
  they do not change the process invocation contract.
