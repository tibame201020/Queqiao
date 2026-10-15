# ADR-0017: Gate 3.4 ChatGPT-delegated GitHub publication

- Status: Accepted — owner decision, 2026-10-15
- Issue: #124
- Supersedes: **G3.4/G3.5 publication topology and mandatory Hosted-write-credential assumptions** recorded in the Gate 3 ledger and subsequent PR #179–#181 implementation notes
- Does not supersede: ADR-0016's G3.3 Route B custom-MCP read provider, its original Gateway audit, or its real Hosted PASS evidence

## Decision

The required POC is a **ChatGPT-orchestrated, cloud-Hosted Worker + connected GitHub App** sequence, not an unattended GitHub-writing Gateway. The project owner already connected/authorized the GitHub App for ChatGPT; no additional GitHub App installation, `G34_APP_ID`, `G34_APP_PRIVATE_KEY`, PAT, independent GitHub token or source-repository `GITHUB_TOKEN` is a prerequisite for **this delegated mode**. This does not assert that the ChatGPT-connected GitHub App credential can be used by an Actions runner or a Queqiao Gateway; it cannot be exported/replayed to them.

Authority and responsibilities are deliberately split:

1. Queqiao Hosted Controller/Gateway/ephemeral Worker produce and validate one real authenticated synthetic result and immutable sanitized Worker/Lease/task receipt. Route B `gate3_read_artifact` / `gate3_read_public_head` preserve their **own** original Gateway read evidence. No local user PC dependency for these Hosted workloads.
2. ChatGPT, as interactive orchestrator using its **already connected GitHub App**, performs only the explicitly approved `tibame201020/signal-notes` test-branch creation, exact one synthetic file commit and **one Draft PR**. This is a separate provider/action. Approval must specify an unused date/target, and the supported connected App must actually permit the action; prior read-only consent is not write approval. Neither a model declaration nor a browser UI badge is proof of a provider call.
3. GitHub's original live branch/commit/blob/PR records and exact-head target `content` CI are independently re-read. Link these to the authentic Hosted Worker artifact via fixed run/attempt, task/logical key, date, path and SHA-256. Distinguish verified **target state** from **attribution of the actual GitHub App invocation**; do not invent an OpenAI Compliance Log or a native App execution ID when it is not exposed by the product. An observed supported App invocation/tool result, where provided, plus independently read GitHub state is sufficient as the functional delegated POC witness, but is not a cryptographic product attestation.
4. The current `poc-gate3-delegated-correlation.ts` is a pure strict, fail-closed correlation candidate and always returns `nativeAppExecution=not_established_by_hash_correlation`, `gatewayWriteObserved=false`, `gatePassed=false`. It cannot authenticate caller-supplied records or autonomously mark G3.4 PASS. The future orchestrator must independently obtain both trusted inputs before invoking it and separately evaluate the full evidence ledger.

## G3.4 acceptance under this decision

- One newly approved logical date has one immutable Hosted Controller/Worker/Lease and strictly verified sanitized article/trace with no browser or user data in GitHub or archived receipts.
- One explicitly authorized, actually observed connected GitHub App write sequence for that exact synthetic date/branch/path, with a confirmed outcome or fail-closed uncertain status. One atomic new ref, one added file, one Draft PR. No duplicate target, retry after uncertainty, force-update, `main` mutation, production article, or schedule switch.
- Independent trusted GitHub readback verifies exactly one changed file, complete content SHA-256 and Git blob, base parent, Draft/open PR metadata and **successful required content CI on that exact head SHA**. The preserved source/target evidence shares the same content hash and task/date; G3.3 original Gateway read proof must not be relabelled as the GitHub writer audit.
- Status is **NOT PASSED** until one actual joined (not stitched from unrelated runs) delegated execution and independent readback have been accepted. PR #3 / target CI Run 38668658061 is valid *operator-assisted target-only* historical proof, **not** that joined run. Issue #124 remains OPEN.

## G3.5 and optional alternative

G3.5 verifies the agreed full cloud-delegated flow can finish without an always-on user PC: Hosted Worker, actual ChatGPT-orchestrated connected-App action, exact-commit target CI, independently rechecked receipts and disposed Runtime Lease. The POC may involve an explicit ChatGPT/user interaction; **autonomous GitHub Actions publishing and an unattended 05:00 daily schedule are not inferred or required by G3.4**. If fully unattended publishing is later required, scope/authorize it as a separate feature and prove its own identity, approval and scheduling model.

PR #181's `poc-gate3-draft-provider.ts` and `poc-gate3-draft-service.ts` remain **unregistered and default-disabled**, as optional *Hosted-autonomous-writer* research. Their one-target GitHub App credential prerequisite applies **only to enabling that optional alternative**, not to the primary delegated G3.4 gate. Do not create extra GitHub credentials merely to complete this POC. ADR-0016 remains append-only historical truth for G3.3; this ADR changes no previous run's recorded outcome.

Security: never commit or log user IDs, raw conversations, credentials, private browser/session data, approvals, cookies or personal data. Use sanitized immutable evidence only, with clear provider attribution and no secret-backed CI execution in PR checks.
