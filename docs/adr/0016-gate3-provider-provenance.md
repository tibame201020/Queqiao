# ADR-0016: Gate 3 L3 provider execution provenance

- Status: Accepted — Route B approved by project owner on 2026-10-14
- Date: 2026-10-14
- Issue: #124
- Scope: approved provider selection only; implementation and hosted L3 still pending
- Prior verified proof: [Hosted Run 38515396065](https://github.com/tibame201020/Queqiao/actions/runs/38515396065), `QG3-38515396065-1`, immutable main `623f326b380ab5bbf34a4ad512261f4ad453909c`, **L1/L2 PASS**, **L3 NOT PROVED**.

## Decision boundary

Route B (Queqiao custom MCP) is selected by explicit owner approval. Keep `G3.3=NOT PASSED` pending implementation and hosted verification; no new credentials or tools are authorized merely by this ADR, and no promotion from an SHA-only UI reply. Native ChatGPT GitHub App and the Queqiao custom MCP are **different execution providers**; one provider's audit event must NOT satisfy native GitHub App L3. G3.4/G3.5 remain outside this change.

### Route A — Native GitHub App (superseded for future G3.3 executions; historical L1/L2 retained)

Official ChatGPT guidance states that app calls are recorded in OpenAI Compliance Logs. The Compliance Platform is available for eligible Enterprise/Edu workspaces with owner/admin-granted workspace-scoped permissions. App activity export fields and coverage vary by app/product/workspace; do **not** assume a GitHub App log provides a public Run Marker or tool result. Sources:
- https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt
- https://help.openai.com/en/articles/9261474-compliance-api-%20forenterprise-customers
- https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-for-plugins-and-apps

**Enable only after all are independently confirmed:** (1) eligible workspace and authorized admin/owner, (2) original GitHub App activity log category for this specific conversation, (3) documented exported fields sufficient to link conversation, `QG3-<run>-<attempt>` (or a supported equivalent), read action, result and immutable workflow SHA, (4) trusted read-only verifier separately authenticates the source and redacts all private content. Do not request an Admin key through chat or put one in a repo. If any criterion is unavailable, keep `L3=not_proved` with explicit reason. The present connected tools expose **no** approved original native-App log producer; current user/workspace compliance entitlement has not been independently established.

### Route B — Queqiao custom MCP (APPROVED provider route; future implementation requires its own CI acceptance)

This can provide **its own** authenticated tool-execution receipt, but does not prove invocation of the native GitHub App. Product support for custom MCP and write actions still depends on the connected workspace, enabled app, permissions, confirmations and execution-environment restrictions. It must never be used to bypass an earlier product refusal.

Code substrate verified at the above main:
- `apps/gateway/src/app.ts`: authenticated `/mcp` route and OAuth claims.
- `apps/gateway/src/mcp-adapter.ts`: routes authenticated tool requests through `createMcpServer`, with cancellation leases. There is no Gate 3 same-task provider execution receipt on this boundary today.
- `apps/gateway/src/mcp.ts`: explicitly opt-in Actions POC tools, with access bound to authenticated principal. That is not a target GitHub publishing permission.
- `packages/audit/src/index.ts`: `AuditSink` / `AuditLogStore` with redaction and local rotating JSONL (default 30-day expiry). The per-run ephemeral local audit file is neither an independently retained CI artifact nor proof of a native-App call.
- `apps/gateway/src/poc-gate3-worker-receipt.ts`: independently validates routed Worker/environment + immutable content trace, but explicitly stops before Connector invocation.
- `apps/gateway/src/poc-gate3-worker-completion.ts`: controller completion still sets `connector:"not_observed"`.

**Approved implementation scope (subsequent PRs, fail-closed):** add a single allowlisted read-only custom MCP tool with a server-originated `queqiao.gate3.connector-execution.v1` receipt: authenticated provider and principal binding (non-identifying hash), controller/worker run IDs and attempts, lease/environment/task/logical key, tool/action/repository, request and result SHA-256, provider event ID, outcome, and trusted event/artifact linkage. Bind the authenticated request to the expected same-task context; never trust client-supplied `verified` or blindly sign a browser/model claim. Atomically record tool completion or failure with idempotency before marking `connector=observed`; store a sanitized durable artifact independently re-fetched/verified against actual GitHub state. Do not infer a write from a read. A later separate test-branch write proposal would need its own approved permissions and Gate 3.4 specification.

## Acceptance and rejection

- For **Route A**, only an authenticated and independently matched original product-App execution record is an L3 candidate. `connector-l3-evidence.ts` produces at most `candidate_for_independent_review`, never automatic success.
- For **Route B**, a Queqiao-controlled provider receipt must have an actual server-side tool execution, same-task binding, durable independent witness, and explicit `provider=queqiao_custom_mcp`. It must NOT satisfy native GitHub App L3; this ADR records the explicit approved change to Gate 3 topology. Native App L1/L2 historical evidence cannot be used as custom MCP execution evidence.
- Reject: UI App badge; correct public SHA; another chat's GitHub tool response; GitHub API result fetched independently of the user turn; a bare audit event without authenticated action/result; events from a different Run/attempt/Worker/lease; raw browser intercept/private ChatGPT API; replayed cookies, PAT or Compliance secrets.
- No session, personal identifiers, credentials or raw conversations may enter the repo, workflow log or public artifact. Fail closed on unsupported log access, incomplete response, cancellation, duplicate invocation or an uncertain state.

## Required next decision

**Selected B: Queqiao custom MCP.** First restore Windows Adversarial #170 without weakening CI. Then implement server-originated read-only receipt using the existing authenticated Gateway/Worker and audit foundations with strict same-task binding, independent durable witness and TDD; only a real hosted execution may promote custom MCP L3. Confirm product support, existing installed-app permissions and authorized control-plane capability before performing an in-ChatGPT invocation. Never claim native GitHub App L3. Leave Issue #124 open until G3.3–G3.5 hosted gates pass.
