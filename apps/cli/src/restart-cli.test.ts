import { describe, expect, it, vi } from "vitest";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { restartManagedRuntimes } from "./restart-cli.js";

function layout(name: string): RuntimeLayout {
  return {
    configDir: `C:\\q\\${name}\\config`,
    dataDir: `C:\\q\\${name}\\data`,
    stateDir: `C:\\q\\${name}\\state`,
    runtimeDir: `C:\\q\\${name}\\run`,
    logDir: `C:\\q\\${name}\\logs`,
    configFile: `C:\\q\\${name}\\config\\config.yaml`,
    secretsDir: `C:\\q\\${name}\\data\\secrets`,
    gatewayStateDir: `C:\\q\\${name}\\state\\gateway`,
  };
}

describe("root restart", () => {
  it("restarts every managed Gateway and Worker while leaving stopped or unmanaged instances alone", async () => {
    const restart = vi.fn(async (_configFile: string, _layout: RuntimeLayout, role: "gateway" | "worker", name: string) => ({ restarted: true, stopped: true, started: true, role, name, pid: 1234 }));
    const result = await restartManagedRuntimes({
      listRoleInstances: async (role) => role === "gateway"
        ? [
            { name: "zero", configured: true, running: true, managed: true },
            { name: "shadow", configured: true, running: false, managed: false },
          ]
        : [
            { name: "windows", configured: true, running: true, managed: true },
            { name: "manual", configured: true, running: true, managed: false },
          ],
      resolveLayout: (_role, name) => layout(name),
      restartRuntime: restart,
    });

    expect(restart.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      ["gateway", "zero"],
      ["worker", "windows"],
    ]);
    expect(result).toMatchObject({
      restartedCount: 2,
      skipped: [
        { role: "gateway", name: "shadow", reason: "stopped" },
        { role: "worker", name: "manual", reason: "unmanaged" },
      ],
    });
  });
});