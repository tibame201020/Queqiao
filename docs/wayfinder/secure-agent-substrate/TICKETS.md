# Dependency-Ordered Delivery Tickets — Secure Agent Substrate

This is the implementation backlog handed off from the resolved Wayfinder map. Ticket names are the stable human-readable identity in this local-markdown tracker. Categories are `ARCH`, `RESEARCH`, `FEATURE`, `MIGRATION`, `SECURITY`, and `VALIDATION`.

## Dependency graph

```text
Architecture handoff
├─ Protocol bounded-context split
│  ├─ MCP compatibility research
│  │  └─ MCP adapter compatibility implementation
│  └─ Extension config + manifest schema
│     └─ Extension composition resolver
│        ├─ Extension host loader + scoped activation
│        ├─ Extension authority adversarial gate
│        ├─ Composition diagnostics model
│        │  ├─ Deployment manifest fingerprint
│        │  │  └─ CLI manifest/extension/tool diagnostics
│        │  └─ Dashboard-ready operations contract
│        └─ Extension Core capability API
│           └─ Git extension read/discovery baseline
│              └─ Git contained-worktree lifecycle
│                 └─ Git extension security/acceptance gate
│
├─ Native process runtime async refactor
│  └─ run/shell sync|async Core Manifest revision
│     └─ Async disconnect/resource security gate
│        └─ New-manifest ChatGPT acceptance
│
└─ Workspace authority migration
   └───────────────────────────────┘ (required before Git extension final acceptance)

MCP adapter compatibility implementation
└─ Generic MCP client interoperability matrix

All production/distribution changes
└─ Release/package/security verification
```

Tickets at the same indentation/branch may proceed in parallel once their dependencies are satisfied.

---

## Phase -1 — Delivery and validation lane

### Shadow-stack / blue-green validation lane

**Category:** VALIDATION, SECURITY
**Depends on:** none
**Feature:** all

Establish the additive shadow runtime described in `VALIDATION-DELIVERY.md` before candidate package builds are used for real-client acceptance. The purpose is to preserve the stable Queqiao collaboration/recovery path while a complete candidate Gateway + native Worker stack is validated on the same machine.

**Acceptance**

- stable and shadow Gateways run concurrently on distinct ports;
- stable and shadow Windows Workers run concurrently on distinct ports;
- stable and shadow WSL/Linux Workers run concurrently on distinct ports;
- shadow config/state/secrets/logs are external and isolated from stable runtime state;
- the stable public route remains healthy while an additive shadow public route is enabled;
- a real MCP call through the existing stable ChatGPT connector succeeds after the public-route change;
- a separate shadow ChatGPT connector completes OAuth, schema discovery, and a bounded invocation without modifying the stable connector;
- shadow teardown/replacement can occur without stopping/restarting the stable stack;
- candidate implementation/build output is produced from a physically separate Git worktree rather than the repository path used by the stable runtime.

**Current evidence**

`docs/validation/shadow-stack-preflight-2026-08-13.md` records PASS for parallel stable/shadow Windows+WSL runtime isolation, additive public routing, and post-change stable connector availability.

`docs/validation/worktree-shadow-bundle-preflight-2026-08-13.md` records PASS for physical worktree/build isolation, required baseline checks, shadow-only bundle replacement, and post-replacement stable connector availability.

The separate Shadow ChatGPT connector binding is complete. `docs/validation/final-chatgpt-shadow-acceptance-2026-08-13.md` records the final 16-gate ChatGPT acceptance as PASS / ACCEPT with all 17 frozen public tools invoked across Windows and WSL.

---

## Phase 0 — Architecture handoff

### Architecture handoff into ADRs

**Category:** ARCH
**Depends on:** none
**Feature:** all

Translate the resolved Wayfinder decisions into the repository's permanent architecture records without rewriting historical validation evidence. Prefer a small set of cohesive ADRs rather than one ADR per conversational decision.

**Acceptance**

- ADRs cover protocol boundaries, extension composition/trust/manifest semantics, Workspace authority/discovery boundary, and async execution semantics.
- `docs/architecture.md` no longer describes implemented packages as future modules where that is stale.
- Existing frozen Revision 4 and Security Baseline evidence remains unchanged.

---

## Phase 1 — Protocol and extension foundations

### Protocol bounded-context split

