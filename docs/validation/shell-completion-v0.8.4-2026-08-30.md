# Shell completion v0.8.4 validation — 2026-08-30

## Scope

This record validates the v0.8.4 shell-completion release surface:

```text
queqiao completion bash
queqiao completion zsh
queqiao completion powershell
```

The completion model is derived from `CLI_LEAF_CONTRACTS`. v0.8.4 completes canonical command hierarchy, documented flags, and the supported completion-shell positional values. It intentionally does not query runtime Gateway, Worker, Workspace, or Extension state while completing value arguments.

## Contract validation

- Public CLI leaf count: 44.
- Every canonical leaf is represented by the generated completion prefix model.
- Every leaf option is sourced from its canonical `CLI_LEAF_CONTRACTS` entry.
- `completion` shell values are canonical metadata: `bash`, `zsh`, `powershell`.
- Root completion includes primary CLI domains and global version/help flags.
- `gateway info` completion includes `--gateway`, `--detail`, `--copy-url`, `--copy-secret`, and help/output flags.

## Shell behavior

PowerShell was exercised through the packaged CLI and `System.Management.Automation.CommandCompletion`:

```text
queqiao <Tab>
→ completion / doctor / extension / gateway / migrate / uninstall / version / worker / global flags

queqiao completion <Tab>
→ bash / powershell / zsh

queqiao gateway <Tab>
→ info / join-token / list / remove / serve / setup / status / stop / workers

queqiao gateway info <Tab>
→ --copy-secret / --copy-url / --detail / --gateway / --help / --json / -h

queqiao gateway info --c<Tab>
→ --copy-secret / --copy-url
```

The generated PowerShell script parses successfully and registers both `queqiao` and `queqiao.cmd` as native completion command names.

The packaged Bash script was emitted as raw LF text and passed `bash -n` under WSL. A functional Bash smoke also produced the expected Gateway subcommands and `gateway info` flags.

Zsh is not installed in the local WSL validation environment, so local validation is structural for Zsh: the generated adapter contains `#compdef queqiao`, the canonical prefix maps, and `compdef _queqiao_completion queqiao`. Cross-platform CI remains the release gate for repository behavior.

## Packaged acceptance

`apps/cli/src/cli-isolated-acceptance.test.ts` now requires the `completion` leaf in the acceptance registry and invokes all three completion commands from the same-revision temporary package bundle.

## Final gates

- TypeScript project typecheck: PASS.
- Focused completion / command-surface / visual-doc tests: PASS.
- Full test suite: **597 / 597 PASS** across **73** test files.
- Security suite: **507 / 507 PASS** across **56** test files.
- Temporary package build: PASS with `QUEQIAO_BUILD_OUTDIR`; the active Shadow runtime was not overwritten.
- Packaged CLI version: **0.8.4**.
- Packaged Bash parse: PASS.
- Packaged PowerShell completion behavior: PASS.
- Root README production length guard: PASS at 180 split lines.
- `git diff --check`: PASS.

## Runtime impact

Shell completion is presentation-only. It does not modify Gateway, Worker, Workspace authority, Extension attachment, enrollment, OAuth, process execution, or runtime configuration semantics.
