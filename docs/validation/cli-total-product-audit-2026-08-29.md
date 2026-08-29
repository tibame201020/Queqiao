# CLI total product audit — 2026-08-29

## Scope and evidence

This is the pre-redesign baseline for the complete public CLI. It records the checked-out repository, including current working-tree changes, without changing product behavior. Sources of truth, in descending order, are dispatch/normalization code, handlers and schemas, tests, current README/current docs, then historical validation documents.

Evidence reviewed: `apps/cli/src/index.ts`, `command-surface.ts`, layout/output code, every CLI handler and prompt primitive, CLI tests, `README.md`, `docs/workspace-authority.md`, ADRs, wayfinders, and existing `docs/validation` records. Focused command-surface/TUI tests passed: 6 files, 59 tests. An in-sandbox `tsx` help smoke could not start its esbuild subprocess (`EPERM`); help strings and their tests remain directly inspectable evidence.

The untracked `product-setup.ts` and `product-setup.test.ts` are **not public product surface**: `queqiao setup` is absent from `COMMAND_TREE`, help, normalization, and dispatch. They are work in progress and were not modified.

## Current public command tree

```text
queqiao [--json]
├─ gateway
│  ├─ setup
│  ├─ remove
│  ├─ serve [--bg] [--name <gateway>]
│  ├─ stop [--name <gateway>]
│  ├─ status [--name <gateway>]
│  ├─ join-token --name <gateway> [--expires <seconds>]
│  └─ workers
│     ├─ list [--name <gateway>]
│     ├─ update [--name <gateway>] --worker-id <id> --endpoint <url>
│     └─ remove [--name <gateway>] --worker-id <id>
├─ worker
│  ├─ setup
│  ├─ remove
│  ├─ port [--name <worker>] [--port <port>]
│  ├─ serve [--bg] [--name <worker>]
│  ├─ stop [--name <worker>]
│  ├─ status [--name <worker>]
│  ├─ join --name <worker> [--join-code <code>]
│  └─ workspace
│     ├─ add --worker <worker> [--root <dir> --name <display> --profile <legacy-profile>]
│     ├─ list --worker <worker>
│     ├─ remove --worker <worker> --id <id>
│     ├─ profile set --worker <worker> [--workspace <id>] [--profile <legacy-profile>]
│     ├─ tool allow|deny --worker <worker> --workspace <id> --tool <tool>
│     ├─ command allow|deny --worker <worker> --workspace <id> --command <executable>
│     └─ permissions show --worker <worker> [--workspace <id>]
├─ extension
│  ├─ install <npm:package> [--worker <worker> | --attach-all]
│  ├─ attach <id> --worker <worker>
│  ├─ detach <id> --worker <worker>
│  ├─ uninstall <id> [--force]
│  ├─ list
│  └─ show <id>
├─ doctor
│  ├─ extension
│  ├─ manifest show --gateway <gateway>
│  ├─ tool explain <tool> --gateway <gateway>
│  └─ paths
├─ uninstall
└─ migrate                         (hidden from root help)
   ├─ from-repo [--repo <dir>] [--execute]
   └─ runtime-v1 [--execute]
```

`--help` and `-h` are equivalent. There are no command aliases. Former flat routes are rejection tombstones with replacement messages, not compatibility aliases. `--json` is global output formatting, but handlers do not share a strict parser; most routes do not reject unknown flags.

## Behavior matrix

