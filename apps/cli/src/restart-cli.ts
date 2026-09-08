import { resolveRuntimeLayoutForNamedRole, type RuntimeLayout, type RuntimeRole } from "@queqiao/platform-paths";
import { listRoleInstances, type RoleInstanceInventory } from "./instance-selector.js";
import { restartRuntime } from "./service-lifecycle.js";

type RestartResult = Awaited<ReturnType<typeof restartRuntime>>;
type Dependencies = {
  listRoleInstances?: (role: RuntimeRole) => Promise<RoleInstanceInventory[]>;
  resolveLayout?: (role: RuntimeRole, name: string) => RuntimeLayout;
  restartRuntime?: (configFile: string, layout: RuntimeLayout, role: RuntimeRole, name: string) => Promise<RestartResult>;
};

export async function restartManagedRuntimes(dependencies: Dependencies = {}) {
  const list = dependencies.listRoleInstances || listRoleInstances;
  const resolveLayout = dependencies.resolveLayout || ((role: RuntimeRole, name: string) => resolveRuntimeLayoutForNamedRole(role, name));
  const restart = dependencies.restartRuntime || restartRuntime;
  const restarted: RestartResult[] = [];
  const skipped: Array<{ role: RuntimeRole; name: string; reason: "stopped" | "unmanaged" }> = [];

  for (const role of ["gateway", "worker"] as const) {
    for (const instance of await list(role)) {
      if (!instance.configured) continue;
      if (!instance.managed) {
        skipped.push({ role, name: instance.name, reason: instance.running ? "unmanaged" : "stopped" });
        continue;
      }
      const layout = resolveLayout(role, instance.name);
      restarted.push(await restart(layout.configFile, layout, role, instance.name));
    }
  }

  return { restartedCount: restarted.length, restarted, skipped };
}