**Category:** ARCH
**Depends on:** Architecture handoff into ADRs
**Feature:** F1

Refactor the current mixed `packages/protocol` responsibility into transport-neutral contracts and an explicitly versioned Gateway↔Worker protocol boundary. Establish the package/module boundary that the MCP adapter will consume.

**Acceptance**

- Worker hello/capability/invocation contracts have a clear Worker Protocol Version owner.
- transport-neutral Core contracts do not import MCP SDK types.
- Gateway/Worker contract tests pass.
- no public MCP behavior change is introduced by this ticket alone.

### MCP compatibility-window research

**Category:** RESEARCH
**Depends on:** Protocol bounded-context split
**Feature:** F1

Inspect the current MCP specification and TypeScript SDK to choose the exact finite revision window Queqiao will support initially, including migration implications from the repository's current SDK usage.

**Acceptance**

- records exact supported MCP revisions and why;
- records SDK/version requirements and compatibility mechanism;
- identifies any breaking HTTP/auth/session differences relevant to Queqiao;
- produces a test matrix consumed by the next ticket.

**Resolved evidence**

`docs/research/mcp-compatibility-window-2026-08-13.md` selects the explicit initial window `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`; excludes the deprecated 2024 HTTP+SSE transport revisions; requires migration from `@modelcontextprotocol/sdk@1.30.0` to the stable v2 split packages for current-spec support; and defines the positive/negative adapter test matrix plus OAuth/Origin compatibility checks.

### MCP adapter compatibility implementation

**Category:** FEATURE
**Depends on:** MCP compatibility-window research
**Feature:** F1

Isolate MCP-specific server construction, revision compatibility, HTTP transport, manifest mapping, authorization integration, and domain-result conversion behind the MCP adapter boundary.

**Acceptance**

- every selected MCP revision has adapter contract coverage;
- Core/runtime/policy/workspace/process packages remain MCP-independent;
- unsupported revisions fail explicitly rather than being guessed;
- Remote HTTP(S) remains the only supported client transport.

**Resolved evidence**

`docs/validation/mcp-adapter-compatibility-2026-08-13.md` records the exact four-revision v2 adapter matrix, explicit rejection of deprecated/future revisions, OAuth resource and Origin hardening, full repository/security/package gates, public shadow OAuth/MCP acceptance for both legacy and modern eras, and proof that the stable ChatGPT connector remained operational during the shadow Gateway replacement. The separate shadow ChatGPT connector binding remains a blue/green Gate A item rather than being falsely claimed by SDK acceptance.

### Extension config and manifest schema v1

**Category:** FEATURE
**Depends on:** Protocol bounded-context split
**Feature:** F2

Define validated external configuration for installed extensions, semantic version, trusted local source/module, host binding, activation scope, ordering/dependencies, registered public tools, extensions, and explicit replacement declarations.

**Acceptance**

- configuration is validated and atomically loaded through existing config boundaries;
- repository contents cannot implicitly install/enable an extension;
- secrets/live machine identifying data remain outside source control;
- invalid host/scope/manifest declarations fail closed.

### Extension composition resolver

**Category:** FEATURE
**Depends on:** Extension config and manifest schema v1
**Feature:** F2

Evolve `ToolRuntime` from unique registration plus global hooks into deterministic tool composition supporting register, tool-specific extend, and explicit replace.

**Acceptance**

- explicit DAG ordering is deterministic independent of config iteration/load order;
- cycles and missing required dependencies fail closed;
- at most one active replacement resolves per tool/scope;
- duplicate replacements fail closed rather than using priority/load order;
- extension activation rollback remains atomic;
- replacement preserves contract unless a deliberate manifest change declares otherwise.

### Extension host loader and scoped activation

**Category:** FEATURE
**Depends on:** Extension composition resolver
**Feature:** F2

Load explicitly configured trusted TypeScript extensions into their declared Gateway or native Worker host and apply global/selected-Workspace activation scopes.

**Acceptance**

- one production-shaped non-core Gateway/Worker extension activates successfully;
- Workspace A may activate an extension while Workspace B does not;
- public manifest remains deployment-level rather than mutating when Workspace selection changes;
- failed activation leaves no partial tool/hook registration.

### Extension authority adversarial gate

