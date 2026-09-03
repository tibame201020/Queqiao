import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024;
const mode = process.argv.includes("--soak") ? "soak" : "baseline";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportFile = path.resolve(process.env.QUEQIAO_RESOURCE_REPORT || path.join(repoRoot, "resource-safety-report.json"));
const budgets = {
  packageBytes: 24 * MiB,
  absoluteResidentBytes: 192 * MiB,
  relativeResidentBytes: 96 * MiB,
  residualResidentBytes: (mode === "soak" ? 48 : 32) * MiB,
  secondPhaseResidentBytes: 24 * MiB,
  idleCpuSeconds: 0.5,
  idleWriteBytes: 4096,
  idleLogBytes: 0,
  descriptorGrowth: mode === "soak" ? 24 : 16,
  threadGrowth: 4,
  logBytesPerGatewayRequest: 256,
};
const gatewayRequests = mode === "soak" ? 50 : 30;
const workerRequests = mode === "soak" ? 1000 : 200;
const failures = [];
const children = [];
const descriptors = [];
const temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-resource-"));

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const delta = (after, before) => Math.max(0, Number(after || 0) - Number(before || 0));
const mb = (bytes) => Math.round((bytes / MiB) * 100) / 100;
const record = (condition, message) => { if (!condition) failures.push(message); };

async function directorySize(root) {
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += statSync(target).size;
  }
  return total;
}

function powershell(command) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true }).trim();
}

async function sampleProcess(pid) {
  if (process.platform === "win32") {
    const command = `$p=Get-Process -Id ${pid} -ErrorAction Stop; $c=Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\"; [pscustomobject]@{residentBytes=[int64]$p.WorkingSet64;privateBytes=[int64]$p.PrivateMemorySize64;cpuSeconds=[double]$p.CPU;descriptors=[int]$p.HandleCount;threads=[int]$p.Threads.Count;readBytes=[int64]$c.ReadTransferCount;writeBytes=[int64]$c.WriteTransferCount}|ConvertTo-Json -Compress`;
    return JSON.parse(powershell(command));
  }
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const io = readFileSync(`/proc/${pid}/io`, "utf8");
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8").trim().split(/\s+/);
  const ticks = 100;
  const field = (name) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1] || 0);
  const ioField = (name) => Number(io.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1] || 0);
  return {
    residentBytes: field("VmRSS") * 1024,
    privateBytes: 0,
    cpuSeconds: (Number(stat[13] || 0) + Number(stat[14] || 0)) / ticks,
    descriptors: (await readdir(`/proc/${pid}/fd`)).length,
    threads: field("Threads"),
    readBytes: ioField("read_bytes"),
    writeBytes: ioField("write_bytes"),
  };
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function terminate(child) {
  if (!child?.pid || !processExists(child.pid)) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }); } catch { /* already exited */ }
  } else {
    try { process.kill(child.pid, "SIGTERM"); } catch { /* already exited */ }
    for (let i = 0; i < 20 && processExists(child.pid); i += 1) await delay(100);
    if (processExists(child.pid)) try { process.kill(child.pid, "SIGKILL"); } catch { /* already exited */ }
  }
}

async function waitFor(url, expected, headers = {}) {
  let last = "";
  // Keep readiness probing below the production /health budget. The Gateway workload
  // later performs 30 more health requests in the same minute, so reserve headroom.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      last = await response.text();
      if (response.ok && (!expected || last.includes(expected))) return last;
    } catch { /* starting */ }
    await delay(1000);
  }
  throw new Error(`Service did not become ready: ${url}; last=${last.slice(0, 200)}`);
}

function spawnNode(entry, configFile, stdoutFile, stderrFile) {
  const out = openSync(stdoutFile, "a");
  const err = openSync(stderrFile, "a");
  descriptors.push(out, err);
  const child = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    env: { ...process.env, QUEQIAO_CONFIG_FILE: configFile },
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
  children.push(child);
  return child;
}

async function writeReport(report) {
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `## Queqiao Resource Safety ${mode}`,
      "",
      `- Result: **${failures.length ? "FAIL" : "PASS"}**`,
      `- Package footprint: ${report.packageMiB} MiB`,
      `- Blank Node resident: ${report.blankNodeMiB} MiB`,
      `- Gateway resident: ${report.afterWork.gatewayResidentMiB} MiB`,
      `- Worker resident: ${report.afterWork.workerResidentMiB} MiB`,
      `- Idle Gateway/Worker writes: ${report.idle.gatewayWriteBytes}/${report.idle.workerWriteBytes} bytes`,
      `- Idle Gateway log growth: ${report.idle.gatewayLogBytes} bytes`,
      `- Workload: ${gatewayRequests} Gateway + ${workerRequests} Worker requests`,
      `- Failures: ${failures.length ? failures.join("; ") : "none"}`,
      "",
    ];
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
  }
}

