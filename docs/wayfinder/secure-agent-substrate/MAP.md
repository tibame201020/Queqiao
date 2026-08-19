# Wayfinder Map — Secure Agent Substrate

Status: Original architecture route implemented and release-accepted; retained as the design map for the Secure Agent Substrate. Follow-on Worker enrollment/lifecycle work is governed by ADR-0011 and current validation evidence.

## Destination

Queqiao becomes a production-grade secure agent substrate and remote capability bridge. MCP-capable clients such as ChatGPT, Claude Code, pi integrations, llama.cpp-based clients, and future agents consume one secured remote MCP endpoint while native Workers execute inside authorized Windows, WSL/Linux, and future environments.

Queqiao remains a substrate: it does not become an LLM provider, chat/session runtime, reasoning loop, TUI, prompt engine, or general agent harness.

## Notes

- Domain: production security-sensitive MCP / coding-agent infrastructure.
- Core security invariants remain authoritative: Worker-side authorization, workspace containment, bounded execution, explicit shell permission, externalized runtime config/secrets, and OAuth callback CSP support.
- Public contract stability prevents accidental consumer breakage, but an intentional manifest revision is allowed when the domain contract itself needs to evolve.
- Historical validation evidence must never be rewritten to claim new behavior was previously validated.
- Extension composition and failures must be explainable through CLI diagnostics and the future Dashboard; logs are evidence, not the source of truth for runtime composition.
- The Wayfinder method is planning-first. This map records decisions; implementation work is handed off to FEATURE-SPECS.md and TICKETS.md.

## Decisions so far

- [Product boundary](ARCHITECTURE-DECISIONS.md#d1--product-boundary) — Queqiao is a secure agent substrate / bridge, not another coding-agent runtime.
- [Extension public-tool model](ARCHITECTURE-DECISIONS.md#d2--extension-public-tool-model) — public tools from extensions participate in an explicit deployment manifest.
- [Client protocol boundary](ARCHITECTURE-DECISIONS.md#d3--client-protocol-boundary) — the core is protocol-neutral; MCP is the first-class client adapter.
- [MCP transport](ARCHITECTURE-DECISIONS.md#d4--mcp-transport) — remote HTTP(S) MCP only; no local stdio mode.
- [MCP compatibility](ARCHITECTURE-DECISIONS.md#d5--mcp-compatibility) — maintain a bounded supported revision window.
- [Protocol bounded contexts](ARCHITECTURE-DECISIONS.md#d6--protocol-bounded-contexts) — separate domain contracts, Worker protocol, and MCP adapter responsibilities.
- [Workspace model](ARCHITECTURE-DECISIONS.md#d7--workspace-model) — Workspace is the filesystem/authorization boundary; Repository and Worktree are not Workspace identities.
- [Worktree placement](ARCHITECTURE-DECISIONS.md#d8--worktree-placement) — worktrees must remain inside the parent Workspace authority boundary.
- [Core versus extension authority](ARCHITECTURE-DECISIONS.md#d9--core-versus-extension-authority) — Core owns authority-bearing primitives; extensions own domain semantics.
- [Extension composition](ARCHITECTURE-DECISIONS.md#d10--extension-composition) — extensions may register, extend, or explicitly replace tools.
- [Extension ordering](ARCHITECTURE-DECISIONS.md#d11--extension-ordering-and-conflicts) — deterministic dependency DAG; unique replacement ownership; conflicts fail closed and are diagnosable.
- [Extension loading/scope](ARCHITECTURE-DECISIONS.md#d12--extension-loading-and-scope) — explicit install with host binding and scoped activation.
- [Extension trust](ARCHITECTURE-DECISIONS.md#d13--extension-trust) — trusted local in-process TypeScript; package trust is an administrator / future Hub concern, not runtime malware adjudication.
- [Manifest lifecycle](ARCHITECTURE-DECISIONS.md#d14--manifest-lifecycle) — Core Manifest Revision plus Deployment Manifest Fingerprint.
- [Discovery boundary](ARCHITECTURE-DECISIONS.md#d15--discovery-boundary) — Core exposes bounded primitives; Git/repository/worktree/AGENTS/skills/project detection belong to extensions/clients.
- [Async execution](ARCHITECTURE-DECISIONS.md#d16--async-execution) — run and shell expose sync | async as modes of the same execution primitives.
- [Execution backend](ARCHITECTURE-DECISIONS.md#d17--execution-backend) — native Worker process runtime; no tmux dependency.
- [Async disconnect semantics](ARCHITECTURE-DECISIONS.md#d18--async-disconnect-semantics) — once accepted, async execution is detached from the initiating MCP request; no Job abstraction or durable recovery.

## Resolved implementation details

Items that were intentionally deferred during architecture planning are now resolved by the implemented release slices:

- MCP compatibility is explicitly bounded to `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`; unknown future revisions fail closed.
- Extension installation/host binding/scope/order/replacement configuration is explicit and validated; trusted local modules do not load implicitly from Workspace content.
- Deployment-manifest canonicalization/fingerprinting is implemented and exposed through safe deployment attestation.
- `run` / `shell` async semantics are implemented as bounded native-process modes without a durable Queqiao Job domain.
- The first-party Git extension exposes seven named public tools and keeps repository/worktree semantics inside an authorized Workspace.

The future Dashboard implementation technology and UI composition remain intentionally unspecified; only its operations/diagnostics contract is part of this architecture pack.

## Out of scope

- LLM/model provider management.
- Chat history, session trees, context compaction, prompt management, reasoning loops, sub-agent scheduling, and TUI.
- Local stdio MCP transport.
- A universal arbitrary-protocol adapter framework before a second real protocol justifies it.
- Automatic execution of repository-supplied extensions.
- Extension sandboxing / isolated extension process host in v1.
- Extension marketplace / Hub implementation or runtime malware scanning.
- Durable distributed job queue, Worker-restart process recovery, or tmux as a Core execution backend.
