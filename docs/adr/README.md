# Architecture decision records

Architecture decisions are append-only. A later decision supersedes an earlier one
instead of silently rewriting the reason a boundary exists.

- [ADR-0001: Production modular monorepo](0001-production-modular-monorepo.md)
- [ADR-0002: One public Gateway and native Workers](0002-gateway-worker-boundary.md)
- [ADR-0003: Security is independent from OAuth and policy](0003-security-boundary.md)
- [ADR-0004: Minimal tools and a transport-neutral extension runtime](0004-tool-and-extension-runtime.md)
- [ADR-0005: Native process execution without a shell](0005-native-process-runtime.md)
- [ADR-0006: Bounded filesystem discovery tools](0006-bounded-filesystem-discovery.md)
- [ADR-0007: Separate domain contracts, Worker protocol, and MCP adapter](0007-protocol-bounded-contexts.md)
- [ADR-0008: Deterministic extension composition and deployment manifest](0008-extension-composition-and-manifest.md)
- [ADR-0009: Workspace is an authority boundary; discovery semantics belong outside Core](0009-workspace-authority-and-discovery.md)
- [ADR-0010: `run` and `shell` support bounded sync and async execution modes](0010-async-execution-modes.md)
- [ADR-0011: Worker enrollment, registry, liveness, and transport abstraction](0011-gateway-worker-registration-and-transport.md)
- [ADR-0012: Extension Hub owns packages; Workers attach and execute them](0012-extension-hub-and-worker-attachment.md)
