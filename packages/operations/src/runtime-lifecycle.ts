export type RuntimeLifecycleRole = "gateway" | "worker";
export type RuntimeReadinessState = "ready" | "needs_setup" | "needs_workspace";
export type RuntimeHealthState = "healthy" | "degraded" | "identity_conflict" | "offline";
export type RuntimeOwnershipState = "managed" | "unmanaged" | "none";

export type RuntimeLifecycleProjection = {
  apiVersion: 1;
  role: RuntimeLifecycleRole;
  name: string;
  readiness: { state: RuntimeReadinessState; reason?: string };
  health: {
    state: RuntimeHealthState;
    reachable: boolean;
    healthy: boolean;
    identityMatches: boolean;
    status?: number;
    error?: string;
    probedAt: string;
  };
  ownership: { state: RuntimeOwnershipState; pid?: number };
  endpoint?: { url: string; port: number };
  actions: {
    start: boolean;
    stop: boolean;
    restart: boolean;
    setup: boolean;
    addWorkspace: boolean;
    inspectConflict: boolean;
  };
};

export type RuntimeLifecycleObservation = {
  role: RuntimeLifecycleRole;
  name: string;
  configured: boolean;
  workspaceReady?: boolean;
  reachable: boolean;
  healthy: boolean;
  identityMatches: boolean;
  identityConflict?: boolean;
  status?: number;
  error?: string;
  managedPid?: number;
  endpoint?: { url: string; port: number };
  probedAt?: string;
};

export function buildRuntimeLifecycleProjection(observation: RuntimeLifecycleObservation): RuntimeLifecycleProjection {
  const readiness: RuntimeLifecycleProjection["readiness"] = !observation.configured
    ? { state: "needs_setup", reason: `${observation.role} configuration is required` }
    : observation.role === "worker" && observation.workspaceReady === false
      ? { state: "needs_workspace", reason: "Worker requires a default Workspace before serving" }
      : { state: "ready" };

  const healthState: RuntimeHealthState = !observation.reachable
    ? "offline"
    : observation.identityConflict
      ? "identity_conflict"
      : observation.healthy && observation.identityMatches
        ? "healthy"
        : "degraded";

  const ownershipState: RuntimeOwnershipState = observation.managedPid
    ? "managed"
    : healthState === "healthy"
      ? "unmanaged"
      : "none";

  const canStart = readiness.state === "ready" && healthState === "offline" && ownershipState === "none";
  const canControlManaged = ownershipState === "managed" && healthState !== "identity_conflict";

  return {
    apiVersion: 1,
    role: observation.role,
    name: observation.name,
    readiness,
    health: {
      state: healthState,
      reachable: observation.reachable,
      healthy: observation.healthy,
      identityMatches: observation.identityMatches,
      ...(observation.status === undefined ? {} : { status: observation.status }),
      ...(observation.error ? { error: observation.error } : {}),
      probedAt: observation.probedAt ?? new Date().toISOString(),
    },
    ownership: {
      state: ownershipState,
      ...(observation.managedPid ? { pid: observation.managedPid } : {}),
    },
    ...(observation.endpoint ? { endpoint: observation.endpoint } : {}),
    actions: {
      start: canStart,
      stop: canControlManaged,
      restart: canControlManaged && healthState === "healthy",
      setup: readiness.state === "needs_setup",
      addWorkspace: readiness.state === "needs_workspace",
      inspectConflict: healthState === "identity_conflict",
    },
  };
}

export interface RuntimeLifecycleSupervisor {
  status(role: RuntimeLifecycleRole, name: string): Promise<RuntimeLifecycleProjection>;
  start(role: RuntimeLifecycleRole, name: string): Promise<unknown>;
  stop(role: RuntimeLifecycleRole, name: string): Promise<unknown>;
  restart(role: RuntimeLifecycleRole, name: string): Promise<unknown>;
}
