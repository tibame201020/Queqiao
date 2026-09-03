import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeRuntimeConfig } from "@queqiao/config";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { runRoleSetupWizard, type RoleSetupPrompts } from "./setup-wizard.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
function envFor(root: string): NodeJS.ProcessEnv { return process.platform === "win32" ? { ...process.env, LOCALAPPDATA: root, USERPROFILE: root } : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") }; }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-setup-protocols-")); roots.push(root);
  const env = envFor(root); const layout = resolveRuntimeLayoutForNamedRole("worker", "windows", env, process.platform);
  await mkdir(path.dirname(layout.configFile), { recursive: true }); await mkdir(layout.secretsDir, { recursive: true });
  const workspace = path.join(root, "workspace"); await mkdir(workspace, { recursive: true });
  const local = path.join(layout.secretsDir, "local.secret"); const membership = path.join(layout.secretsDir, "membership.secret");
  await writeFile(local, `${"l".repeat(48)}\n`); await writeFile(membership, `${"m".repeat(48)}\n`);
  await writeFile(layout.configFile, serializeRuntimeConfig({ version: 1, workspaces: [{ id: "default", displayName: "default", root: workspace, profile: "read-only" }], worker: { workerId: "11111111-1111-4111-8111-111111111111", environmentId: "windows", listen: { host: "127.0.0.1", port: 7576 }, tokenFile: local, memberships: [{ gateway: "https://gateway.example/", credentialRef: { kind: "secret-file", path: membership }, protocols: {} }] } }), "utf8");
  return { env, layout };
}

function prompts(selection: string[]): RoleSetupPrompts {
  return {
    choose: async () => "windows",
    multi: async (_message, _choices, initial = []) => initial as any,
    commandText: async () => "",
    text: async (_message, initial = "") => initial,
    protocols: async () => selection,
  };
}

describe("worker setup protocol edit contract", () => {
  it("shows current protocols for an existing membership and does not update when selection is unchanged", async () => {
    const f = await fixture(); const change = vi.fn(); const inspect = vi.fn().mockResolvedValue({ gateway: "https://gateway.example/", enabled: ["http"], offers: [{ type: "http", capable: true }, { type: "grpc", capable: true }] });
    await runRoleSetupWizard("worker", ["worker", "setup"], { env: f.env, platform: process.platform, prompts: prompts(["http"]), portAvailable: async () => true, reconcileWorkerProtocols: async () => ({ gateway: "https://gateway.example/", enabled: ["http"], offers: [{ type: "http", capable: true }, { type: "grpc", capable: true }] }), inspectWorkerProtocols: inspect, changeWorkerProtocols: change });
    expect(inspect).toHaveBeenCalledWith(f.layout.configFile, "https://gateway.example/");
    expect(change).not.toHaveBeenCalled();
  });

  it("updates the membership only when the checkbox selection changes", async () => {
    const f = await fixture(); const change = vi.fn().mockResolvedValue({ updated: true });
    await runRoleSetupWizard("worker", ["worker", "setup"], { env: f.env, platform: process.platform, prompts: prompts(["http", "grpc"]), portAvailable: async () => true, reconcileWorkerProtocols: async () => ({ gateway: "https://gateway.example/", enabled: ["http"], offers: [{ type: "http", capable: true }, { type: "grpc", capable: true, connection: { target: "127.0.0.1:7573", security: "loopback" } }] }), inspectWorkerProtocols: async () => ({ gateway: "https://gateway.example/", enabled: ["http"], offers: [{ type: "http", capable: true }, { type: "grpc", capable: true, connection: { target: "127.0.0.1:7573", security: "loopback" } }] }), changeWorkerProtocols: change });
    expect(change).toHaveBeenCalledWith(f.layout.configFile, "https://gateway.example/", ["http", "grpc"]);
  });
  it("reconciles durable protocol metadata on a port edit but defers protocol selection until the Worker restarts", async () => {
    const f = await fixture();
    const reconcile = vi.fn().mockResolvedValue({ gateway: "https://gateway.example/", enabled: ["http"], offers: [{ type: "http", capable: true }] });
    const inspect = vi.fn();
    const change = vi.fn();
    const driver = prompts(["http"]);
    driver.text = async (message, initial = "") => message.includes("Worker port") ? "7676" : initial;
    await runRoleSetupWizard("worker", ["worker", "setup"], {
      env: f.env, platform: process.platform, prompts: driver, portAvailable: async () => true,
      reconcileWorkerProtocols: reconcile, inspectWorkerProtocols: inspect, changeWorkerProtocols: change,
    });
    expect(reconcile).toHaveBeenCalledWith(f.layout.configFile, "https://gateway.example/");
    expect(inspect).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

});
