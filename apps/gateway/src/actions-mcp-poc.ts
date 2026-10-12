import type { GitHubActionsRuntimeCoordinator } from "@queqiao/runtime-provider-github-actions";
import type { MembershipWorkerRegistry } from "./worker-membership-registry.js";

export type RuntimeCoordinatorPort = Pick<GitHubActionsRuntimeCoordinator, "provision" | "get" | "complete" | "fail">;
export type RuntimeWorkerPort = Pick<MembershipWorkerRegistry, "current">;

const EXPECTED_MARKER = "QUEQIAO-GITHUB-CONNECTOR-OK";
const POC_WORKSPACE = "runtime";
const POC_FILE = "poc-marker.txt";
const POC_TTL_SECONDS = 180;
const MAX_POC_RUNS_PER_GATEWAY = 3;

type ActiveRun = {
  principalId: string;
  leaseId: string;
  environmentId: string;
  runId: string;
};

/**
 * An opt-in, single-tenant acceptance bridge. It never accepts arbitrary
 * workspace paths, environment IDs, shell commands, or runtime provider args
 * from an MCP client. Production Gateways must keep this disabled.
 */
export class ActionsMcpPoc {
  private active: ActiveRun | undefined;
  private provisioning = false;
  private finishing = false;
  private runs = 0;

  constructor(
    private readonly coordinator: RuntimeCoordinatorPort,
    private readonly workers: RuntimeWorkerPort,
  ) {}

  async start(principalId: string) {
    if (!principalId) throw new Error("OAuth client identity is required");
    if (this.provisioning || this.finishing) throw new Error("Runtime operation in progress");
    if (this.active && this.coordinator.get(this.active.leaseId)?.state !== "disposed") {
      throw new Error("An Actions runtime is already active");
    }
    if (this.runs >= MAX_POC_RUNS_PER_GATEWAY) throw new Error("POC runtime dispatch limit reached");
    this.active = undefined;
    this.provisioning = true;
    this.runs++;
    try {
      const lease = await this.coordinator.provision({
        ttlSeconds: POC_TTL_SECONDS,
        metadata: { purpose: "chatgpt-gate-c-poc" },
      });
      const environmentId = lease.providerMetadata?.["environmentId"];
      const runId = lease.providerMetadata?.["runId"];
      if (!environmentId || !runId) {
        await this.coordinator.fail(lease.leaseId, "POC provider omitted runtime identity");
        throw new Error("Actions provider did not return a runtime identity");
      }
      this.active = { principalId, leaseId: lease.leaseId, environmentId, runId };
      return { state: lease.state, environmentId, runId };
    } finally {
      this.provisioning = false;
    }
  }

  status(principalId: string) {
    const active = this.requireOwned(principalId);
    const lease = this.coordinator.get(active.leaseId);
    if (!lease) throw new Error("Runtime lease not found");
    return {
      state: lease.state,
      environmentId: active.environmentId,
      runId: active.runId,
      ready: lease.state === "ready",
    };
  }

  async readMarker(principalId: string) {
    const active = this.requireOwned(principalId);
    if (this.finishing) throw new Error("Runtime operation in progress");
    const lease = this.coordinator.get(active.leaseId);
    if (!lease) throw new Error("Runtime lease not found");
    if (lease.state !== "ready") return { state: lease.state, ready: false };
    this.finishing = true;
    let disposed = false;
    try {
      const worker = await this.workers.current();
      await worker.requireTool(POC_WORKSPACE, "read_file", active.environmentId);
      const routed = await worker.readFile({
        workspaceId: POC_WORKSPACE,
        environmentId: active.environmentId,
        path: POC_FILE,
        offset: 0,
        limit: 1,
      });
      if (routed.routing.environmentId !== active.environmentId) {
        throw new Error("Worker routing environment mismatch");
      }
      if (routed.value.path !== POC_FILE || routed.value.text.trim() !== EXPECTED_MARKER) {
        throw new Error("Actions Worker marker validation failed");
      }
      const completed = await this.coordinator.complete(active.leaseId);
      if (completed.state !== "disposed") throw new Error("Actions Worker lease was not disposed");
      disposed = true;
      return {
        marker: EXPECTED_MARKER,
        state: completed.state,
        environmentId: active.environmentId,
        runId: active.runId,
        routing: routed.routing,
      };
    } catch (error) {
      try {
        const failed = await this.coordinator.fail(active.leaseId, "MCP POC read or validation failed");
        disposed = failed.state === "disposed";
      } catch {
        // Preserve the active lease for operator retry / TTL expiry if disposal fails.
      }
      throw error;
    } finally {
      if (disposed) this.active = undefined;
      this.finishing = false;
    }
  }

  async cancel(principalId: string) {
    const active = this.requireOwned(principalId);
    if (this.provisioning || this.finishing) throw new Error("Runtime operation in progress");
    const ended = await this.coordinator.fail(active.leaseId, "MCP POC cancelled by authenticated client");
    if (ended.state !== "disposed") throw new Error("Actions Worker lease was not disposed");
    this.active = undefined;
    return { state: ended.state };
  }

  private requireOwned(principalId: string): ActiveRun {
    if (!principalId || this.active?.principalId !== principalId) {
      throw new Error("Runtime lease not found");
    }
    return this.active;
  }
}
