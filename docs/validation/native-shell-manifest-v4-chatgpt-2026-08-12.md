# Native Shell Manifest Revision 4 — ChatGPT Validation

Date: 2026-08-12

Connector: `Queqiao Revision` only. This was a new connector binding for public
manifest revision 4.

## Results

| Workspace | Requested shell | Resolved shell | Result |
| --- | --- | --- | --- |
| `exec-validation` | `default` | `powershell` | PASS |
| `exec-validation-wsl` | `default` | `bash` | PASS |
| `exec-validation` | `cmd` | `cmd` | PASS |
| `exec-validation` | `git-bash` | `git-bash` | PASS |

The Windows default reported Windows PowerShell 5.1 and the expected contained
workspace cwd. The WSL default reported Bash 5.3, Linux, and the native WSL workspace
cwd. Explicit cmd and Git Bash requests both resolved to their requested native shell
and retained the Windows workspace boundary. Every invocation exited with code zero.

## Permission isolation

Only `exec-validation` and `exec-validation-wsl` used a `coding` profile with
`tools.explicit: [shell]`. Direct attempts against `interview` and `irispipe` failed
with `shell requires explicit workspace allow policy`.

## Frozen baseline

Revision 4 therefore freezes these semantics:

1. Windows `default` resolves to PowerShell and WSL/Linux `default` resolves to Bash.
2. Windows may explicitly select cmd or Git Bash.
3. Shell cwd is resolved within the selected workspace by its native Worker.
4. Adding the public shell tool grants no existing workspace permission.
5. Shell execution requires both the `coding` profile and an explicit shell grant.