| Surface | Context/default | Interaction and output | Mutation/risk |
| --- | --- | --- | --- |
| `gateway setup` | TTY required; `--name` rejected | Select existing/Create new; name, public URL, service and management ports; structured result plus TUI summary | Creates/updates config and secrets; validates URL, port availability/reservations |
| `gateway remove` | TTY required; `--name` rejected | Select instance, confirm default No; refuses active/managed instance | Recursively deletes Queqiao-owned role roots |
| `gateway serve/stop/status` | `--name` defaults to `default` | Foreground serve inherits terminal; `--bg` managed PID/logs; status is health/identity data | Start/kill process; stop only owns verified managed PID |
| `gateway join-token` | explicit `--name`; expiry default 300, range 30–3600 | Returns one-time self-contained join code and attempts clipboard copy | Writes enrollment token state; credential is sensitive output |
| `gateway workers list` | gateway `--name` defaults `default` | Structured membership inventory | Read-only |
| `gateway workers update` | gateway default; worker ID and loopback endpoint required | Structured updated membership | Mutates Gateway routing transport |
| `gateway workers remove` | gateway default; worker ID required; no confirmation | Structured result | Revokes/removes membership immediately |
| `worker setup` | TTY required; `--name` rejected | Select/Create; port; first Workspace path/display/access; edits skip Workspace flow if one exists | Creates identity secret/config or updates port/policy seed |
| `worker remove` | Same selection model as Gateway | Select + default-No confirm; refuses running instance | Deletes role state including credential/config |
| `worker port` | `--name` defaults `default`; `--port` omitted prompts | Requires Worker stopped; structured result | Mutates listener; does not update Gateway membership |
| `worker serve/stop/status` | `--name` defaults `default` | Same lifecycle model; serve requires at least one Workspace | Process state mutation/read |
| `worker join` | explicit `--name`; `--join-code` optional | Missing code uses masked password prompt; URL and Worker endpoint come from code/config; preflight occurs before token use | Exchanges bootstrap credential only after Gateway confirmation |
| `workspace add` | explicit `--worker`; interactive unless any of root/name/profile is supplied | Interactive path autocomplete + display + access flow; scripted mode defaults missing name and profile | Adds explicit filesystem/process authority; rejects duplicate canonical root |
| `workspace list` | explicit `--worker` | Metadata + Workspace records | Read-only; currently includes stored roots |
| `workspace remove` | worker and ID required; no confirm | Refuses last Workspace | Removes authority immediately |
| `profile set` | worker required | Without `--profile`: optionally selects Workspace, then full Access flow. With it: Workspace required and only legacy ceiling changes | Replaces policy or legacy compatibility field |
| `tool allow/deny` | worker, Workspace, tool required | Structured policy result; no prompt/confirm | Immediate granular policy mutation; shell has special explicit semantics |
| `command allow/deny` | worker, Workspace, executable required | Lowercases; rejects paths/shell syntax | Immediate executable allowlist mutation |
| `permissions show` | worker required; Workspace optional | Sanitized policy/manifest output omits root | Read-only |
| `extension install` | positional source or hidden `--source`; npm source only | Installs, then optional one Worker/all attachment | Downloads/executes package install path; changes hub and configs |
| `extension attach/detach` | positional ID or hidden `--id`; worker required | Structured attachment state | Immediate Worker config mutation |
| `extension uninstall` | ID; `--force` required if attached | Structured result; no confirm | Removes package; force also detaches |
| `extension list/show` | global local Extension Hub | Structured inventory/detail | Read-only |
| `doctor` | no selector | Aggregates named roles and Extension Hub | Read-only diagnostics |
| Doctor children | Gateway required for manifest/tool; tool is positional | Structured diagnostics | Read-only |
| `uninstall` | always TTY; `--yes` explicitly rejected | Preselected multi-select, path review, default-No cleanup confirm, separate npm uninstall confirm | Stops managed selections; recursively removes selected roots; may globally uninstall npm package |
| `migrate ...` | hidden; dry-run unless `--execute`; layout otherwise defaults | Returns plan or result | Execute writes config/secrets/copies state; refuses existing targets |

Output is human key/value formatting by default and JSON with `--json`. Human output is generic rather than command-designed; secrets therefore need command-specific redaction/display rules, not reliance on the formatter. Cancellation generally prints a Clack cancellation and then throws the same message, while a negative confirmation may return a successful `{cancelled:true}` result.

## Interaction inventory

