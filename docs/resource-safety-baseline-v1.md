# Resource Safety Baseline v1

Queqiao is a long-running control substrate. Its Core runtime must remain lightweight and must not create avoidable host memory pressure, idle CPU churn, or continuous disk writes.

This baseline is a reproducible software-resource contract. It does **not** claim to predict or guarantee the physical lifetime of a particular SSD, HDD, RAM module, CPU, or other device.

## Attribution boundary

Resource accounting is split into two domains:

1. **Queqiao Core** — the Gateway and Worker process IDs themselves.
2. **Authorized child workload** — commands explicitly launched through `run` or `shell`, including build tools, Python applications, media workloads, or other user-authorized processes.

Only Core process memory/CPU/I/O is used for the Queqiao Core budget. A Worker service/cgroup may legitimately contain authorized child workloads and therefore must not be reported as Queqiao Core RAM.

Queqiao continues to bound authorized process execution through its existing timeout, concurrency, output, cancellation, and workspace/command-policy contracts. Resource Safety Baseline v1 does not turn Core into a CPU/GPU/RAM scheduler or a durable process manager.

## Required pull-request and main-branch gate

`.github/workflows/resource-safety.yml` runs the packaged npm artifact on Windows and Ubuntu. The harness starts a real Gateway and Worker, measures them against a blank Node.js process on the same runner, executes a bounded request workload, waits for quiescence, and verifies cleanup.

The baseline fails when any of these limits is exceeded:

| Contract | Budget |
| --- | ---: |
| Installed Queqiao package footprint | <= 24 MiB |
| Gateway or Worker resident memory | <= 192 MiB each |
| Gateway or Worker resident overhead vs blank Node | <= 96 MiB each |
| Residual resident growth after baseline workload | <= 32 MiB each |
| Idle CPU over a 5-second window | <= 0.5 CPU seconds each |
| Core idle write I/O over a 5-second window | <= 4096 bytes each |
| Gateway/Worker idle stdout-log growth | 0 bytes |
| Handle/FD growth after baseline workload | <= 16 each |
| Thread growth after baseline workload | <= 4 each |
| Gateway request-log amplification | <= 256 bytes/request |
| Gateway and Worker cleanup | both processes must exit |

The CI measurement intentionally uses resident memory (Windows Working Set / Linux RSS) as the cross-platform gating metric. Windows private memory and Linux process details may be recorded as additional evidence but are not mixed into a cross-platform threshold.

## Scheduled soak

The same workflow runs a larger scheduled/manual soak:

- 50 Gateway requests;
- 1000 Worker requests split into two 500-request phases;
- residual resident growth <= 48 MiB;
- second-phase resident growth <= 24 MiB for each Core process, preventing approximately linear accumulation from being hidden by the total ceiling;
- handle/FD growth <= 24;
- all other idle and cleanup budgets unchanged.

The soak is intended to catch regressions that are too small to be obvious in a short PR gate while keeping execution bounded and suitable for hosted CI. The two-phase check distinguishes normal runtime/heap warm-up from continued accumulation.

## Disk and hardware-safety interpretation

The relevant guarantee is behavioral:

- no continuous Core idle log growth;
- no meaningful continuous Core idle write churn;
- bounded request logging;
- bounded package footprint;
- bounded Core resident-memory overhead and post-load residual growth;
- bounded handles/FDs and threads;
- bounded process lifetime/cleanup.

These properties reduce avoidable pagefile/swap pressure and write amplification caused by Queqiao Core. They cannot guarantee that an explicitly authorized child workload will not consume large RAM, CPU, GPU, or disk resources.

## Operational findings outside the Core budget

Development, Shadow, validation, or obsolete service instances and retained Git worktrees can consume host resources even when current stable Core is healthy. Those are lifecycle/doctor concerns and must be detected separately rather than hidden inside Core measurements.

The baseline therefore forbids conflating:

- Core PID resource usage;
- service/cgroup aggregate resource usage;
- authorized child workload usage;
- development/worktree storage residue.
