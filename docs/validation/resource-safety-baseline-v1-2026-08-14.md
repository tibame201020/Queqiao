# Resource Safety Baseline v1 — Stable Audit Evidence — 2026-08-14

## Scope

This evidence records the read-only resource audit performed against the current stable Queqiao deployment before Resource Safety Baseline v1 was implemented. It is empirical host evidence, not a claim that the same absolute numbers apply to every machine.

No public MCP schema, Worker protocol, runtime policy, or authorization behavior was changed during the audit.

## Stable Core footprint

Observed steady-state Core process values were approximately:

| Component | Resident / Working Set | Additional observed metric |
| --- | ---: | ---: |
| Windows Gateway | ~68 MiB | ~106 MiB private |
| Windows Worker | ~48 MiB | ~72 MiB private |
| WSL/Linux Worker | ~96–98 MiB RSS | ~85 MiB PSS |
| Blank Node reference — Windows | ~43 MiB | reference only |
| Blank Node reference — WSL/Linux | ~58 MiB RSS | reference only |

The Windows Worker was therefore close to the blank Node working-set baseline. The WSL/Linux Worker showed a larger but still bounded runtime overhead.

The installed production runtime footprint was approximately 5.6 MiB per environment.

## Idle behavior

A five-second Windows Core sample observed:

- Gateway CPU: 0%;
- Worker CPU: 0%;
- Gateway read/write transfer delta: 0 KiB / 0 KiB;
- Worker read/write transfer delta: 0 KiB / 0 KiB;
- no thread growth;
- no sustained handle growth.

A longer 15-second Windows observation recorded:

- Gateway CPU-time delta: 0 seconds;
- Gateway stdout-log growth: 0 bytes;
- Gateway threads unchanged;
- Worker CPU-time delta approximately 0.016 seconds while the measuring request itself was active;
- Worker thread count unchanged;
- handle counts fluctuating only by one descriptor during measurement.

A production WSL/Linux Worker single-request I/O delta check recorded zero parent-process read/write bytes for the bounded observation window and zero Worker Core swap at the time of the Core measurement.

## Bounded request behavior

A bounded local Gateway health workload attempted 100 requests. The configured rate limiter rejected excess requests instead of allowing unbounded processing.

The observed Gateway deltas were approximately:

- CPU time: +0.047 seconds;
- private memory: +0.28 MiB;
- log growth: ~8.6 KiB total, approximately 86 bytes per request attempt;
- no thread growth;
- transient handle growth returned close to the pre-load value after quiescence.

A subsequent mixed stable workload left Windows Gateway/Worker memory close to the pre-load baseline. The WSL/Linux Worker increased by roughly 1 MiB RSS and remained at zero Core swap in the relevant sample.

No request-accumulation memory leak was established by these observations.

## Important attribution finding

A Worker systemd cgroup was observed with very large aggregate memory because it also contained explicitly authorized long-running child workloads. The Queqiao Worker Core PID itself remained near ~97 MiB RSS.

This is a critical measurement boundary:

> Worker service/cgroup memory is not equivalent to Queqiao Core memory.

Resource Safety Baseline v1 therefore gates only Gateway/Worker Core PIDs and reports authorized child workloads separately. This preserves the product boundary that Queqiao is not a CPU/GPU/RAM scheduler or durable job manager.

## Lifecycle and storage residue findings

The audit also found non-Core host residue from prior development/validation activity:

- obsolete or validation Worker service instances could remain alive after their validation purpose ended;
- retained development worktrees duplicated dependency trees and consumed additional disk space;
- request logging is bounded per request but is not yet a complete long-term rotation/retention policy.

These findings are not evidence of stable Core memory leakage. They are lifecycle/doctor follow-up concerns and should be surfaced by future operational tooling.

## Source audit

Production source inspection found no `setInterval`-based Core polling loop. Gateway health uses an on-demand five-second cache, and Gateway/Worker config hot reload performs request-driven modification-time checks rather than continuous background polling.

No CUDA/NVIDIA-specific Core dependency or code path was found. Queqiao Core has no product requirement to consume GPU resources.

## Automated contract introduced from this evidence

Resource Safety Baseline v1 converts these observations into reproducible Windows/Ubuntu CI checks using the packed npm artifact:

- installed package footprint;
- blank-Node-relative and absolute Core resident memory;
- idle Core CPU;
- idle process write-I/O delta;
- idle stdout-log growth;
- bounded request log amplification;
- post-workload residual resident memory;
- handle/FD and thread growth;
- Gateway/Worker process cleanup.

A scheduled/manual soak executes a larger bounded workload with a slightly larger residual-memory/descriptor allowance while preserving the idle-write and idle-log requirements. Its Worker workload is split into two phases and separately caps second-phase resident growth so normal heap warm-up cannot hide approximately linear accumulation.

## Claim boundary

The CI gate demonstrates software behavior under its measured conditions. It does not predict SSD TBW, HDD mechanical lifetime, RAM-cell lifetime, or the resource behavior of arbitrary user-authorized child commands.

The user-facing guarantee is instead that Queqiao Core is continuously tested not to introduce uncontrolled idle writes, excessive Core memory overhead, unbounded resource growth, or leaked Core processes.
