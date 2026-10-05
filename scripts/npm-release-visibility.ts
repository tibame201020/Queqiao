import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RegistryProbe = {
  visible: boolean;
  latestMatches: boolean;
  latest?: string;
  status: number;
  error?: string;
};

type WaitOptions = {
  packageName: string;
  version: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  intervalMs?: number;
};

export async function probeNpmRelease(
  packageName: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegistryProbe> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}?queqiao_release_probe=${Date.now()}`;
  try {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) {
      return { visible: false, latestMatches: false, status: response.status, error: `HTTP ${response.status}` };
    }
    const body = await response.json() as {
      versions?: Record<string, unknown>;
      "dist-tags"?: Record<string, string>;
    };
    const visible = Object.prototype.hasOwnProperty.call(body.versions || {}, version);
    const latest = body["dist-tags"]?.latest;
    return {
      visible,
      latestMatches: latest === version,
      ...(latest ? { latest } : {}),
      status: response.status,
    };
  } catch (error) {
    return {
      visible: false,
      latestMatches: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function waitForNpmReleaseVisibility(options: WaitOptions): Promise<RegistryProbe> {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs ?? 600_000;
  const intervalMs = options.intervalMs ?? 10_000;
  const deadline = now() + timeoutMs;
  let last = await probeNpmRelease(options.packageName, options.version, fetchImpl);
  while (!(last.visible && last.latestMatches) && now() < deadline) {
    await sleep(intervalMs);
    last = await probeNpmRelease(options.packageName, options.version, fetchImpl);
  }
  if (last.visible && last.latestMatches) return last;
  throw new Error(
    `npm release ${options.packageName}@${options.version} is not publicly ready after ${timeoutMs}ms ` +
    `(visible=${last.visible}, latest=${last.latest ?? "missing"}, status=${last.status}${last.error ? `, error=${last.error}` : ""})`,
  );
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { name?: string; version?: string };
  const packageName = readArg("--package") || pkg.name;
  const version = readArg("--version") || pkg.version;
  if (!packageName || !version) throw new Error("package name and version are required");
  const existsOnly = process.argv.includes("--exists-only");
  const timeoutMs = Number(readArg("--timeout-ms") || 600_000);
  const intervalMs = Number(readArg("--interval-ms") || 10_000);

  if (existsOnly) {
    const state = await probeNpmRelease(packageName, version);
    console.log(JSON.stringify(state));
    process.exit(state.visible ? 0 : 2);
  }

  const state = await waitForNpmReleaseVisibility({ packageName, version, timeoutMs, intervalMs });
  console.log(JSON.stringify(state));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