| Primitive | Uses | Current semantics | Audit finding |
| --- | --- | --- | --- |
| Custom single-select | setup/remove, profile/Workspace choices | `>` + cyan means focus; submit collapses to label; descriptions dim when unfocused | Clear semantics, but no terminal-width wrapping and disabled rendering is not customized |
| Custom multi-select | Tools, uninstall targets | `>` is focus; `[x]/[ ]` is selection; selected mark green; submit collapses to count | `[x]` is semantically appropriate and familiar. Confusion comes from weak separation from focus and dense multiline rows. Preserve independent states; evaluate `●/○`, checkmark, or stronger focus treatment only as a full-system change |
| Text | names, URLs, ports, display/profile names | Initial values + inline validation | Labels/hints are inconsistent; validation and requiredness vary by caller |
| Password | join code | Masked; only interactive credential entry | Correct for sensitive join code; flag form can leak via shell history/process list and needs explicit warning |
| Confirm | role removal/uninstall | destructive confirms default false | Granular membership/Workspace/extension mutations have no confirmation, creating uneven risk policy |
| Path autocomplete | initial/additional Workspace | Existing directories; Tab completes common prefix; up to 5 dim candidates | No visible Tab instruction, no explicit focused candidate, no width-aware truncation/wrapping |
| History text | Custom `run` executables | last 20 local values; newest is ghost/default; Up/Down via readline | No visible history instruction; comma-list parsing is compact but error-prone |
| Intro/outro/summary | interactive setup/remove/uninstall | Setup collapses each prompt and prints outro; generic command output follows | Can duplicate completion information; no final review before setup mutation |

No explicit narrow-terminal algorithm exists in custom choice/path renderers. Descriptions are split only on embedded newlines, so natural text wraps in the terminal without controlled continuation indentation; this matches the observed broken alignment. Cancellation language is domain-specific but not normalized into one exit/status contract.

## Inconsistency and drift map

| Priority | Finding | Evidence/impact |
| --- | --- | --- |
| P0 | Parser/help are hand-maintained parallel models | Command tree, help strings, normalization, dispatch, and handler option parsing can drift; leaf help usually falls back to parent help and omits actual flags/defaults |
| P0 | Setup selector contract contradicts older/current examples | Actual setup rejects `--name`; `docs/distribution-cluster-baseline-v1.md` still instructs `gateway setup --name`. Existing historical validation must remain historical; current operational docs must be corrected during convergence |
| P0 | Destructive-risk policy is inconsistent | Role/uninstall deletion confirms; membership remove, Workspace remove, extension detach/uninstall, and policy mutations do not. Scriptability requirement is not documented as the reason |
| P1 | `worker workspace ... --worker` redundantly repeats parent ownership | It is product-level redundancy. Current cause is option collision: `workspace add --name` means display name while role lifecycle uses `--name` for instance. Resolve across grammar/help/docs/tests in one compatibility decision, not a one-off flag removal |
| P1 | Three selector spellings | `--name` (role), `--worker` (nested/extension), `--gateway` (doctor) describe target instances inconsistently; membership uses `--name` despite being nested under Gateway |
| P1 | Defaults are unsafe/invisible in named-role product | Many lifecycle/membership routes silently target `default`, while enrollment requires explicit names and setup is chooser-only. A typo/omission can resolve a different config before handler validation |
| P1 | Interactive and scripted Workspace add switch on presence of any one flag | Partial `--name` or `--profile` silently forces non-interactive mode and defaults root to cwd; behavior is surprising and weakly documented |
| P1 | Access model exposes two abstractions | Full Access Profile/Custom flow coexists with legacy `read-only|editor|coding`; `profile set` changes meaning based on flag presence |
| P1 | Help under-documents actual surface | Root hides migrate intentionally, but leaf flags, destructive effects, TTY requirements, defaults, `--source/--id`, clipboard behavior, exit/cancel rules, and credential exposure are incomplete |
| P1 | Unknown-option validation is inconsistent | Enrollment has command-local allowlists; general dispatch scans strings and often ignores unknown flags or consumes a following option as a value |
| P2 | Multiselect is accurate but visually ambiguous | `[x]` means selection and `>` means focus by design/tests; descriptions and narrow wrapping reduce scanability. This is a renderer-system issue, not a Tools-only patch |
| P2 | README is closer to code than old validation, but not complete | Main command list matches most canonical routes. Wayfinder still shows unsupported `join-token --copy`; older validations retain removed flat commands and must be labeled historical rather than used as current instructions |
| P2 | Output/cancellation is not a stable CLI contract | Generic formatting, mixed TUI + structured summaries, thrown cancel vs successful negative confirm, and no documented exit-code matrix complicate automation |
| P2 | `product-setup` work is disconnected | Untracked orchestration exists but is unreachable. It must not be documented/released until public grammar, tests, and compatibility are intentionally added |

## Design constraints

