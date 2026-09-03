import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfig } from "@queqiao/config";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { joinWorker } from "../apps/cli/src/enrollment-cli.js";
import { runRoleSetupWizard, type RoleSetupPrompts } from "../apps/cli/src/setup-wizard.js";
import { prepareWorkstationVerification, type WorkstationVerificationSession } from "./workstation-isolated-verify.js";

let session: WorkstationVerificationSession | undefined;
const VERIFY_GATEWAY = "verify-gateway";
const VERIFY_WORKER = "verify-worker";

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last!: T;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for CLI protocol acceptance state: ${JSON.stringify(last)}`);
}

async function startRuntimes(current: WorkstationVerificationSession): Promise<void> {
  await current.runCli(["worker", "serve", "--bg", "--worker", VERIFY_WORKER, "--json"]);
  await waitFor(async () => JSON.parse((await current.runCli(["worker", "status", "--worker", VERIFY_WORKER, "--json"])).stdout), (value) => value.active === true && value.managed === true);
  await current.runCli(["gateway", "serve", "--bg", "--gateway", VERIFY_GATEWAY, "--json"]);
  await waitFor(async () => JSON.parse((await current.runCli(["gateway", "status", "--gateway", VERIFY_GATEWAY, "--json"])).stdout), (value) => value.active === true && value.managed === true && value.health?.reachable === true);
}

function workerConfigFile(current: WorkstationVerificationSession): string {
  return resolveRuntimeLayoutForNamedRole("worker", VERIFY_WORKER, current.env, process.platform).configFile;
}

function gatewayWorkers(current: WorkstationVerificationSession) {
  return current.runCli(["gateway", "workers", "list", "--gateway", VERIFY_GATEWAY, "--json"]).then((result) => JSON.parse(result.stdout));
}

afterEach(async () => {
  if (session) await session.cleanup().catch(() => undefined);
  session = undefined;
});

describe("canonical CLI Worker protocol flow", () => {
  it("discovers/selects protocols during join and re-discovers current enabled protocols during worker setup", async () => {
    session = await prepareWorkstationVerification(path.resolve(process.cwd()));
    await startRuntimes(session);
    const configFile = workerConfigFile(session);
    const runtime = await readRuntimeConfig(configFile);
    const workerId = runtime.worker!.workerId!;

    // Reset the Gateway side only. This intentionally leaves the Worker local membership
    // behind, covering the stale-local reconciliation behavior of a real rejoin.
    await session.runCli(["gateway", "workers", "remove", "--gateway", VERIFY_GATEWAY, "--worker-id", workerId, "--json"]);
    const issued = JSON.parse((await session.runCli(["gateway", "join-token", "--gateway", VERIFY_GATEWAY, "--expires", "60", "--json"])).stdout);
    const joinPrompts: string[] = [];
    await joinWorker(configFile, ["worker", "join", "--worker", VERIFY_WORKER], async (field) => {
      joinPrompts.push(field);
      return field === "code" ? issued.joinCode : "http";
    });
    expect(joinPrompts).toEqual(["code", "protocols"]);
    const afterJoin = await gatewayWorkers(session);
    expect(afterJoin.workers).toHaveLength(1);
    expect(afterJoin.workers[0].transports.map((transport: any) => transport.type)).toEqual(["http"]);

    let protocolPrompt: { message: string; choices: any[]; initial: string[] } | undefined;
    const prompts: RoleSetupPrompts = {
      choose: async (_message, options) => options.find((option) => option.value === VERIFY_WORKER)?.value ?? options[0]!.value,
      text: async (_message, initial = "") => initial,
      multi: async (_message, _options, initialValues) => initialValues,
      commandText: async () => "",
      protocols: async (message, choices, initialValues) => {
        protocolPrompt = { message, choices, initial: [...initialValues] };
        return ["http", "grpc"];
      },
    };
    await runRoleSetupWizard("worker", [], {
      env: session.env,
      platform: process.platform,
      interactive: true,
      prompts,
      portAvailable: async () => true,
    });

    expect(protocolPrompt).toBeDefined();
    expect(protocolPrompt!.initial).toEqual(["http"]);
    expect(protocolPrompt!.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "http", disabled: false }),
      expect.objectContaining({ value: "grpc", disabled: false }),
    ]));
    const afterSetup = await gatewayWorkers(session);
    expect(afterSetup.workers[0].transports.map((transport: any) => transport.type).sort()).toEqual(["grpc", "http"]);
    const persisted = await readRuntimeConfig(configFile);
    expect(persisted.worker!.memberships[0]!.protocols.grpc).toBeDefined();
  }, 35_000);
});
