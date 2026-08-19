# Secure Agent Substrate Planning Pack

This directory is the local-markdown Wayfinder handoff for the Queqiao secure-agent-substrate effort.

## Artifacts

- [MAP.md](MAP.md) — destination, scope, and low-resolution index of resolved architecture decisions.
- [ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md) — detailed resolutions from the human-in-the-loop architecture grilling.
- [FEATURE-SPECS.md](FEATURE-SPECS.md) — feature-level implementation contracts and acceptance boundaries.
- [TICKETS.md](TICKETS.md) — dependency-ordered delivery backlog and recommended implementation slices.
- [VALIDATION-DELIVERY.md](VALIDATION-DELIVERY.md) — blue/green delivery invariants that preserve the stable collaboration path while candidate builds are verified.

## Current state

The original Secure Agent Substrate implementation map was completed and accepted in the 2026-08-13 release slice. Follow-on Gateway/Worker enrollment, membership, liveness, and named CLI lifecycle work was then implemented under ADR-0011 and validated through the 2026-08-15/19 Shadow acceptance records. The current branch candidate uses Core Manifest Revision 6, Worker Protocol 3.0, and the accepted 17-tool production-like composition when the first-party Git extension is explicitly enabled.

Historical planning and validation files remain intentionally append-only. Use `docs/architecture.md` and `docs/validation/cli-lifecycle-enrollment-shadow-acceptance-2026-08-19.md` for current shipped/candidate behavior; use this Wayfinder pack to understand how the architecture and earlier release slice were derived.
