import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ToolPolicy = { allow: string[]; deny: string[]; explicit: string[] };
type CommandPolicy = { allow: string[] };
type Workspace = { workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: ToolPolicy; commands: CommandPolicy };
type Worker = { workerId: string; environmentId: string; transport: { type: string; endpoint: string }; liveness: { reachable: boolean; checkedAt?: string; lastSuccessAt?: string }; defaultWorkspaceId?: string; workspaces: Workspace[] };
type ToolDiagnostic = { name: string; visibility?: string };
type Snapshot = { apiVersion: 1; deployment: { ok: boolean; coreManifestRevision: number; workerProtocolVersion: string; deploymentManifestFingerprint: string; supportedMcpProtocolVersions: string[]; tools: ToolDiagnostic[] }; workers: Worker[] };

type ApiError = { error?: string; message?: string };
const storageKey = "queqiao-management-secret";

async function api<T>(secret: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", "x-queqiao-management-secret": secret, ...(init.headers || {}) } });
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function App() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem(storageKey) || "");
  const [draftSecret, setDraftSecret] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!secret) return;
    try { setError(null); setSnapshot(await api<Snapshot>(secret, "/v1/operations")); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load control plane"); }
  }, [secret]);

  useEffect(() => { void refresh(); }, [refresh]);

  const publicTools = useMemo(() => snapshot?.deployment.tools.filter((tool) => tool.visibility === "public").map((tool) => tool.name).sort() || [], [snapshot]);

  const mutate = async (key: string, path: string, init: RequestInit) => {
    try { setBusyKey(key); setError(null); await api(secret, path, init); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Mutation failed"); }
    finally { setBusyKey(null); }
  };

  const submitSecret = (event: FormEvent) => {
    event.preventDefault();
    const next = draftSecret.trim();
    if (!next) return;
    sessionStorage.setItem(storageKey, next);
    setSecret(next);
    setDraftSecret("");
  };

  if (!secret) {
    return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">Q</div><h1>Queqiao Local Operations</h1><p>Enter the Gateway management secret for this browser session. It is kept only in sessionStorage.</p><form onSubmit={submitSecret}><input autoFocus type="password" value={draftSecret} onChange={(e) => setDraftSecret(e.target.value)} placeholder="Management secret"/><button type="submit">Connect</button></form></section></main>;
  }

  return <div className="app-shell">
    <header><div><div className="eyebrow">QUEQIAO</div><h1>Local Operations</h1></div><div className="header-actions"><button className="secondary" onClick={() => void refresh()}>Refresh</button><button className="secondary" onClick={() => { sessionStorage.removeItem(storageKey); setSecret(""); setSnapshot(null); }}>Disconnect</button></div></header>
    {error && <div className="error-banner">{error}</div>}
    {!snapshot ? <main><section className="panel">Loading control plane…</section></main> : <main>
      <section className="summary-grid">
        <div className="metric"><span>Deployment</span><strong>{snapshot.deployment.ok ? "Healthy" : "Degraded"}</strong><Badge tone={snapshot.deployment.ok ? "good" : "bad"}>rev {snapshot.deployment.coreManifestRevision}</Badge></div>
        <div className="metric"><span>Worker Protocol</span><strong>{snapshot.deployment.workerProtocolVersion}</strong><small>{snapshot.workers.length} enrolled</small></div>
        <div className="metric"><span>Public Tools</span><strong>{publicTools.length}</strong><small>{snapshot.deployment.supportedMcpProtocolVersions.length} MCP revisions</small></div>
        <div className="metric fingerprint"><span>Deployment Fingerprint</span><code>{snapshot.deployment.deploymentManifestFingerprint}</code></div>
      </section>

      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">WORKERS</span><h2>Runtime topology</h2></div></div>
        <div className="worker-stack">{snapshot.workers.map((worker) => <article className="worker-card" key={worker.workerId}>
          <div className="worker-heading"><div><h3>{worker.environmentId}</h3><code>{worker.workerId}</code></div><div className="worker-meta"><Badge tone={worker.liveness.reachable ? "good" : "bad"}>{worker.liveness.reachable ? "reachable" : "offline"}</Badge><span>{worker.transport.endpoint}</span></div></div>
          {worker.workspaces.length === 0 ? <div className="empty">No Workspaces reported by this Worker.</div> : <div className="workspace-list">{worker.workspaces.map((workspace) => <WorkspaceCard key={workspace.workspaceId} worker={worker} workspace={workspace} publicTools={publicTools} busyKey={busyKey} mutate={mutate}/>)}</div>}
        </article>)}</div>
      </section>
    </main>}
  </div>;
}

