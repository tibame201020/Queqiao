import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ToolPolicy = { allow: string[]; deny: string[]; explicit: string[] };
type CommandPolicy = { allow: string[] };
type Workspace = { workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: ToolPolicy; commands: CommandPolicy };
type Worker = { workerId: string; environmentId: string; transport: { type: string; endpoint: string }; liveness: { reachable: boolean; checkedAt?: string; lastSuccessAt?: string }; defaultWorkspaceId?: string; workspaces: Workspace[] };
type Snapshot = { apiVersion: 1; deployment: { ok: boolean; coreManifestRevision: number; workerProtocolVersion: string; deploymentManifestFingerprint: string; supportedMcpProtocolVersions: string[]; tools: { name: string; visibility?: string }[] }; workers: Worker[] };
type ApiError = { error?: string; message?: string };
type Credential = { kind: "session" | "secret"; value: string };

const sessionKey = "queqiao-dashboard-session";
const secretKey = "queqiao-management-secret";

async function api<T>(credential: Credential, path: string, init: RequestInit = {}): Promise<T> {
  const authHeader = credential.kind === "session" ? { "x-queqiao-dashboard-session": credential.value } : { "x-queqiao-management-secret": credential.value };
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...authHeader, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function App() {
  const [credential, setCredential] = useState<Credential | null>(() => {
    const session = sessionStorage.getItem(sessionKey); if (session) return { kind: "session", value: session };
    const secret = sessionStorage.getItem(secretKey); return secret ? { kind: "secret", value: secret } : null;
  });
  const [draftSecret, setDraftSecret] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinToken, setJoinToken] = useState<string | null>(null);

  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
    const code = fragment.get("session");
    if (!code || credential?.kind === "session") return;
    void fetch("/dashboard/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Dashboard session exchange failed"); return body; })
      .then((body) => { const token = String(body.token || ""); if (!token) throw new Error("Invalid Dashboard session"); sessionStorage.setItem(sessionKey, token); sessionStorage.removeItem(secretKey); history.replaceState(null, "", location.pathname); setCredential({ kind: "session", value: token }); })
      .catch((err) => setError(err instanceof Error ? err.message : "Dashboard session exchange failed"));
  }, [credential?.kind]);

  const refresh = useCallback(async () => {
    if (!credential) return;
    try { setError(null); setSnapshot(await api<Snapshot>(credential, "/v1/operations")); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load control plane"); }
  }, [credential]);
  useEffect(() => { void refresh(); }, [refresh]);

  const publicTools = useMemo(() => snapshot?.deployment.tools.filter((tool) => tool.visibility === "public").map((tool) => tool.name).sort() || [], [snapshot]);
  const mutate = async (key: string, path: string, init: RequestInit) => {
    if (!credential) return;
    try { setBusyKey(key); setError(null); await api(credential, path, init); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Mutation failed"); }
    finally { setBusyKey(null); }
  };
  const disconnect = async () => {
    if (credential?.kind === "session") await api(credential, "/v1/dashboard-session", { method: "DELETE" }).catch(() => undefined);
    sessionStorage.removeItem(sessionKey); sessionStorage.removeItem(secretKey); setCredential(null); setSnapshot(null);
  };
  const submitSecret = (event: FormEvent) => { event.preventDefault(); const value = draftSecret.trim(); if (!value) return; sessionStorage.setItem(secretKey, value); setCredential({ kind: "secret", value }); setDraftSecret(""); };

  if (!credential) return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">Q</div><h1>Queqiao Local Operations</h1><p>Run <code>queqiao dashboard open</code> for a one-time local session. Manual management-secret login remains available as a recovery path.</p>{error && <div className="error-banner">{error}</div>}<form onSubmit={submitSecret}><input autoFocus type="password" value={draftSecret} onChange={(e) => setDraftSecret(e.target.value)} placeholder="Management secret"/><button type="submit">Connect manually</button></form></section></main>;

  return <div className="app-shell"><header><div><div className="eyebrow">QUEQIAO</div><h1>Local Operations</h1></div><div className="header-actions"><Badge tone={credential.kind === "session" ? "good" : "warn"}>{credential.kind === "session" ? "local session" : "management secret"}</Badge><button className="secondary" onClick={() => void refresh()}>Refresh</button><button className="secondary" onClick={() => void disconnect()}>Disconnect</button></div></header>
    {error && <div className="error-banner">{error}</div>}
    {!snapshot ? <main><section className="panel">Loading control plane…</section></main> : <main>
      <section className="summary-grid"><div className="metric"><span>Deployment</span><strong>{snapshot.deployment.ok ? "Healthy" : "Degraded"}</strong><Badge tone={snapshot.deployment.ok ? "good" : "bad"}>rev {snapshot.deployment.coreManifestRevision}</Badge></div><div className="metric"><span>Worker Protocol</span><strong>{snapshot.deployment.workerProtocolVersion}</strong><small>{snapshot.workers.length} enrolled</small></div><div className="metric"><span>Public Tools</span><strong>{publicTools.length}</strong><small>{snapshot.deployment.supportedMcpProtocolVersions.length} MCP revisions</small></div><div className="metric fingerprint"><span>Deployment Fingerprint</span><code>{snapshot.deployment.deploymentManifestFingerprint}</code></div></section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ENROLLMENT</span><h2>Worker join</h2></div><button onClick={() => credential && api<{token:string}>(credential, "/v1/join-tokens", { method: "POST", body: "{}" }).then((r) => setJoinToken(r.token)).catch((e) => setError(String(e)))}>Create join token</button></div>{joinToken && <div className="token-box"><code>{joinToken}</code><button className="secondary" onClick={() => void navigator.clipboard.writeText(joinToken)}>Copy</button></div>}</section>
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">WORKERS</span><h2>Runtime topology</h2></div></div><div className="worker-stack">{snapshot.workers.map((worker) => <WorkerCard key={worker.workerId} worker={worker} publicTools={publicTools} busyKey={busyKey} mutate={mutate}/>)}</div></section>
    </main>}
  </div>;
}

function WorkerCard({ worker, publicTools, busyKey, mutate }: { worker: Worker; publicTools: string[]; busyKey: string | null; mutate: (key: string, path: string, init: RequestInit) => Promise<void> }) {
  const [endpoint, setEndpoint] = useState(worker.transport.endpoint);
  const [showAdd, setShowAdd] = useState(false);
  return <article className="worker-card"><div className="worker-heading"><div><h3>{worker.environmentId}</h3><code>{worker.workerId}</code></div><div className="worker-meta"><Badge tone={worker.liveness.reachable ? "good" : "bad"}>{worker.liveness.reachable ? "reachable" : "offline"}</Badge></div></div>
    <div className="admin-row"><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)}/><button className="secondary" onClick={() => void mutate(`${worker.workerId}:transport`, `/v1/workers/${encodeURIComponent(worker.workerId)}/transport`, { method: "PATCH", body: JSON.stringify({ transport: { type: "http", endpoint } }) })}>Update transport</button><button className="danger-button" onClick={() => confirm(`Remove Worker ${worker.environmentId}?`) && void mutate(`${worker.workerId}:remove`, `/v1/workers/${encodeURIComponent(worker.workerId)}`, { method: "DELETE" })}>Remove Worker</button></div>
    <div className="workspace-actions"><button className="secondary" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "Add Workspace"}</button></div>{showAdd && <AddWorkspaceForm worker={worker} mutate={mutate}/>}
    {worker.workspaces.length === 0 ? <div className="empty">No Workspaces reported by this Worker.</div> : <div className="workspace-list">{worker.workspaces.map((workspace) => <WorkspaceCard key={workspace.workspaceId} worker={worker} workspace={workspace} publicTools={publicTools} busyKey={busyKey} mutate={mutate}/>)}</div>}
  </article>;
}

