# Deployment manifest diagnostics and fingerprint validation — 2026-08-13

## Scope

This validation covers the shared Core public manifest contract, bounded MCP compatibility metadata, deterministic Deployment Manifest Fingerprint, composition diagnostics, CLI operational commands, and Dashboard-ready operations projection.

No public MCP schema was intentionally changed in this slice. Core Manifest Revision remains 4.

## Shared manifest source

`@queqiao/core-manifest` is the single source for the current ten Core public tool contracts: name, title, description, Zod input schema, required capabilities, risk, and MCP annotations. Gateway MCP registration consumes these contracts directly rather than maintaining a duplicate schema list.

`@queqiao/mcp-compat` is the shared source for the explicitly supported MCP protocol window.

`@queqiao/operations` derives deployment manifests, structured composition diagnostics, tool explanations, and fingerprints from those shared sources plus installed extension declarations.

## Deployment Manifest Fingerprint

The fingerprint is `sha256:<hex>` over canonical JSON containing only the effective public contract and Core Manifest Revision.

Fingerprint behavior is deliberately contract-oriented:

- public tool/schema/metadata changes change the fingerprint;
- enabling a public registering extension changes the fingerprint;
- disabled extensions do not participate;
- implementation-only extend/replace composition does not change the fingerprint when the public contract is preserved;
- extension implementation path, extension version, host/Workspace activation scope, and local runtime state do not change the fingerprint when the effective public contract is unchanged;
- invalid composition produces no fingerprint and returns a structured failure diagnostic.

Canonicalization recursively sorts object keys and omits JSON Schema `$schema` metadata.

## MCP schema equivalence

A Gateway vertical-slice test compares the shared Core deployment manifest against the actual official MCP SDK `tools/list` result for name, title, description, input schema, and annotations.

This test exposed an important Zod conversion distinction: default `z.toJSONSchema()` is not equivalent to the MCP SDK's input-side schema representation for fields with defaults. Queqiao therefore canonicalizes runtime input contracts with `z.toJSONSchema(schema, { io: "input" })`.

The resulting shared manifest was verified to match the actual MCP `tools/list` representation.

## Structured operations diagnostics

Diagnostics report:

- Core Manifest Revision;
- Deployment Manifest Fingerprint;
- Worker protocol version;
- bounded MCP protocol versions;
- extension ID/version/host/activation/load observation;
- effective tool registration owner;
- explicit replacement owner;
- extender chain/stage;
- required capabilities and risk;
- structured composition failures including affected tool/extension IDs.

Extension module source paths and local Workspace roots are intentionally absent from the diagnostics contract.

A narrow public projection is separate from the administrative projection and contains only revision, fingerprint, and public tool count.

## CLI and Dashboard readiness

CLI now consumes the same operations contract for:

- `queqiao manifest show`
- `queqiao extension list`
- `queqiao extension doctor`
- `queqiao tool explain <tool>`
- enhanced `queqiao doctor`
- `queqiao permissions show`

A manual CLI smoke used intentionally private-looking test module/root/token paths and verified that these paths were absent from manifest, extension, tool, and doctor output.

The Dashboard consumer test uses the same structured operations function rather than introducing a Dashboard-specific composition/fingerprint engine.

## Gates

- `npm run typecheck` — PASS
- `npm test` — PASS, 25 files / 90 tests
- `npm run test:security` — PASS, 16 files / 64 tests
- `npm run test:cluster` — PASS, 4 files / 13 tests
- `npm run security:gate` — PASS; `npm audit --omit=dev --audit-level=moderate` reports 0 vulnerabilities
- `npm run build:package` — PASS
- `git diff --check` — PASS

No stable Gateway/Worker process and no candidate/shadow runtime was restarted or replaced for this source-level validation.