function WorkspaceCard({ worker, workspace, publicTools, busyKey, mutate }: { worker: Worker; workspace: Workspace; publicTools: string[]; busyKey: string | null; mutate: (key: string, path: string, init: RequestInit) => Promise<void> }) {
  const base = `/v1/workers/${encodeURIComponent(worker.workerId)}/workspaces/${encodeURIComponent(workspace.workspaceId)}`;
  const [command, setCommand] = useState("");
  return <section className="workspace-card">
    <div className="workspace-heading"><div><div className="title-row"><h4>{workspace.displayName}</h4>{worker.defaultWorkspaceId === workspace.workspaceId && <Badge tone="warn">default</Badge>}</div><code>{workspace.workspaceId}</code><small>{workspace.root}</small></div>
      <label className="profile-control"><span>Profile</span><select value={workspace.profile} disabled={busyKey === `${workspace.workspaceId}:profile`} onChange={(e) => void mutate(`${workspace.workspaceId}:profile`, `${base}/profile`, { method: "PATCH", body: JSON.stringify({ profile: e.target.value }) })}><option value="read-only">read-only</option><option value="editor">editor</option><option value="coding">coding</option></select></label></div>

    <div className="policy-grid"><div><h5>Tool policy</h5><div className="tool-grid">{publicTools.map((tool) => { const state = workspace.tools.deny.includes(tool) ? "deny" : workspace.tools.allow.includes(tool) || workspace.tools.explicit.includes(tool) ? "allow" : "inherit"; const key = `${workspace.workspaceId}:tool:${tool}`; return <div className="tool-row" key={tool}><code>{tool}</code><div className="segmented"><button className={state === "allow" ? "active" : ""} disabled={busyKey === key} onClick={() => void mutate(key, `${base}/tools/${encodeURIComponent(tool)}`, { method: "PATCH", body: JSON.stringify({ decision: "allow" }) })}>Allow</button><button className={state === "inherit" ? "active inherit" : ""} disabled={busyKey === key} onClick={() => void mutate(key, `${base}/tools/${encodeURIComponent(tool)}`, { method: "PATCH", body: JSON.stringify({ decision: "inherit" }) })}>Inherit</button><button className={state === "deny" ? "active danger" : ""} disabled={busyKey === key} onClick={() => void mutate(key, `${base}/tools/${encodeURIComponent(tool)}`, { method: "PATCH", body: JSON.stringify({ decision: "deny" }) })}>Deny</button></div></div>; })}</div></div>
      <div><h5>Command allowlist</h5><div className="command-list">{workspace.commands.allow.length ? workspace.commands.allow.map((item) => <div className="command-row" key={item}><code>{item}</code><button className="icon-button" disabled={busyKey === `${workspace.workspaceId}:command:${item}`} onClick={() => void mutate(`${workspace.workspaceId}:command:${item}`, `${base}/commands`, { method: "PATCH", body: JSON.stringify({ command: item, decision: "deny" }) })}>Remove</button></div>) : <div className="empty compact">No commands allowed.</div>}</div><form className="command-form" onSubmit={(e) => { e.preventDefault(); const value = command.trim(); if (!value) return; void mutate(`${workspace.workspaceId}:command:${value}`, `${base}/commands`, { method: "PATCH", body: JSON.stringify({ command: value, decision: "allow" }) }).then(() => setCommand("")); }}><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Executable name, e.g. git"/><button type="submit">Allow command</button></form></div></div>
  </section>;
}

createRoot(document.getElementById("root")!).render(<App/>);