1. Gateway owns public ingress, OAuth, deployment composition, enrollment issuance, and membership routing. Worker owns identity, loopback execution, Workspaces, policy, commands, and extension attachment.
2. Workspace paths are explicit existing-directory authority boundaries; never infer or widen them from Git/project discovery. A Worker must retain at least one Workspace.
3. Worker listeners and membership endpoints remain loopback-only; a port change does not silently rewrite a Gateway registry.
4. Join codes and worker/bootstrap secrets must not enter repository data, normal logs, or accidental human summaries. Interactive entry remains masked.
5. Destructive targets must be resolved to Queqiao-owned paths; unmanaged active runtimes block deletion. No broad environment override root is recursively removed.
6. Interactive flows need keyboard-only operation, distinct focus/selection states, deterministic cancellation, readable descriptions, and controlled rendering in narrow terminals.
7. Every public command must have a scriptable contract or be explicitly interactive-only. Defaults, exit codes, stdout/stderr, JSON schema, and confirmation policy are product API.
8. Help, parser, dispatch, documentation, and tests should derive from one command specification or be contract-tested exhaustively.

## Compatibility constraints

- The 2026-08-28 hierarchy intentionally removed flat routes. Do not reintroduce them accidentally as silent aliases.
- Renaming/removing `--worker`, `--name`, legacy profiles, positional extension IDs, or hidden migration commands affects scripts and recorded docs; provide an explicit deprecation window or declare the next release breaking.
- `--json` consumers need stable, secret-safe schemas. Human TUI improvements must not pollute JSON stdout.
- Historical validation documents are evidence of their date and should not be rewritten. Current README/operator docs need a clear current-contract pointer.
- Interactive setup/remove currently reject `--name`; adding direct non-interactive selection is a behavior change requiring collision, overwrite, and secret-generation tests.
- The untracked product setup work must remain preserved and unshipped until its orchestration transaction/rollback and public contract are settled.

## Prioritized convergence plan (no UX implementation in this audit)

1. **P0 — Freeze an executable CLI contract:** introduce table-driven tests covering every canonical/removed route, positional/flag requirement, default, TTY rule, help leaf, unknown flag, stdout/stderr, JSON, exit code, and destructive classification. Put the focused suite in GitHub Actions.
2. **P0 — Establish one command specification:** make command tree, leaf help, parsing/validation, aliases/tombstones, and docs inventory derive from or validate against one model. Keep handlers separate from presentation.
3. **P0 — Decide target/selector grammar as one breaking-design item:** evaluate parent-scoped instance context versus explicit `--worker/--gateway`; resolve the `workspace add --name` collision (for example, positional/selected Worker context plus `--display-name`). Apply the decision to all role, membership, Workspace, extension, and Doctor commands together.
4. **P1 — Define interaction and risk policy:** classify read/mutate/revoke/delete/install/credential operations; specify which require review/confirm interactively and how scripts opt in. Standardize cancellation and exit codes.
5. **P1 — Define the Access vocabulary:** make Access Profiles/Custom authoritative in product language; isolate or deprecate the legacy capability ceiling without changing security semantics.
6. **P1 — Build shared TUI design tokens/primitives:** width-aware wrapping/truncation, continuation indentation, focus/selected/disabled/error states, glyph fallback, hints, summaries, review screens, and no-color/CI behavior. Validate at representative widths and Windows terminals before choosing replacement glyphs.
7. **P1 — Close credential/output contracts:** masked/default input rules, CLI-argument exposure warnings, clipboard success/failure reporting, redaction, JSON schemas, and stdout/stderr separation.
8. **P2 — Reconcile living documentation:** update README, Workspace docs, demos, and current runbooks from the frozen contract; label historical validations as non-current where needed. Do not alter their historical evidence.
9. **P2 — Only then integrate product-level setup:** decide transaction/rollback/resume semantics for Gateway + Worker + Workspace + enrollment. Add it to the public specification only after end-to-end TDD and docs are ready.

## Audit decision on the two reported issues

- **Redundant `--worker`:** yes, it is inconsistent and should be redesigned as part of the complete selector grammar. Removing only this flag now would collide with Workspace `--name`, diverge nested commands, and break scripts.
- **`[x]` in multi-select:** it correctly communicates persistent selection; it is not the focus cursor. The observed ambiguity is valid and comes from the combined renderer (focus marker, colors, multiline descriptions, wrapping). Keep the semantics independent and choose any glyph change only after width/accessibility/no-color terminal testing across all multi-selects.
