import { describe, expect, it, vi } from "vitest";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { updateQueqiao } from "./update-cli.js";
import type { ManagedRuntimeTarget } from "./restart-cli.js";

const targets: ManagedRuntimeTarget[] = [
  { role: "gateway", name: "zero", layout: { configDir: "c", dataDir: "d", stateDir: "s", runtimeDir: "r", logDir: "l", configFile: "g", secretsDir: "x", gatewayStateDir: "gs" } as RuntimeLayout },
  { role: "worker", name: "windows", layout: { configDir: "c2", dataDir: "d2", stateDir: "s2", runtimeDir: "r2", logDir: "l2", configFile: "w", secretsDir: "x2", gatewayStateDir: "gs2" } as RuntimeLayout },
];

describe("update CLI", () => {
  it("updates core then restarts only the managed runtimes captured before npm replacement", async () => {
    const npmRunner = vi.fn(async () => undefined);
    const snapshot = vi.fn(async () => ({ targets, skipped: [] }));
    const restartTargets = vi.fn(async (received: ManagedRuntimeTarget[]) => ({ restartedCount: received.length, restarted: [], skipped: [] }));
    const extensions = vi.fn(async () => ({ changed: false, updatedCount: 0, updated: [], skipped: [] }));
    const result = await updateQueqiao("C:/hub", {}, { npmRunner, snapshotManagedRuntimes: snapshot, restartManagedRuntimeTargets: restartTargets, updateNpmExtensions: extensions });
    expect(npmRunner).toHaveBeenCalledWith(["install", "-g", "@tibame201020/queqiao"]);
    expect(restartTargets).toHaveBeenCalledWith(targets);
    expect(extensions).not.toHaveBeenCalled();
    expect(result).toMatchObject({ core: { changed: true }, restartedCount: 2 });
  });

  it("does not restart when the core npm update fails", async () => {
    const restartTargets = vi.fn();
    await expect(updateQueqiao("C:/hub", {}, {
      npmRunner: async () => { throw new Error("npm failed"); },
      snapshotManagedRuntimes: async () => ({ targets, skipped: [] }),
      restartManagedRuntimeTargets: restartTargets,
      updateNpmExtensions: async () => ({ changed: false, updatedCount: 0, updated: [], skipped: [] }),
    })).rejects.toThrow(/npm failed/);
    expect(restartTargets).not.toHaveBeenCalled();
  });

  it("updates extensions without replacing core, and --all performs extensions then core", async () => {
    const order: string[] = [];
    const npmRunner = vi.fn(async () => { order.push("core"); });
    const extensionUpdate = vi.fn(async (_hub: string, options: { extension?: string }) => { order.push(`extensions:${options.extension || "all"}`); return { changed: true, updatedCount: 1, updated: [], skipped: [] }; });
    const common = {
      npmRunner,
      snapshotManagedRuntimes: async () => ({ targets, skipped: [] }),
      restartManagedRuntimeTargets: async () => ({ restartedCount: 2, restarted: [], skipped: [] }),
      updateNpmExtensions: extensionUpdate,
    };
    await updateQueqiao("C:/hub", { extensions: true }, common);
    expect(npmRunner).not.toHaveBeenCalled();
    expect(order).toEqual(["extensions:all"]);

    order.length = 0; npmRunner.mockClear(); extensionUpdate.mockClear();
    await updateQueqiao("C:/hub", { extension: "dev.queqiao.mcp" }, common);
    expect(order).toEqual(["extensions:dev.queqiao.mcp"]);
    expect(npmRunner).not.toHaveBeenCalled();

    order.length = 0; npmRunner.mockClear(); extensionUpdate.mockClear();
    await updateQueqiao("C:/hub", { all: true }, common);
    expect(order).toEqual(["extensions:all", "core"]);
    expect(npmRunner).toHaveBeenCalledTimes(1);
  });
});
