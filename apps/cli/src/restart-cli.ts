import { resolveRuntimeLayoutForNamedRole, type RuntimeLayout, type RuntimeRole } from "@queqiao/platform-paths";
import { listRoleInstances, type RoleInstanceInventory } from "./instance-selector.js";
import { restartRuntime } from "./service-lifecycle.js";

type RestartResult = Awaited<ReturnType<typeof restartRuntime>>;
export type ManagedRuntimeTarget = { role: RuntimeRole; name: string; layout: RuntimeLayout };
type Dependencies = {
  listRoleInstances?: (role: RuntimeRole) => Promise<RoleInstanceInventory[]>;
  resolveLayout?: (role: RuntimeRole, name: string) => RuntimeLayout;
  restartRuntime?: (configFile: string, layout: RuntimeLayout, role: RuntimeRole, name: string) => Promise<RestartResult>;
};

export async function snapshotManagedRuntimes(dependencies: Dependencies = {}) {
  const list = dependencies.listRoleInstances || listRoleInstances;
  const resolveLayout = dependencies.resolveLayout || ((role: RuntimeRole, name: string) => resolveRuntimeLayoutForNamedRole(role, name));
  const targets: ManagedRuntimeTarget[] = [];
  const skipped: Array<{ role: RuntimeRole; name: string; reason: "stopped" | "unmanaged" }> = [];

  for (const role of ["gateway", "worker"] as const) {
    for (const instance of await list(role)) {
      if (!instance.configured) continue;
      if (!instance.managed) {
        skipped.push({ role, name: instance.name, reason: instance.running ? "unmanaged" : "stopped" });
        continue;
      }
      targets.push({ role, name: instance.name, layout: resolveLayout(role, instance.name) });
    }
  }
  return { targets, skipped };
}

export async function restartManagedRuntimeTargets(targets: readonly ManagedRuntimeTarget[], dependencies: Dependencies = {}) {
  const restart = dependencies.restartRuntime || restartRuntime;
  const restarted: RestartResult[] = [];
  const skipped: Array<{ role: RuntimeRole; name: string; reason: "stopped" }> = [];
  for (const target of targets) {
    const result = await restart(target.layout.configFile, target.layout, target.role, target.name);
    if (result.restarted) restarted.push(result);
    else skipped.push({ role: target.role, name: target.name, reason: "stopped" });
  }
  return { restartedCount: restarted.length, restarted, skipped };
}

export async function restartManagedRuntimes(dependencies: Dependencies = {}) {
  const snapshot = await snapshotManagedRuntimes(dependencies);
  const result = await restartManagedRuntimeTargets(snapshot.targets, dependencies);
  return { ...result, skipped: [...snapshot.skipped, ...result.skipped] };
}
