import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeRuntimeConfig } from "@queqiao/config";

const CANCEL = Symbol("clack:cancel-test");
const cancel = vi.fn();
const intro = vi.fn();
const outro = vi.fn();
const text = vi.fn(async () => CANCEL);

vi.mock("@clack/prompts", () => ({
  cancel,
  intro,
  outro,
  text,
  password: vi.fn(),
  isCancel: (value: unknown) => value === CANCEL,
}));

const { updateWorkerPort } = await import("./enrollment-cli.js");

describe("worker port cancellation context", () => {
  beforeEach(() => {
    cancel.mockClear();
    intro.mockClear();
    outro.mockClear();
    text.mockClear();
  });

  it("reports a Worker port update cancellation instead of a Worker join cancellation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-port-cancel-"));
    const workspace = path.join(root, "workspace");
    const tokenFile = path.join(root, "worker.secret");
    const configFile = path.join(root, "config", "config.yaml");
    await mkdir(workspace, { recursive: true });
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(tokenFile, "x".repeat(43), "utf8");
    await writeFile(configFile, serializeRuntimeConfig({
      version: 1,
      worker: {
        workerId: "11111111-1111-4111-8111-111111111111",
        environmentId: "windows",
        listen: { host: "127.0.0.1", port: 7576 },
        tokenFile,
      },
      workspaces: [{ id: "workspace", displayName: "Workspace", root: workspace, profile: "coding" }],
      extensions: [],
    }), "utf8");

    await expect(updateWorkerPort(configFile, ["worker", "port"])).rejects.toThrow("Worker port update cancelled");
    expect(cancel).toHaveBeenCalledWith("Worker port update cancelled");
  });
});