**Category:** SECURITY
**Depends on:** Extension composition resolver, Extension host loader and scoped activation
**Feature:** F2, F4

Prove that extension composition cannot replace or bypass Queqiao's mandatory authority envelope.

**Acceptance**

Adversarial coverage includes at least:

- read-only/editor/coding profile ceilings;
- tool allow/deny/explicit policy;
- path traversal and symlink/junction escape attempts;
- process command/cwd/timeout/concurrency/output limits;
- replacement implementation attempting unauthorized access;
- Gateway extension attempting native Workspace filesystem/process access through forbidden paths.

Add relevant cases to `npm run test:security` / Security Baseline gates rather than a side test that can silently regress.

---

## Phase 2 — Manifest and explainable operations

### Composition diagnostics model

**Category:** FEATURE
**Depends on:** Extension composition resolver, Extension host loader and scoped activation
**Feature:** F3, F8

Create a transport-neutral runtime diagnostics model describing extension installation/loading/activation, host/scope, resolved tool implementation, replacement owner, extender chain/order, and composition failures.

**Acceptance**

- diagnostics are generated from runtime composition truth, not log parsing;
- conflict output names the affected tool/extensions and cause;
- diagnostics have safe/redacted projections suitable for CLI/admin versus public health.

### Deployment manifest fingerprint

**Category:** FEATURE
**Depends on:** Composition diagnostics model
**Feature:** F3

Define deterministic canonicalization of Core public tools plus enabled public-tool extensions and generate the Deployment Manifest Fingerprint.

**Acceptance**

- same semantic manifest yields the same fingerprint regardless of configuration ordering/process restart;
- schema/tool/version changes that affect the public manifest change the fingerprint;
- implementation-only changes that do not alter the public schema do not masquerade as a Core Manifest Revision.

### CLI manifest, extension, tool diagnostics

**Category:** FEATURE
**Depends on:** Deployment manifest fingerprint
**Feature:** F3

Extend CLI operations so operators can inspect composition without log archaeology.

Target command surface may include:

- `queqiao manifest show`
- `queqiao extension list`
- `queqiao extension doctor`
- `queqiao tool explain <tool>`
- richer `queqiao doctor`

Exact spelling may be adjusted for CLI consistency during implementation.

**Acceptance**

- displays Core Manifest Revision, Deployment Manifest Fingerprint, Worker Protocol Version, supported MCP window, extension states/scopes, tool replacement/extender chain, and actionable composition errors;
- secrets and unsafe local details are redacted;
- existing environment health remains available.

### Dashboard-ready operations contract

**Category:** FEATURE
**Depends on:** Composition diagnostics model
**Feature:** F8

Expose/reuse the same diagnostics model for a future authenticated Dashboard without building the frontend yet.

**Acceptance**

- CLI and a test Dashboard consumer can render equivalent semantic state;
- public unauthenticated health remains intentionally narrow/redacted;
- no second Dashboard-specific composition engine exists.

---

## Phase 3 — Extension capability substrate

### Extension Core capability API

**Category:** FEATURE
**Depends on:** Extension composition resolver, Protocol bounded-context split
**Feature:** F4

Provide extension-facing Core capabilities for bounded Workspace filesystem/process operations while preserving native Worker authorization and containment.

**Acceptance**

- extension code can request bounded list/read/search/mutation/process operations for an authorized Workspace without reimplementing path security;
- capabilities cannot exceed effective Workspace/profile/tool/process policy;
- cancellation, timeout, output limits, concurrency, and containment remain enforced by the native Worker;
- capability metadata is available to activation/composition validation.

---

## Phase 4 — Async execution

### Native process runtime async refactor

**Category:** FEATURE
**Depends on:** Architecture handoff into ADRs
**Feature:** F5

Refactor the existing native process runtime to support both synchronous collect/wait and asynchronous start semantics using native Worker processes. Do not introduce JobManager/JobStore/tmux.

**Acceptance**

- synchronous code path preserves current process-tree termination, minimal environment, limits, and output collection;
- asynchronous start can detach from request cancellation only after successful process acceptance/start;
- async processes remain bounded by Worker concurrency/lifetime/resource policy;
- Windows and POSIX implementations remain native.

### `run` / `shell` sync|async Core Manifest revision

**Category:** FEATURE
**Depends on:** Native process runtime async refactor, Deployment manifest fingerprint
**Feature:** F5

