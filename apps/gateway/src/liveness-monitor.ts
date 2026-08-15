import type { ReloadableWorkerRegistry } from "./worker-registry-config.js";
import type { WorkerLivenessState } from "./worker-registry.js";

export class GatewayLivenessMonitor {
  private timer: NodeJS.Timeout | undefined;
  private probing: Promise<void> | undefined;

  constructor(
    private readonly source: ReloadableWorkerRegistry,
    private readonly intervalMs: number,
  ) {}

  async start(): Promise<void> {
    await this.probeNow();
    this.timer = setInterval(() => { void this.probeNow(); }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async probeNow(): Promise<void> {
    if (this.probing) return this.probing;
    this.probing = (async () => {
      const registry = await this.source.current();
      await registry.probeLiveness();
    })().finally(() => { this.probing = undefined; });
    return this.probing;
  }

  async snapshot(): Promise<WorkerLivenessState[]> {
    return (await this.source.current()).livenessSnapshot();
  }
}