let report;
try {
  const blank = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
  children.push(blank);
  await delay(800);
  const blankSample = await sampleProcess(blank.pid);
  await terminate(blank);

  const packDir = path.join(temporary, "pack");
  const installDir = path.join(temporary, "install");
  const dataDir = path.join(temporary, "data");
  const secretsDir = path.join(dataDir, "secrets");
  const workspaceDir = path.join(temporary, "workspace");
  await Promise.all([mkdir(packDir, { recursive: true }), mkdir(installDir, { recursive: true }), mkdir(secretsDir, { recursive: true }), mkdir(workspaceDir, { recursive: true })]);

  const runNpm = (args, options = {}) => {
    const npmCli = process.env.npm_execpath;
    if (npmCli) return execFileSync(process.execPath, [npmCli, ...args], { windowsHide: true, ...options });
    const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
    return execFileSync(npmExecutable, args, { windowsHide: true, shell: process.platform === "win32", ...options });
  };
  const packed = JSON.parse(runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", packDir], { cwd: repoRoot, encoding: "utf8" }));
  const tarball = path.join(packDir, packed[0].filename);
  runNpm(["install", "--prefix", installDir, tarball, "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "pipe" });
  const packageRoot = path.join(installDir, "node_modules", "@tibame201020", "queqiao");
  const packageBytes = await directorySize(packageRoot);
  record(packageBytes <= budgets.packageBytes, `package footprint ${mb(packageBytes)} MiB exceeds ${mb(budgets.packageBytes)} MiB`);

  const gatewayPort = 18755;
  const workerPort = 18756;
  const approvalFile = path.join(secretsDir, "approval.secret");
  const jwtFile = path.join(secretsDir, "jwt.secret");
  const tokenFile = path.join(secretsDir, "worker.secret");
  const membershipFile = path.join(secretsDir, "gateway-membership.secret");
  const configFile = path.join(temporary, "config.yaml");
  const workerId = "11111111-1111-4111-8111-111111111111";
  const workerToken = "resource-baseline-worker-token-at-least-thirty-two-bytes";
  const membershipToken = "resource-baseline-membership-token-at-least-thirty-two-bytes";
  await writeFile(approvalFile, "resource-baseline-approval-secret\n");
  await writeFile(jwtFile, "resource-baseline-jwt-secret-at-least-thirty-two-bytes\n");
  await writeFile(tokenFile, `${workerToken}\n`);
  await writeFile(membershipFile, `${membershipToken}\n`);
  await writeFile(path.join(workspaceDir, "fixture.txt"), "resource baseline fixture\n");
  const config = {
    version: 1,
    gateway: {
      publicBaseUrl: `http://127.0.0.1:${gatewayPort}/`,
      listen: { host: "127.0.0.1", port: gatewayPort },
      managementListen: { host: "127.0.0.1", port: 18754 },
      trustProxyHops: 0,
      stateDirectory: path.join(dataDir, "gateway"),
      approvalSecretFile: approvalFile,
      jwtSigningSecretFile: jwtFile,
      allowedRedirectOrigins: ["https://chatgpt.com", "http://127.0.0.1", "http://localhost"],
    },
    worker: {
      workerId,
      environmentId: "resource-ci",
      listen: { host: "127.0.0.1", port: workerPort },
      tokenFile,
      memberships: [{
        gateway: `http://127.0.0.1:${gatewayPort}/`,
        credentialRef: { kind: "secret-file", path: membershipFile },
        protocols: {},
      }],
    },
    workspaces: [{ id: "fixture", displayName: "Fixture", root: workspaceDir, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] }, stepUp: [] }],
  };
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(dataDir, "gateway"), { recursive: true });
  await writeFile(path.join(dataDir, "gateway", "worker-memberships.json"), `${JSON.stringify({ version: 1, workers: [{ workerId, environmentId: "resource-ci", transports: [{ type: "http", endpoint: `http://127.0.0.1:${workerPort}` }], credentialRefs: [{ kind: "secret-file", path: membershipFile }] }] }, null, 2)}\n`);

  const workerLog = path.join(temporary, "worker.stdout.log");
  const workerErr = path.join(temporary, "worker.stderr.log");
  const gatewayLog = path.join(temporary, "gateway.stdout.log");
  const gatewayErr = path.join(temporary, "gateway.stderr.log");
  const worker = spawnNode(path.join(packageRoot, "dist", "queqiao-worker.js"), configFile, workerLog, workerErr);
  await waitFor(`http://127.0.0.1:${workerPort}/health`, "\"ok\":true");
  const gateway = spawnNode(path.join(packageRoot, "dist", "queqiao-gateway.js"), configFile, gatewayLog, gatewayErr);
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`, "\"reachable\":true");
  await delay(1500);

  const idleStart = { gateway: await sampleProcess(gateway.pid), worker: await sampleProcess(worker.pid), gatewayLog: statSync(gatewayLog).size, workerLog: statSync(workerLog).size };
  await delay(5000);
  const idleEnd = { gateway: await sampleProcess(gateway.pid), worker: await sampleProcess(worker.pid), gatewayLog: statSync(gatewayLog).size, workerLog: statSync(workerLog).size };
  const idle = {
    gatewayCpuSeconds: delta(idleEnd.gateway.cpuSeconds, idleStart.gateway.cpuSeconds),
    workerCpuSeconds: delta(idleEnd.worker.cpuSeconds, idleStart.worker.cpuSeconds),
    gatewayWriteBytes: delta(idleEnd.gateway.writeBytes, idleStart.gateway.writeBytes),
    workerWriteBytes: delta(idleEnd.worker.writeBytes, idleStart.worker.writeBytes),
    gatewayLogBytes: delta(idleEnd.gatewayLog, idleStart.gatewayLog),
    workerLogBytes: delta(idleEnd.workerLog, idleStart.workerLog),
  };
  record(idle.gatewayCpuSeconds <= budgets.idleCpuSeconds, `Gateway idle CPU ${idle.gatewayCpuSeconds}s exceeds ${budgets.idleCpuSeconds}s`);
  record(idle.workerCpuSeconds <= budgets.idleCpuSeconds, `Worker idle CPU ${idle.workerCpuSeconds}s exceeds ${budgets.idleCpuSeconds}s`);
  record(idle.gatewayWriteBytes <= budgets.idleWriteBytes, `Gateway idle write ${idle.gatewayWriteBytes} exceeds ${budgets.idleWriteBytes} bytes`);
  record(idle.workerWriteBytes <= budgets.idleWriteBytes, `Worker idle write ${idle.workerWriteBytes} exceeds ${budgets.idleWriteBytes} bytes`);
  record(idle.gatewayLogBytes <= budgets.idleLogBytes, `Gateway idle log grew by ${idle.gatewayLogBytes} bytes`);
  record(idle.workerLogBytes <= budgets.idleLogBytes, `Worker idle log grew by ${idle.workerLogBytes} bytes`);

  for (const sample of [idleEnd.gateway, idleEnd.worker]) record(sample.residentBytes <= budgets.absoluteResidentBytes, `Core resident ${mb(sample.residentBytes)} MiB exceeds ${mb(budgets.absoluteResidentBytes)} MiB`);
  record(idleEnd.gateway.residentBytes - blankSample.residentBytes <= budgets.relativeResidentBytes, `Gateway resident overhead ${mb(idleEnd.gateway.residentBytes - blankSample.residentBytes)} MiB exceeds ${mb(budgets.relativeResidentBytes)} MiB`);
  record(idleEnd.worker.residentBytes - blankSample.residentBytes <= budgets.relativeResidentBytes, `Worker resident overhead ${mb(idleEnd.worker.residentBytes - blankSample.residentBytes)} MiB exceeds ${mb(budgets.relativeResidentBytes)} MiB`);

  const gatewayLogBeforeWork = statSync(gatewayLog).size;
  for (let i = 0; i < gatewayRequests; i += 1) {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
    record(response.ok, `Gateway workload request ${i + 1} returned ${response.status}`);
    await response.arrayBuffer();
  }
  const runWorkerRequests = async (count, offset = 0) => {
    for (let i = 0; i < count; i += 1) {
      const response = await fetch(`http://127.0.0.1:${workerPort}/health`);
      record(response.ok, `Worker workload request ${offset + i + 1} returned ${response.status}`);
      await response.arrayBuffer();
    }
  };
  const firstWorkerPhase = mode === "soak" ? Math.floor(workerRequests / 2) : workerRequests;
  await runWorkerRequests(firstWorkerPhase);
  let soakMidpoint;
  if (mode === "soak") {
    await delay(2000);
    soakMidpoint = { gateway: await sampleProcess(gateway.pid), worker: await sampleProcess(worker.pid) };
    await runWorkerRequests(workerRequests - firstWorkerPhase, firstWorkerPhase);
  }
  await delay(3000);
  const afterWork = { gateway: await sampleProcess(gateway.pid), worker: await sampleProcess(worker.pid), gatewayLog: statSync(gatewayLog).size };
  const gatewayResidual = afterWork.gateway.residentBytes - idleEnd.gateway.residentBytes;
  const workerResidual = afterWork.worker.residentBytes - idleEnd.worker.residentBytes;
  record(gatewayResidual <= budgets.residualResidentBytes, `Gateway residual resident growth ${mb(gatewayResidual)} MiB exceeds ${mb(budgets.residualResidentBytes)} MiB`);
  record(workerResidual <= budgets.residualResidentBytes, `Worker residual resident growth ${mb(workerResidual)} MiB exceeds ${mb(budgets.residualResidentBytes)} MiB`);
  const secondPhase = soakMidpoint ? {
    gatewayResidentBytes: afterWork.gateway.residentBytes - soakMidpoint.gateway.residentBytes,
    workerResidentBytes: afterWork.worker.residentBytes - soakMidpoint.worker.residentBytes,
  } : undefined;
  if (secondPhase) {
    record(secondPhase.gatewayResidentBytes <= budgets.secondPhaseResidentBytes, `Gateway second-phase resident growth ${mb(secondPhase.gatewayResidentBytes)} MiB exceeds ${mb(budgets.secondPhaseResidentBytes)} MiB`);
    record(secondPhase.workerResidentBytes <= budgets.secondPhaseResidentBytes, `Worker second-phase resident growth ${mb(secondPhase.workerResidentBytes)} MiB exceeds ${mb(budgets.secondPhaseResidentBytes)} MiB`);
  }
  record(afterWork.gateway.descriptors - idleEnd.gateway.descriptors <= budgets.descriptorGrowth, `Gateway descriptor growth ${afterWork.gateway.descriptors - idleEnd.gateway.descriptors} exceeds ${budgets.descriptorGrowth}`);
  record(afterWork.worker.descriptors - idleEnd.worker.descriptors <= budgets.descriptorGrowth, `Worker descriptor growth ${afterWork.worker.descriptors - idleEnd.worker.descriptors} exceeds ${budgets.descriptorGrowth}`);
  record(afterWork.gateway.threads - idleEnd.gateway.threads <= budgets.threadGrowth, `Gateway thread growth ${afterWork.gateway.threads - idleEnd.gateway.threads} exceeds ${budgets.threadGrowth}`);
  record(afterWork.worker.threads - idleEnd.worker.threads <= budgets.threadGrowth, `Worker thread growth ${afterWork.worker.threads - idleEnd.worker.threads} exceeds ${budgets.threadGrowth}`);
  const requestLogBytes = delta(afterWork.gatewayLog, gatewayLogBeforeWork);
  record(requestLogBytes / gatewayRequests <= budgets.logBytesPerGatewayRequest, `Gateway log amplification ${Math.round(requestLogBytes / gatewayRequests)} bytes/request exceeds ${budgets.logBytesPerGatewayRequest}`);

  report = {
    mode,
    platform: process.platform,
    node: process.version,
    packageMiB: mb(packageBytes),
    blankNodeMiB: mb(blankSample.residentBytes),
    budgets: Object.fromEntries(Object.entries(budgets).map(([key, value]) => [key, key.toLowerCase().includes("bytes") ? value : value])),
    idle,
    workload: {
      gatewayRequests,
      workerRequests,
      gatewayLogBytes: requestLogBytes,
      gatewayLogBytesPerRequest: Math.round((requestLogBytes / gatewayRequests) * 10) / 10,
      ...(secondPhase ? { secondPhaseGatewayResidentMiB: mb(secondPhase.gatewayResidentBytes), secondPhaseWorkerResidentMiB: mb(secondPhase.workerResidentBytes) } : {}),
    },
    afterWork: {
      gatewayResidentMiB: mb(afterWork.gateway.residentBytes),
      workerResidentMiB: mb(afterWork.worker.residentBytes),
      gatewayResidualMiB: mb(gatewayResidual),
      workerResidualMiB: mb(workerResidual),
      gatewayDescriptors: afterWork.gateway.descriptors,
      workerDescriptors: afterWork.worker.descriptors,
      gatewayThreads: afterWork.gateway.threads,
      workerThreads: afterWork.worker.threads,
    },
    failures,
  };

  await terminate(gateway);
  await terminate(worker);
  await delay(300);
  record(!processExists(gateway.pid), "Gateway process remained after cleanup");
  record(!processExists(worker.pid), "Worker process remained after cleanup");
  report.failures = failures;
  await writeReport(report);
} catch (error) {
  failures.push(error instanceof Error ? error.stack || error.message : String(error));
  report ||= { mode, platform: process.platform, node: process.version, failures };
  try { await writeReport(report); } catch { /* preserve original failure */ }
} finally {
  for (const child of children.reverse()) await terminate(child);
  for (const fd of descriptors) try { closeSync(fd); } catch { /* already closed */ }
  try { await rm(temporary, { recursive: true, force: true }); } catch { /* CI temp cleanup is best effort */ }
}

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
