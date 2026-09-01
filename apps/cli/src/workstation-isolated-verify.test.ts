import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureWorkstationVerificationFrames, prepareWorkstationVerification } from "../../../scripts/workstation-isolated-verify.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) await cleanup().catch(() => undefined);
  cleanup = undefined;
});

describe("Workstation isolated verification harness", () => {
  it("builds and seeds a disposable runtime without touching repo dist or the user's Queqiao home", async () => {
    const repositoryRoot = path.resolve(process.cwd());
    const repositoryDist = path.join(repositoryRoot, "dist");
    const beforeDistStat = await access(repositoryDist).then(() => true).catch(() => false);
    const session = await prepareWorkstationVerification(repositoryRoot);
    cleanup = session.cleanup;

    expect(path.resolve(session.root).startsWith(path.resolve(os.tmpdir()))).toBe(true);
    expect(path.resolve(session.packageOutdir)).not.toBe(path.resolve(repositoryDist));
    expect(session.env.LOCALAPPDATA).not.toBe(process.env.LOCALAPPDATA);
    expect(session.env.HOME).not.toBe(process.env.HOME);
    expect(session.env.USERPROFILE).not.toBe(process.env.USERPROFILE);
    expect(session.env.XDG_CONFIG_HOME).toBe(path.join(session.root, "xdg", "config"));
    expect(session.env.XDG_DATA_HOME).toBe(path.join(session.root, "xdg", "data"));
    expect(session.env.XDG_STATE_HOME).toBe(path.join(session.root, "xdg", "state"));
    expect(session.env.XDG_RUNTIME_DIR).toBe(path.join(session.root, "xdg", "runtime"));
    expect(await readFile(session.cliEntry, "utf8")).toContain("#!/usr/bin/env node");

    const gateways = JSON.parse((await session.runCli(["gateway", "list", "--json"])).stdout);
    const workers = JSON.parse((await session.runCli(["worker", "list", "--json"])).stdout);
    const workspaces = JSON.parse((await session.runCli(["workspace", "list", "--worker", "verify-worker", "--json"])).stdout);
    const profiles = JSON.parse((await session.runCli(["workspace", "profiles", "list", "--json"])).stdout);
    const extensions = JSON.parse((await session.runCli(["extension", "list", "--json"])).stdout);

    expect(gateways.instances).toEqual([expect.objectContaining({ name: "verify-gateway", running: false })]);
    expect(workers.instances).toEqual([expect.objectContaining({ name: "verify-worker", running: false, workspaceCount: 2 })]);
    expect(workspaces.workspaces).toHaveLength(2);
    expect(profiles.profiles.map((profile: { name: string }) => profile.name)).toContain("verify-profile");
    expect(extensions.extensions).toEqual([expect.objectContaining({ id: "dev.queqiao.workstation-verify" })]);
    expect(await access(repositoryDist).then(() => true).catch(() => false)).toBe(beforeDistStat);
  }, 30_000);

  it("captures responsive Workstation frames from the same disposable runtime", async () => {
    const session = await prepareWorkstationVerification(path.resolve(process.cwd()));
    cleanup = session.cleanup;
    const frames = await captureWorkstationVerificationFrames(session);
    if (process.env.QUEQIAO_WORKSTATION_SMOKE_PRINT === "1") {
      for (const label of ["wide", "standard", "narrow", "too-small", "detailStatus", "detailWorkers", "diagnostics", "settings", "modal"]) {
        console.log(`--- ${label} ---`);
        console.log(frames[label]);
      }
    }
    expect(frames.wide).toContain("RUNTIME");
    expect(frames.wide).toContain("CONTROL");
    expect(frames.wide).toContain("verify-gateway");
    expect(frames.wide).toMatch(/Workers\s+1/);
    expect(frames.wide).toContain("VERIFY");
    expect(frames.standard).not.toContain("CONTROL");
    expect(frames.standard).toContain("INVENTORY");
    expect(frames.standard).toContain("INSPECTOR");
    expect(frames.standard).toMatch(/Probe\s+! degraded · HTTP 503/);
    expect(frames.standard).not.toMatch(/PID\s+\d+raded/);
    expect(frames.detailStatus).toContain("[Status]");
    expect(frames.detailStatus).toMatch(/PID\s+\d+/);
    expect(frames.detailWorkers).toContain("[Workers]");
    expect(frames.detailWorkers).toContain(`127.0.0.1:${session.workerPort}`);
    expect(frames.narrow).toContain("INVENTORY");
    expect(frames.narrow).not.toContain("INSPECTOR");
    expect(frames["too-small"]).toContain("Terminal too small");
    expect(frames.diagnostics).toContain("Core");
    expect(frames.diagnostics).toContain("Routing");
    expect(frames.diagnostics).toContain("[Extensions]");
    expect(frames.diagnostics).toMatch(/Extensions\s+1/);
    expect(frames.diagnostics).toContain("Warnings");
    expect(frames.diagnostics).toContain("verify-gateway");
    expect(frames.diagnostics).toContain("verify-worker");
    expect(frames.diagnostics).not.toContain("Structured Diagnostics remains");
    expect(frames.modal).toContain("CONTROL");
    expect(frames.modal).toContain("INVENTORY");
    expect(frames.settings).toContain("SETTINGS · Appearance");
    expect(frames.settings).toContain("Semantic colors");
    expect(frames.settings).toContain("Select / Focus");
    expect(frames.settings).toContain("Active / Success");
    expect(frames.modal).toContain("INSPECTOR");
    expect(frames.modal).toContain("Remove Gateway unavailable");
    expect(frames.modal).toContain("Stop the Gateway first.");
    expect(frames.modal).toContain("Modal owns input");
    expect(frames.modal).not.toContain("Enter continue");
    const gatewayAfterCapture = JSON.parse((await session.runCli(["gateway", "status", "--gateway", "verify-gateway", "--json"])).stdout);
    expect(gatewayAfterCapture).toMatchObject({ active: false, managed: false });
  }, 30_000);

  it("replaces the retired Shadow refresh entry point with the isolated Workstation verifier", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    expect(packageJson.scripts["dev:workstation:verify"]).toBe("tsx scripts/workstation-isolated-verify.ts");
    expect(packageJson.scripts).not.toHaveProperty("dev:shadow:refresh");

    const script = await readFile(new URL("../../../scripts/workstation-isolated-verify.ts", import.meta.url), "utf8");
    expect(script).toContain("QUEQIAO_BUILD_OUTDIR: packageOutdir");
    expect(script).toContain("LOCALAPPDATA: path.join(root, \"local-app-data\")");
    expect(script).toContain("Stable Queqiao runtime: untouched");
    expect(script).not.toContain("npm link");
    expect(script).not.toContain("Stop-Process");
    expect(script).not.toContain("taskkill");
  });
});