function AddWorkspaceForm({ worker, mutate }: { worker: Worker; mutate: (key: string, path: string, init: RequestInit) => Promise<void> }) {
  const [id, setId] = useState(""); const [displayName, setDisplayName] = useState(""); const [root, setRoot] = useState(""); const [profile, setProfile] = useState("read-only");
  return <form className="workspace-add-form" onSubmit={(e) => { e.preventDefault(); if (!id.trim() || !displayName.trim() || !root.trim()) return; void mutate(`${worker.workerId}:workspace:add`, `/v1/workers/${encodeURIComponent(worker.workerId)}/workspaces`, { method: "POST", body: JSON.stringify({ id: id.trim(), displayName: displayName.trim(), root: root.trim(), profile }) }); }}><input value={id} onChange={(e) => setId(e.target.value)} placeholder="workspace-id"/><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name"/><input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="Worker-local root"/><select value={profile} onChange={(e) => setProfile(e.target.value)}><option>read-only</option><option>editor</option><option>coding</option></select><button type="submit">Add</button></form>;
}

function WorkspaceCard({ worker, workspace, publicTools, busyKey, mutate }: { worker: Worker; workspace: Workspace; publicTools: string[]; busyKey: string | null; mutate: (key: string, path: string, init: RequestInit) => Promise<void> }) {
  const base = `/v1/workers/${encodeURIComponent(worker.workerId)}/workspaces/${encodeURIComponent(workspace.workspaceId)}`; const [command, setCommand] = useState("");
  return <section className="workspace-card"><div className="workspace-heading"><div><div className="title-row"><h4>{workspace.displayName}</h4>{worker.defaultWorkspaceId === workspace.workspaceId && <Badge tone="warn">default</Badge>}</div><code>{workspace.workspaceId}</code><small>{workspace.root}</small></div><div className="workspace-controls"><label className="profile-control"><span>Profile</span><select value={workspace.profile} disabled={busyKey === `${workspace.workspaceId}:profile`} onChange={(e) => void mutate(`${workspace.workspaceId}:profile`, `${base}/profile`, { method: "PATCH", body: JSON.stringify({ profile: e.target.value }) })}><option>read-only</option><option>editor</option><option>coding</option></select></label>{worker.defaultWorkspaceId !== workspace.workspaceId && <button className="danger-button" onClick={() => confirm(`Remove Workspace ${workspace.workspaceId}?`) && void mutate(`${workspace.workspaceId}:remove`, base, { method: "DELETE" })}>Remove</button>}</div></div>
    <div className="policy-grid"><div><h5>Tool policy</h5><div className="tool-grid">{publicTools.map((tool) => { const state = workspace.tools.deny.includes(tool) ? "deny" : workspace.tools.allow.includes(tool) || workspace.tools.explicit.includes(tool) ? "allow" : "inherit"; const key = `${workspace.workspaceId}:tool:${tool}`; return <div className="tool-row" key={tool}><code>{tool}</code><div className="segmented">{(["allow","inherit","deny"] as const).map((decision) => <button key={decision} className={state === decision ? `active ${decision === "deny" ? "danger" : decision}` : ""} disabled={busyKey === key} onClick={() => void mutate(key, `${base}/tools/${encodeURIComponent(tool)}`, { method: "PATCH", body: JSON.stringify({ decision }) })}>{decision[0]!.toUpperCase()+decision.slice(1)}</button>)}</div></div>; })}</div></div><div><h5>Command allowlist</h5><div className="command-list">{workspace.commands.allow.length ? workspace.commands.allow.map((item) => <div className="command-row" key={item}><code>{item}</code><button className="icon-button" onClick={() => void mutate(`${workspace.workspaceId}:command:${item}`, `${base}/commands`, { method: "PATCH", body: JSON.stringify({ command: item, decision: "deny" }) })}>Remove</button></div>) : <div className="empty compact">No commands allowed.</div>}</div><form className="command-form" onSubmit={(e) => { e.preventDefault(); const value = command.trim(); if (!value) return; void mutate(`${workspace.workspaceId}:command:${value}`, `${base}/commands`, { method: "PATCH", body: JSON.stringify({ command: value, decision: "allow" }) }).then(() => setCommand("")); }}><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Executable name, e.g. git"/><button type="submit">Allow command</button></form></div></div>
  </section>;
}

createRoot(document.getElementById("root")!).render(<App/>);