Evolve the public `run` and `shell` contracts to include `mode: sync | async` rather than adding duplicate spawn tools. Define mode-dependent result schemas, timeout semantics, and async stdout/stderr policy.

**Acceptance**

- `mode: sync` preserves frozen Revision 4 behavior semantically;
- `mode: async` returns after successful native process start with process identity/metadata;
- the schema change creates a new Core Manifest Revision and Deployment Manifest Fingerprint;
- Revision 4 historical validation docs remain unchanged.

### Async disconnect and resource security gate

**Category:** SECURITY
**Depends on:** `run` / `shell` sync|async Core Manifest revision
**Feature:** F5

Test the boundary that makes async useful without turning Queqiao into a process/job platform.

**Acceptance**

- aborting a sync MCP request terminates the process tree;
- aborting/disconnecting the initiating request after async acceptance does not terminate the accepted process;
- async process is still subject to configured lifetime/concurrency/resource limits;
- async redirection, if supported, cannot escape the Workspace or bypass write policy;
- Worker restart recovery is not promised/tested as a durability feature.

### New-manifest ChatGPT acceptance

**Category:** VALIDATION
**Depends on:** Async disconnect and resource security gate, CLI manifest, extension, tool diagnostics
**Feature:** F3, F5

Create the required new ChatGPT connector binding for the intentional Core Manifest revision and validate actual tool-schema discovery plus Windows/WSL sync and async behavior.

**Acceptance**

- new connector sees the intended `run`/`shell` schema;
- Windows and WSL native execution pass;
- sync compatibility and async request-detachment behavior are evidenced;
- permission isolation remains enforced;
- new validation evidence is added rather than rewriting Revision 4 evidence.

**Current evidence**

`docs/validation/final-chatgpt-shadow-acceptance-2026-08-13.md` records PASS / ACCEPT for the frozen Revision 6 connector binding: exact 17-tool schema discovery, exact Deployment Manifest Fingerprint, explicit Windows/WSL `workspace_info` routing, sync/async execution, authority negatives, Git read/worktree lifecycle, OAuth persistence, and 17/17 real public-tool invocations.

---

## Phase 5 — Workspace authority migration and Git extension

### Workspace discovery semantic audit

**Category:** MIGRATION
**Depends on:** Architecture handoff into ADRs
**Feature:** F6

Inventory every place where discovery roots, `.git` markers, `workspace discover`, or approval flows assume Workspace == Repository.

**Acceptance**

- code/config/CLI/tests/docs affected by the semantic change are enumerated;
- migration constraints for existing local configuration are documented;
- no implementation change is mixed into the audit ticket.

### Workspace authority-model migration

**Category:** MIGRATION
**Depends on:** Workspace discovery semantic audit
**Feature:** F6

Redesign/deprecate the Git-coupled Workspace discovery/approval flow so Workspace creation is an explicit authority operation independent of repository semantics.

**Acceptance**

- non-Git directory can be a valid explicitly authorized Workspace;
- `.git` is no longer required to establish Workspace authority;
- no migration silently broadens existing authority;
- config writes remain validated/atomic and hot-reload behavior is covered;
- CLI docs clearly distinguish authority management from extension-owned resource discovery.

### Git extension read/discovery baseline

**Category:** FEATURE
**Depends on:** Extension Core capability API, Extension host loader and scoped activation, Workspace authority-model migration
**Feature:** F7

Implement a first-party trusted local Git extension that discovers Git repositories/worktrees inside an authorized Workspace and provides a deliberately small read-oriented tool surface such as status/diff/log/branch discovery.

**Acceptance**

- one broad Workspace may expose zero or multiple repositories;
- repository/worktree identity lives in the Git extension domain, not Core Workspace identity;
- extension uses Core capabilities/authorized process execution rather than bypassing containment;
- activation can be scoped per Workspace;
- public tools appear in Deployment Manifest diagnostics.

### Git contained-worktree lifecycle

**Category:** FEATURE
**Depends on:** Git extension read/discovery baseline
**Feature:** F7

Add worktree create/remove semantics through the Git extension while requiring every target path to remain within the selected Workspace authority boundary.

**Acceptance**

