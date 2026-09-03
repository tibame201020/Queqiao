import React from "react";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { prepareWorkstationVerification, type WorkstationVerificationSession } from "./workstation-isolated-verify.js";
import { runRoleSetupWizard, type RoleSetupPrompts } from "../apps/cli/src/setup-wizard.js";
import { collectWorkstationSnapshot, executeWorkstationFlowAction } from "../apps/cli/src/workstation.js";
import { WorkstationApp } from "../apps/cli/src/workstation-ui.js";

const ENV_KEYS = ["LOCALAPPDATA", "USERPROFILE", "HOME", "TEMP", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "QUEQIAO_WORKSTATION_VERIFY"] as const;
const delay = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function setupPrompts(choices: string[], texts: string[]): RoleSetupPrompts {
  return {
    choose: async () => {
      const value = choices.shift();
      if (value === undefined) throw new Error("Unexpected setup choice");
      return value;
    },
    multi: async () => { throw new Error("Unexpected multi prompt"); },
    commandText: async () => { throw new Error("Unexpected command prompt"); },
    text: async (_message, initialValue, validate) => {
      const value = texts.shift() ?? initialValue ?? "";
      const error = validate?.(value);
      if (error) throw new Error(error);
      return value;
    },
  };
}

async function waitForCli(session: WorkstationVerificationSession, args: string[], predicate: (value: any) => boolean, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  while (Date.now() < deadline) {
    try {
      last = JSON.parse((await session.runCli(args)).stdout);
      if (predicate(last)) return last;
    } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${args.join(" ")}: ${JSON.stringify(last)}`);
}

async function waitForFrame(getFrame: () => string | undefined, pattern: RegExp, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let frame = "";
  while (Date.now() < deadline) {
    frame = getFrame() || "";
    if (pattern.test(frame)) return frame;
    await delay(100);
  }
  throw new Error(`Timed out waiting for Workstation frame ${pattern}:\n${frame}`);
}

function enterSessionEnv(session: WorkstationVerificationSession): () => void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value = session.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return () => {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
}

async function joinSelectedWorkerThroughInk(
  session: WorkstationVerificationSession,
  workerIndex = 0,
  selection: "all" | "http-only" = "all",
): Promise<{ protocolFrame: string; finalFrame: string }> {
  const restoreEnv = enterSessionEnv(session);
  const snapshot = await collectWorkstationSnapshot();
  const ui = render(<WorkstationApp
    snapshot={snapshot}
    refresh={() => collectWorkstationSnapshot()}
    executeDirect={async () => ({ title: "unused", body: "unused" })}
    executeFlow={(action, prompts) => executeWorkstationFlowAction(action, prompts)}
    onExit={() => undefined}
    refreshIntervalMs={0}
    terminalWidth={100}
    terminalHeight={30}
    verificationEnvironment
  />);
  try {
    ui.stdin.write("2"); await delay();
    for (let index = 0; index < workerIndex; index += 1) { ui.stdin.write("\u001b[B"); await delay(); }
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("g");
    await waitForFrame(ui.lastFrame, /Enrollment source/);
    ui.stdin.write("\r");
    const protocolFrame = await waitForFrame(ui.lastFrame, /Worker protocols/);
    if (selection === "http-only") {
      ui.stdin.write("\u001b[B"); await delay();
      ui.stdin.write(" "); await delay();
    }
    ui.stdin.write("\r");
    const finalFrame = await waitForFrame(ui.lastFrame, /Worker joined Gateway|Cannot join gateway|worker_session_connect_failed/i);
    return { protocolFrame, finalFrame };
  } finally {
    ui.cleanup();
    restoreEnv();
  }
}

async function configureWorkerProtocolsThroughInk(
  session: WorkstationVerificationSession,
  workerIndex = 0,
): Promise<{ protocolFrame: string; finalFrame: string }> {
  const restoreEnv = enterSessionEnv(session);
  const snapshot = await collectWorkstationSnapshot();
  const ui = render(<WorkstationApp
    snapshot={snapshot}
    refresh={() => collectWorkstationSnapshot()}
    executeDirect={async () => ({ title: "unused", body: "unused" })}
    executeFlow={(action, prompts) => executeWorkstationFlowAction(action, prompts)}
    onExit={() => undefined}
    refreshIntervalMs={0}
    terminalWidth={100}
    terminalHeight={30}
    verificationEnvironment
  />);
  try {
    ui.stdin.write("2"); await delay();
    for (let index = 0; index < workerIndex; index += 1) { ui.stdin.write("\u001b[B"); await delay(); }
    ui.stdin.write("\t"); await delay();
    ui.stdin.write("e");
    await waitForFrame(ui.lastFrame, /Worker port/);
    ui.stdin.write("\r");
    const protocolFrame = await waitForFrame(ui.lastFrame, /Protocols/);
    ui.stdin.write("\u001b[B"); await delay();
    ui.stdin.write(" "); await delay();
    ui.stdin.write("\r");
    const finalFrame = await waitForFrame(ui.lastFrame, /Worker configured|Cannot configure|worker_session_connect_failed/i);
    return { protocolFrame, finalFrame };
  } finally {
    ui.cleanup();
    restoreEnv();
  }
}

async function startGatewayAndWorker(session: WorkstationVerificationSession, workerName: string) {
  await session.runCli(["gateway", "serve", "--bg", "--gateway", "verify-gateway", "--json"]);
  await waitForCli(session, ["gateway", "status", "--gateway", "verify-gateway", "--json"], (value) => value.active === true && value.managed === true);
  await session.runCli(["worker", "serve", "--bg", "--worker", workerName, "--json"]);
  await waitForCli(session, ["worker", "status", "--worker", workerName, "--json"], (value) => value.active === true && value.managed === true);
}

describe("Workstation enrollment end-to-end", () => {
  it("selects HTTP during real Ink join, then enables gRPC through real Ink Configure", async () => {
    const session = await prepareWorkstationVerification(path.resolve(process.cwd()));
    const freshName = "zz-fresh-worker";
    try {
      const freshPort = session.workerPort + 20;
      const freshWorkspace = path.join(session.root, "workspaces", "fresh");
      await mkdir(freshWorkspace, { recursive: true });
      await runRoleSetupWizard("worker", ["worker", "setup"], {
        env: session.env,
        platform: process.platform,
        interactive: true,
        prompts: setupPrompts(["__create__", "builtin:reader"], [freshName, String(freshPort), freshWorkspace, "Fresh Workspace"]),
        portAvailable: async () => true,
      });
      await startGatewayAndWorker(session, freshName);

      const joined = await joinSelectedWorkerThroughInk(session, 1, "http-only");
      expect(joined.protocolFrame).toContain("Worker protocols");
      expect(joined.protocolFrame).toMatch(/\[x\] HTTP/);
      expect(joined.protocolFrame).toMatch(/\[x\] gRPC/);
      expect(joined.protocolFrame).toContain("Available");
      expect(joined.finalFrame).toContain("Worker joined Gateway");
      const afterJoin = JSON.parse((await session.runCli(["gateway", "workers", "list", "--gateway", "verify-gateway", "--json"])).stdout);
      const joinedMembership = afterJoin.workers.find((entry: any) => entry.environmentId === freshName);
      expect(joinedMembership).toBeTruthy();
      expect(joinedMembership.transports.map((transport: any) => transport.type).sort()).toEqual(["http"]);

      const configured = await configureWorkerProtocolsThroughInk(session, 1);
      expect(configured.protocolFrame).toMatch(/Protocols/);
      expect(configured.protocolFrame).toMatch(/\[x\] HTTP/);
      expect(configured.protocolFrame).toMatch(/\[ \] gRPC/);
      expect(configured.finalFrame).toContain("Worker configured");
      const afterConfigure = JSON.parse((await session.runCli(["gateway", "workers", "list", "--gateway", "verify-gateway", "--json"])).stdout);
      const configuredMembership = afterConfigure.workers.find((entry: any) => entry.environmentId === freshName);
      expect(configuredMembership.transports.map((transport: any) => transport.type).sort()).toEqual(["grpc", "http"]);
    } finally {
      await session.runCli(["worker", "stop", "--worker", freshName, "--json"]).catch(() => undefined);
      await session.cleanup();
    }
  }, 45_000);

  it("rejoins the same running Worker through Ink after Gateway removal without stale-local blocking", async () => {
    const session = await prepareWorkstationVerification(path.resolve(process.cwd()));
    try {
      await startGatewayAndWorker(session, "verify-worker");
      const before = JSON.parse((await session.runCli(["gateway", "workers", "list", "--gateway", "verify-gateway", "--json"])).stdout);
      const workerId = before.workers[0]?.workerId;
      expect(workerId).toBeTruthy();
      await session.runCli(["gateway", "workers", "remove", "--gateway", "verify-gateway", "--worker-id", workerId, "--json"]);
      const removed = JSON.parse((await session.runCli(["gateway", "workers", "list", "--gateway", "verify-gateway", "--json"])).stdout);
      expect(removed.workers).toEqual([]);

      const rejoined = await joinSelectedWorkerThroughInk(session, 0);
      expect(rejoined.protocolFrame).toContain("Worker protocols");
      expect(rejoined.finalFrame).toContain("Worker joined Gateway");
      const after = JSON.parse((await session.runCli(["gateway", "workers", "list", "--gateway", "verify-gateway", "--json"])).stdout);
      expect(after.workers).toHaveLength(1);
      expect(after.workers[0].workerId).toBe(workerId);
      expect(after.workers[0].transports.map((transport: any) => transport.type).sort()).toEqual(["grpc", "http"]);
    } finally {
      await session.cleanup();
    }
  }, 45_000);
});
