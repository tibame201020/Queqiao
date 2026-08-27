# Core Manifest Revision 7 — Extension Platform Candidate

Date: 2026-08-27
Status: repository candidate; not yet promoted as stable runtime evidence

## Candidate contract

Revision 7 adds one fixed public Core tool named `extension`. The tool provides stable proxy operations for extension discovery and invocation while the selected Worker remains authoritative for execution and policy.

The extension lifecycle candidate uses an environment-local Extension Hub plus Worker attachments:

- install stores one validated npm package in the local Hub;
- attach means a Worker loads/uses the extension;
- detach removes that Worker attachment;
- there is no separate enabled/disabled state;
- `--attach-all` attaches every compatible local named Worker;
- uninstall refuses while attached unless `--force`, which detaches first.

The Gateway remains exposure/routing only. The Extension Hub is package/control state only and is not part of the invocation path.

## Validation executed

```text
npm run typecheck
npm test
npm run test:security
npm run test:cli-setup
npm run build:package
```

Results at final candidate validation time:

- full test suite: 46 files / 190 tests passed;
- Security Baseline suite: 38 files / 162 tests passed, including the ExtensionHost hot-reload acceptance;
- CLI setup suite: 2 files / 12 tests passed;
- package build passed;
- `git diff --check` passed.

The hot-reload acceptance verifies generation-based atomic swap, request-generation pinning, delayed disposal until the final old-generation lease ends, and last-known-good retention when a newly attached extension imports successfully but fails declared tool-contract activation.

## Connector impact

Revision 7 itself is a public Core manifest change and requires one connector manifest migration. After that migration, proxy-mode extension install/attach/detach/uninstall does not change the public Core schema. Direct public-tool extension contributions remain Deployment Manifest changes and are outside this no-remigration guarantee.