- create/remove works on Windows and WSL/Linux with native Git semantics;
- target outside the Workspace is rejected before/at authoritative Worker containment;
- no implicit Workspace is created for a repository or worktree;
- branch/ref failures leave no misleading Queqiao authority state.

### Git extension security and acceptance gate

**Category:** SECURITY, VALIDATION
**Depends on:** Git contained-worktree lifecycle, Extension authority adversarial gate
**Feature:** F7

Validate the first-party extension as the production proof of the Extension Runtime model.

**Acceptance**

- traversal/symlink/junction/external-worktree attempts fail;
- editor/read-only/coding policy interactions are explicit and tested;
- replacement/extension diagnostics remain correct with Git extension enabled/disabled/scoped;
- Windows and WSL acceptance evidence covers repository discovery and contained worktree lifecycle.

---

## Phase 6 — Cross-client and release verification

### Generic MCP client interoperability matrix

**Category:** VALIDATION
**Depends on:** MCP adapter compatibility implementation, Deployment manifest fingerprint
**Feature:** F1, F3

Prove Queqiao is a general remote MCP substrate rather than a ChatGPT-specific server. Use the standard MCP SDK client plus available real MCP-capable clients where practical. Client-specific workarounds must not leak into Core unless an interoperability defect is demonstrated and documented.

**Acceptance**

- standard MCP SDK client passes supported revision/manifest/tool invocation tests;
- at least one non-ChatGPT real client is validated when available in the environment;
- any client quirk is isolated at the MCP/integration boundary and documented;
- unsupported behavior is reported precisely rather than hidden behind brand-specific branching.

### Release, package, and Security Baseline verification

**Category:** VALIDATION, SECURITY
**Depends on:** all tickets included in the chosen release slice
**Feature:** all

Run the repository's required production checks for the selected slice and review the final diff for security/config leakage.

**Required checks**

```text
npm run typecheck
npm test
npm run test:security
npm run build:package
git diff --check
```

Run `npm run security:gate` for the release/security slice and any additional cluster/compatibility tests introduced by these features.

**Acceptance**

- relevant Windows/Linux CI gates pass;
- package remains self-contained for its supported roles;
- no live runtime config, absolute local paths, Funnel/Tailscale hostnames, Worker/OAuth/approval secrets, generated runtime state, or logs are committed;
- README/architecture/CLI documentation describes the shipped behavior exactly;
- unimplemented future features are not described as current behavior.

---

## Recommended implementation slices

Do not attempt the entire map in one PR. The dependency graph naturally supports these reviewable slices:

1. **Protocol foundations:** Architecture handoff into ADRs → Protocol bounded-context split → MCP compatibility research/adapter.
2. **Extension foundation:** Extension config/schema → composition resolver → host loader → authority gate.
3. **Explainability:** diagnostics model → deployment fingerprint → CLI diagnostics → Dashboard-ready contract.
4. **Extension capabilities:** Core capability API.
5. **Async Core Manifest revision:** process runtime refactor → `run`/`shell` modes → security gate → ChatGPT acceptance.
6. **Workspace/Git:** discovery semantic audit → Workspace migration → Git read baseline → contained worktrees → Git gate.
7. **Interoperability/release:** generic MCP client matrix plus final package/security verification.

Each slice must preserve a usable baseline and must not claim client compatibility until the relevant real-client acceptance has occurred.

---

## Release closure — 2026-08-13

The Secure Agent Substrate Wayfinder implementation map is complete for this release slice.

Final frozen candidate:

- Core Manifest Revision: `6`
- Worker Protocol: `2.0`
- public tools: `17`
- Deployment Manifest Fingerprint: `sha256:68eac0d73d8efea95cfde694b33d44220049fb6180b60657b3d8b6ee0a9d59ad`
- final ChatGPT acceptance: **PASS / ACCEPT**

Release evidence is recorded in `docs/validation/candidate-public-manifest-final-freeze-2026-08-13.md`, `docs/validation/final-package-security-verification-2026-08-13.md`, `docs/validation/generic-mcp-client-interoperability-2026-08-13.md`, and `docs/validation/final-chatgpt-shadow-acceptance-2026-08-13.md`.

No remaining Wayfinder implementation ticket is open in this release slice. Promotion from the accepted Shadow candidate to the stable runtime is an operational release action, not an implementation ticket, and requires an explicit stable-runtime change decision.
