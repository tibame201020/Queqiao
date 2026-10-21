import { describe, expect, it, vi } from "vitest";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { resolveCoreInstallation, updateQueqiao } from "./update-cli.js";
import path from "node:path";
import type { ManagedRuntimeTarget } from "./restart-cli.js";

const testInstall = { prefix: "C:/npm", packageFile: "C:/npm/node_modules/@tibame201020/queqiao/package.json" };
const readVersion = () => "0.9.22";
const targets: ManagedRuntimeTarget[] = [
  { role: "gateway", name: "zero", layout: { configDir: "c", dataDir: "d", stateDir: "s", runtimeDir: "r", logDir: "l", configFile: "g", secretsDir: "x", gatewayStateDir: "gs" } as RuntimeLayout },
  { role: "worker", name: "windows", layout: { configDir: "c2", dataDir: "d2", stateDir: "s2", runtimeDir: "r2", logDir: "l2", configFile: "w", secretsDir: "x2", gatewayStateDir: "gs2" } as RuntimeLayout },
];

describe("update CLI", () => {
  it("resolves the running user-local npm prefix instead of npm's unrelated global prefix", () => {
    const prefix = path.posix.resolve("/home/user/.local");
    const entry = path.posix.join(prefix, "lib", "node_modules", "@tibame201020", "queqiao", "dist", "queqiao.js");
    expect(resolveCoreInstallation(entry, "linux")).toEqual({
      prefix, packageFile: path.posix.join(prefix, "lib", "node_modules", "@tibame201020", "queqiao", "package.json"),
    });
  });
  it("resolves a Windows npm global prefix", () => {
    const prefix = "C:\\npm";
    const entry = path.win32.join(prefix, "node_modules", "@tibame201020", "queqiao", "dist", "queqiao.js");
    expect(resolveCoreInstallation(entry, "win32").prefix).toBe(prefix);
  });

  it("updates core then restarts only the managed runtimes captured before npm replacement", async () => {
    const npmRunner = vi.fn(async () => undefined);
    const snapshot = vi.fn(async () => ({ targets, skipped: [] }));
    const restartTargets = vi.fn(async (received: ManagedRuntimeTarget[]) => ({ restartedCount: received.length, restarted: [], skipped: [] }));
    const extensions = vi.fn(async () => ({ changed: false, updatedCount: 0, updated: [], skipped: [] }));
    const result = await updateQueqiao("C:/hub", {}, { npmRunner, installation: testInstall, readVersion, snapshotManagedRuntimes: snapshot, restartManagedRuntimeTargets: restartTargets, updateNpmExtensions: extensions });
    expect(npmRunner).toHaveBeenCalledWith(["install", "-g", "--prefix", "C:/npm", "@tibame201020/queqiao"]);
    expect(restartTargets).toHaveBeenCalledWith(targets);
    expect(extensions).not.toHaveBeenCalled();
    expect(result).toMatchObject({ core: { version: "0.9.22", prefix: "C:/npm" }, restartedCount: 2 });
  });

  it("does not restart when the core npm update fails", async () => {
    const restartTargets = vi.fn();
    await expect(updateQueqiao("C:/hub", {}, {
      installation: testInstall, readVersion,
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
    const common = { installation: testInstall, readVersion,
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
