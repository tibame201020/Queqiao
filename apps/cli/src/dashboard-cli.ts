import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { readRuntimeConfig } from "@queqiao/config";

export type BrowserOpener = (url: string) => Promise<void>;

async function openExternal(url: string): Promise<void> {
  const candidate = process.platform === "win32"
    ? { command: "cmd.exe", args: ["/c", "start", "", url] }
    : process.platform === "darwin"
      ? { command: "open", args: [url] }
      : { command: "xdg-open", args: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(candidate.command, candidate.args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

export async function launchDashboard(configFile: string, args: string[], opener: BrowserOpener = openExternal): Promise<unknown> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.gateway) throw new Error("gateway configuration is required");
  const stateDirectory = path.resolve(runtime.gateway.stateDirectory);
  const secret = (await readFile(path.join(stateDirectory, "management.secret"), "utf8")).trim();
  if (Buffer.byteLength(secret) < 32) throw new Error("Gateway management secret is unavailable; setup the Gateway first");
  const origin = `http://${runtime.gateway.managementListen.host}:${runtime.gateway.managementListen.port}`;
  const response = await fetch(new URL("/v1/dashboard-sessions", origin), {
    method: "POST",
    headers: { "content-type": "application/json", "x-queqiao-management-secret": secret },
    body: "{}",
    signal: AbortSignal.timeout(5000),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${body?.error || "dashboard_session_failed"}: ${body?.message || `HTTP ${response.status}`}`);
  const code = String(body.code || "");
  if (!code) throw new Error("Gateway returned an invalid Dashboard session code");
  const baseUrl = `${origin}/dashboard/`;
  const launchUrl = `${baseUrl}#session=${encodeURIComponent(code)}`;
  if (args.includes("--no-open")) return { opened: false, url: launchUrl, expiresAt: body.expiresAt };
  try {
    await opener(launchUrl);
    return { opened: true, url: baseUrl, expiresAt: body.expiresAt };
  } catch (error) {
    return { opened: false, url: launchUrl, expiresAt: body.expiresAt, openError: error instanceof Error ? error.message : String(error) };
  }
}
