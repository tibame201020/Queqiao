import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchDashboard } from "./dashboard-cli.js";

afterEach(() => vi.unstubAllGlobals());

describe("dashboard open CLI", () => {
  it("mints a one-time code with the local management secret and opens a fragment URL without printing the code", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-dashboard-cli-"));
    const stateDirectory = path.join(root, "state");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, "management.secret"), `${"s".repeat(48)}\n`, "utf8");
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, JSON.stringify({
      version: 1,
      gateway: {
        publicBaseUrl: "http://127.0.0.1:7575/",
        listen: { host: "127.0.0.1", port: 7575 },
        managementListen: { host: "127.0.0.1", port: 7574 },
        trustProxyHops: 0,
        stateDirectory,
        approvalSecretFile: path.join(root, "approval.secret"),
        jwtSigningSecretFile: path.join(root, "jwt.secret"),
      },
      workspaces: [],
    }), "utf8");
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-queqiao-management-secret")).toBe("s".repeat(48));
      return new Response(JSON.stringify({ code: "c".repeat(43), expiresAt: "2026-08-26T02:00:00.000Z" }), { status: 201, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    let opened = "";
    const result = await launchDashboard(configFile, [], async (url) => { opened = url; }) as any;
    expect(opened).toBe(`http://127.0.0.1:7574/dashboard/#session=${"c".repeat(43)}`);
    expect(result).toEqual({ opened: true, url: "http://127.0.0.1:7574/dashboard/", expiresAt: "2026-08-26T02:00:00.000Z" });
    expect(JSON.stringify(result)).not.toContain("c".repeat(43));
  });
});
