import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ToolPolicy = { allow: string[]; deny: string[]; explicit: string[] };
type CommandPolicy = { allow: string[] };
type Workspace = { workspaceId: string; displayName: string; root: string; profile: "read-only" | "editor" | "coding"; tools: ToolPolicy; commands: CommandPolicy };
type Worker = { workerId: string; environmentId: string; transport: { type: string; endpoint: string }; liveness: { reachable: boolean; checkedAt?: string; lastSuccessAt?: string }; defaultWorkspaceId?: string; workspaces: Workspace[] };
type Snapshot = { apiVersion: 1; deployment: { ok: boolean; coreManifestRevision: number; workerProtocolVersion: string; deploymentManifestFingerprint: string; supportedMcpProtocolVersions: string[]; tools: { name: string; visibility?: string }[] }; workers: Worker[] };
type ApiError = { error?: string; message?: string };
type Credential = { kind: "session" | "secret"; value: string };
type Selection = { workerId: string; workspaceId?: string };
type Toast = { tone: "success" | "error"; message: string };

const sessionKey = "queqiao-dashboard-session";
const secretKey = "queqiao-management-secret";

async function api<T>(credential: Credential, path: string, init: RequestInit = {}): Promise<T> {
  const authHeader = credential.kind === "session" ? { "x-queqiao-dashboard-session": credential.value } : { "x-queqiao-management-secret": credential.value };
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...authHeader, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function Badge({ children, tone = "neutral", dot = false }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn"; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="status-dot"/>}{children}</span>;
}

function Icon({ name }: { name: "grid" | "server" | "folder" | "plus" | "refresh" | "logout" | "chevron" | "shield" | "terminal" | "link" | "trash" | "copy" }) {
  const paths: Record<typeof name, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="17" r="1"/></>,
    folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
    logout: <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>,
    terminal: <><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></>,
    trash: <><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></>,
    copy: <><rect x="9" y="9" width="10" height="10" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatRelative(value?: string) {
  if (!value) return "Never";
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return "Unknown";
  if (delta < 60_000) return "Just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleString();
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
  const [toast, setToast] = useState<Toast | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [showEnroll, setShowEnroll] = useState(false);

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
    try {
      setError(null);
      const next = await api<Snapshot>(credential, "/v1/operations");
      setSnapshot(next);
      setSelection((current) => {
        if (current && next.workers.some((w) => w.workerId === current.workerId && (!current.workspaceId || w.workspaces.some((ws) => ws.workspaceId === current.workspaceId)))) return current;
        const first = next.workers[0];
        if (!first) return null;
        const workspaceId = first.defaultWorkspaceId || first.workspaces[0]?.workspaceId;
        return workspaceId ? { workerId: first.workerId, workspaceId } : { workerId: first.workerId };
      });
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load control plane"); }
  }, [credential]);
  useEffect(() => { void refresh(); }, [refresh]);

  const publicTools = useMemo(() => snapshot?.deployment.tools.filter((tool) => tool.visibility === "public").map((tool) => tool.name).sort() || [], [snapshot]);
  const selectedWorker = snapshot?.workers.find((w) => w.workerId === selection?.workerId) || null;
  const selectedWorkspace = selectedWorker?.workspaces.find((w) => w.workspaceId === selection?.workspaceId) || null;
  const onlineCount = snapshot?.workers.filter((w) => w.liveness.reachable).length || 0;
  const workspaceCount = snapshot?.workers.reduce((sum, worker) => sum + worker.workspaces.length, 0) || 0;

  const mutate = async (key: string, path: string, init: RequestInit, success = "Change applied") => {
    if (!credential) return;
    try { setBusyKey(key); setError(null); await api(credential, path, init); await refresh(); setToast({ tone: "success", message: success }); window.setTimeout(() => setToast(null), 2600); }
    catch (err) { const message = err instanceof Error ? err.message : "Mutation failed"; setError(message); setToast({ tone: "error", message }); }
    finally { setBusyKey(null); }
  };
  const disconnect = async () => {
    if (credential?.kind === "session") await api(credential, "/v1/dashboard-session", { method: "DELETE" }).catch(() => undefined);
    sessionStorage.removeItem(sessionKey); sessionStorage.removeItem(secretKey); setCredential(null); setSnapshot(null);
  };
  const submitSecret = (event: FormEvent) => { event.preventDefault(); const value = draftSecret.trim(); if (!value) return; sessionStorage.setItem(secretKey, value); setCredential({ kind: "secret", value }); setDraftSecret(""); };
  const createJoinToken = async () => {
    if (!credential) return;
    try { setBusyKey("join-token"); const result = await api<{ token: string }>(credential, "/v1/join-tokens", { method: "POST", body: "{}" }); setJoinToken(result.token); setShowEnroll(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to create join token"); }
    finally { setBusyKey(null); }
  };

  if (!credential) return <AuthView draftSecret={draftSecret} setDraftSecret={setDraftSecret} submitSecret={submitSecret} error={error}/>;

  return <div className="console-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-glyph">Q</div><div><strong>Queqiao</strong><span>Operations Console</span></div></div>
      <nav className="nav-block">
        <button className={!selection ? "nav-item active" : "nav-item"} onClick={() => setSelection(null)}><Icon name="grid"/><span>Overview</span></button>
      </nav>
      <div className="sidebar-section-heading"><span>Topology</span><button className="icon-ghost" title="Enroll Worker" onClick={() => setShowEnroll(true)}><Icon name="plus"/></button></div>
      <div className="topology-tree">
        {snapshot?.workers.map((worker) => <div className="tree-worker" key={worker.workerId}>
          <button className={selection?.workerId === worker.workerId && !selection.workspaceId ? "tree-row active" : "tree-row"} onClick={() => setSelection({ workerId: worker.workerId })}>
            <span className={`presence ${worker.liveness.reachable ? "online" : "offline"}`}/><Icon name="server"/><span className="tree-label">{worker.environmentId}</span><span className="tree-count">{worker.workspaces.length}</span>
          </button>
          <div className="tree-children">{worker.workspaces.map((workspace) => <button key={workspace.workspaceId} className={selection?.workerId === worker.workerId && selection.workspaceId === workspace.workspaceId ? "tree-row child active" : "tree-row child"} onClick={() => setSelection({ workerId: worker.workerId, workspaceId: workspace.workspaceId })}><Icon name="folder"/><span className="tree-label">{workspace.displayName}</span>{worker.defaultWorkspaceId === workspace.workspaceId && <span className="default-dot" title="Default Workspace"/>}</button>)}</div>
        </div>)}
        {snapshot && snapshot.workers.length === 0 && <div className="sidebar-empty">No enrolled Workers</div>}
      </div>
      <div className="sidebar-footer"><div className="session-state"><span className="presence online"/><div><strong>Local control plane</strong><span>{credential.kind === "session" ? "Ephemeral session" : "Recovery credential"}</span></div></div></div>
    </aside>

    <section className="console-main">
      <header className="topbar">
        <div className="breadcrumbs"><span>Operations</span>{selectedWorker && <><Icon name="chevron"/><span>{selectedWorker.environmentId}</span></>}{selectedWorkspace && <><Icon name="chevron"/><strong>{selectedWorkspace.displayName}</strong></>}</div>
        <div className="topbar-actions"><button className="btn ghost" onClick={() => void refresh()}><Icon name="refresh"/>Refresh</button><button className="btn ghost" onClick={() => void disconnect()}><Icon name="logout"/>Disconnect</button></div>
      </header>

      {error && <div className="global-alert"><div><strong>Control-plane request failed</strong><span>{error}</span></div><button onClick={() => setError(null)}>Dismiss</button></div>}
      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}

      {!snapshot ? <LoadingView/> : !selection ? <Overview deployment={snapshot.deployment} workers={snapshot.workers} onlineCount={onlineCount} workspaceCount={workspaceCount} publicToolCount={publicTools.length} onEnroll={() => setShowEnroll(true)} onSelectWorker={(workerId) => setSelection({ workerId })}/> : selectedWorker && !selectedWorkspace ? <WorkerDetail worker={selectedWorker} busyKey={busyKey} mutate={mutate} onWorkspace={(workspaceId) => setSelection({ workerId: selectedWorker.workerId, workspaceId })}/> : selectedWorker && selectedWorkspace ? <WorkspaceDetail worker={selectedWorker} workspace={selectedWorkspace} publicTools={publicTools} busyKey={busyKey} mutate={mutate}/> : <EmptyState title="Selection unavailable" detail="The selected resource no longer exists." action={<button className="btn primary" onClick={() => setSelection(null)}>Return to overview</button>}/>}
    </section>

    {showEnroll && <EnrollDrawer busy={busyKey === "join-token"} token={joinToken} onCreate={() => void createJoinToken()} onClose={() => { setShowEnroll(false); setJoinToken(null); }}/>}
  </div>;
}

function AuthView({ draftSecret, setDraftSecret, submitSecret, error }: { draftSecret: string; setDraftSecret: (v: string) => void; submitSecret: (event: FormEvent) => void; error: string | null }) {
  return <main className="auth-shell"><section className="auth-panel"><div className="auth-brand"><div className="brand-glyph large">Q</div><div><div className="eyebrow">LOCAL CONTROL PLANE</div><h1>Queqiao Operations Console</h1></div></div><p className="auth-lead">Open a short-lived local session from the CLI. The management secret is only required for recovery.</p><div className="cli-callout"><code>queqiao dashboard open</code><span>Recommended</span></div>{error && <div className="auth-error">{error}</div>}<div className="auth-divider"><span>Recovery access</span></div><form onSubmit={submitSecret}><label><span>Management secret</span><input autoFocus type="password" value={draftSecret} onChange={(e) => setDraftSecret(e.target.value)} placeholder="Enter recovery credential"/></label><button className="btn primary" type="submit">Connect</button></form><small>Credentials stay in this browser tab session and are never embedded in the Dashboard bundle.</small></section></main>;
}

function LoadingView() {
  return <main className="content"><div className="skeleton-title"/><div className="summary-strip">{[1,2,3,4].map((n) => <div className="summary-cell skeleton" key={n}/>)}</div><div className="table-card"><div className="skeleton-row"/><div className="skeleton-row"/><div className="skeleton-row"/></div></main>;
}

function Overview({ deployment, workers, onlineCount, workspaceCount, publicToolCount, onEnroll, onSelectWorker }: { deployment: Snapshot["deployment"]; workers: Worker[]; onlineCount: number; workspaceCount: number; publicToolCount: number; onEnroll: () => void; onSelectWorker: (id: string) => void }) {
  return <main className="content">
    <div className="page-heading"><div><div className="eyebrow">SYSTEM OVERVIEW</div><h1>Operations</h1><p>Runtime topology, availability, and control-plane posture.</p></div><button className="btn primary" onClick={onEnroll}><Icon name="plus"/>Enroll Worker</button></div>
    <section className="summary-strip">
      <SummaryCell label="Deployment" value={deployment.ok ? "Healthy" : "Degraded"} meta={`Manifest rev ${deployment.coreManifestRevision}`} tone={deployment.ok ? "good" : "bad"}/>
      <SummaryCell label="Workers online" value={`${onlineCount} / ${workers.length}`} meta={workers.length ? `${Math.round((onlineCount / workers.length) * 100)}% reachable` : "No Workers enrolled"} tone={workers.length && onlineCount === workers.length ? "good" : workers.length ? "warn" : "neutral"}/>
      <SummaryCell label="Workspaces" value={String(workspaceCount)} meta="Worker-authoritative roots"/>
      <SummaryCell label="Public tools" value={String(publicToolCount)} meta={`${deployment.supportedMcpProtocolVersions.length} MCP revisions`}/>
    </section>

    <section className="section-block"><div className="section-heading"><div><h2>Runtime topology</h2><p>Enrolled execution environments and their current liveness.</p></div></div>
      <div className="table-card"><div className="table-head workers-table"><span>Environment</span><span>Status</span><span>Endpoint</span><span>Workspaces</span><span>Last success</span><span/></div>{workers.map((worker) => <button className="table-row workers-table" key={worker.workerId} onClick={() => onSelectWorker(worker.workerId)}><div className="resource-cell"><div className="resource-icon"><Icon name="server"/></div><div><strong>{worker.environmentId}</strong><code>{worker.workerId}</code></div></div><div><Badge tone={worker.liveness.reachable ? "good" : "bad"} dot>{worker.liveness.reachable ? "Reachable" : "Offline"}</Badge></div><code className="truncate">{worker.transport.endpoint}</code><span>{worker.workspaces.length}</span><span>{formatRelative(worker.liveness.lastSuccessAt)}</span><span className="row-arrow"><Icon name="chevron"/></span></button>)}{workers.length === 0 && <EmptyState title="No Workers enrolled" detail="Create a join token and enroll an execution environment to begin." action={<button className="btn primary" onClick={onEnroll}>Enroll Worker</button>}/>}</div>
    </section>

    <section className="section-block two-column"><div className="info-card"><div className="card-icon"><Icon name="shield"/></div><div><span className="card-label">Control-plane identity</span><strong>Manifest fingerprint</strong><code className="fingerprint-value">{deployment.deploymentManifestFingerprint}</code></div></div><div className="info-card"><div className="card-icon"><Icon name="link"/></div><div><span className="card-label">Protocol compatibility</span><strong>Worker Protocol {deployment.workerProtocolVersion}</strong><span className="muted">{deployment.supportedMcpProtocolVersions.join(" · ")}</span></div></div></section>
  </main>;
}

function SummaryCell({ label, value, meta, tone = "neutral" }: { label: string; value: string; meta: string; tone?: "neutral" | "good" | "bad" | "warn" }) {
  return <div className="summary-cell"><span>{label}</span><div className="summary-value-row"><strong>{value}</strong>{tone !== "neutral" && <span className={`health-indicator ${tone}`}/>}</div><small>{meta}</small></div>;
}

function WorkerDetail({ worker, busyKey, mutate, onWorkspace }: { worker: Worker; busyKey: string | null; mutate: (key: string, path: string, init: RequestInit, success?: string) => Promise<void>; onWorkspace: (id: string) => void }) {
  const [endpoint, setEndpoint] = useState(worker.transport.endpoint);
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => setEndpoint(worker.transport.endpoint), [worker.transport.endpoint]);
  return <main className="content">
    <div className="page-heading"><div><div className="eyebrow">WORKER</div><div className="title-with-status"><h1>{worker.environmentId}</h1><Badge tone={worker.liveness.reachable ? "good" : "bad"} dot>{worker.liveness.reachable ? "Reachable" : "Offline"}</Badge></div><p className="mono-subtitle">{worker.workerId}</p></div><button className="btn primary" onClick={() => setShowAdd(true)}><Icon name="plus"/>Add Workspace</button></div>

    <section className="summary-strip compact-summary"><SummaryCell label="Transport" value={worker.transport.type.toUpperCase()} meta={worker.transport.endpoint}/><SummaryCell label="Workspaces" value={String(worker.workspaces.length)} meta={worker.defaultWorkspaceId ? "Default Workspace configured" : "No default Workspace"}/><SummaryCell label="Last checked" value={formatRelative(worker.liveness.checkedAt)} meta="Gateway liveness snapshot"/><SummaryCell label="Last success" value={formatRelative(worker.liveness.lastSuccessAt)} meta={worker.liveness.reachable ? "Current connection healthy" : "Worker currently unreachable"} tone={worker.liveness.reachable ? "good" : "bad"}/></section>

    {showAdd && <section className="inline-form-card"><div className="section-heading"><div><h2>Add Workspace</h2><p>Register a Worker-local root and initial permission profile.</p></div><button className="icon-ghost" onClick={() => setShowAdd(false)}>×</button></div><AddWorkspaceForm worker={worker} mutate={mutate} onDone={() => setShowAdd(false)}/></section>}

    <section className="section-block"><div className="section-heading"><div><h2>Workspaces</h2><p>Authority boundaries exposed by this Worker.</p></div></div><div className="table-card"><div className="table-head workspace-table"><span>Name</span><span>Profile</span><span>Root</span><span>Commands</span><span/></div>{worker.workspaces.map((workspace) => <button className="table-row workspace-table" key={workspace.workspaceId} onClick={() => onWorkspace(workspace.workspaceId)}><div className="resource-cell"><div className="resource-icon folder"><Icon name="folder"/></div><div><strong>{workspace.displayName}</strong><span>{workspace.workspaceId}{worker.defaultWorkspaceId === workspace.workspaceId && <em>Default</em>}</span></div></div><Badge tone={workspace.profile === "coding" ? "warn" : workspace.profile === "editor" ? "neutral" : "good"}>{workspace.profile}</Badge><code className="truncate">{workspace.root}</code><span>{workspace.commands.allow.length}</span><span className="row-arrow"><Icon name="chevron"/></span></button>)}{worker.workspaces.length === 0 && <EmptyState title="No Workspaces" detail="This Worker is enrolled but exposes no Workspace roots." action={<button className="btn primary" onClick={() => setShowAdd(true)}>Add Workspace</button>}/>}</div></section>

    <section className="section-block"><div className="section-heading"><div><h2>Transport</h2><p>Worker connection descriptor. Changes are verified before membership is updated.</p></div></div><div className="settings-card"><label className="field grow"><span>Endpoint</span><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)}/></label><div className="field action-field"><span>&nbsp;</span><button className="btn secondary" disabled={busyKey === `${worker.workerId}:transport` || endpoint === worker.transport.endpoint} onClick={() => void mutate(`${worker.workerId}:transport`, `/v1/workers/${encodeURIComponent(worker.workerId)}/transport`, { method: "PATCH", body: JSON.stringify({ transport: { type: "http", endpoint } }) }, "Worker transport updated")}>Save endpoint</button></div></div></section>

    <section className="section-block danger-zone"><div><h2>Danger zone</h2><p>Removing a Worker deletes its Gateway membership and managed credential reference.</p></div><button className="btn danger" disabled={busyKey === `${worker.workerId}:remove`} onClick={() => confirm(`Remove Worker ${worker.environmentId}? This cannot be undone from the Dashboard.`) && void mutate(`${worker.workerId}:remove`, `/v1/workers/${encodeURIComponent(worker.workerId)}`, { method: "DELETE" }, "Worker removed")}><Icon name="trash"/>Remove Worker</button></section>
  </main>;
}

function AddWorkspaceForm({ worker, mutate, onDone }: { worker: Worker; mutate: (key: string, path: string, init: RequestInit, success?: string) => Promise<void>; onDone: () => void }) {
  const [id, setId] = useState(""); const [displayName, setDisplayName] = useState(""); const [root, setRoot] = useState(""); const [profile, setProfile] = useState("read-only");
  return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); if (!id.trim() || !displayName.trim() || !root.trim()) return; void mutate(`${worker.workerId}:workspace:add`, `/v1/workers/${encodeURIComponent(worker.workerId)}/workspaces`, { method: "POST", body: JSON.stringify({ id: id.trim(), displayName: displayName.trim(), root: root.trim(), profile }) }, "Workspace added").then(onDone); }}><label className="field"><span>Workspace ID</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="my-project"/></label><label className="field"><span>Display name</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="My Project"/></label><label className="field span-2"><span>Worker-local root</span><input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="C:\\Projects\\my-project"/></label><label className="field"><span>Initial profile</span><select value={profile} onChange={(e) => setProfile(e.target.value)}><option value="read-only">read-only</option><option value="editor">editor</option><option value="coding">coding</option></select></label><div className="form-actions span-2"><button type="button" className="btn ghost" onClick={onDone}>Cancel</button><button type="submit" className="btn primary">Add Workspace</button></div></form>;
}

function WorkspaceDetail({ worker, workspace, publicTools, busyKey, mutate }: { worker: Worker; workspace: Workspace; publicTools: string[]; busyKey: string | null; mutate: (key: string, path: string, init: RequestInit, success?: string) => Promise<void> }) {
  const base = `/v1/workers/${encodeURIComponent(worker.workerId)}/workspaces/${encodeURIComponent(workspace.workspaceId)}`;
  const [command, setCommand] = useState("");
  const allowCount = publicTools.filter((tool) => workspace.tools.allow.includes(tool) || workspace.tools.explicit.includes(tool)).length;
  const denyCount = publicTools.filter((tool) => workspace.tools.deny.includes(tool)).length;
  const inheritCount = publicTools.length - allowCount - denyCount;
  return <main className="content">
    <div className="page-heading"><div><div className="eyebrow">WORKSPACE</div><div className="title-with-status"><h1>{workspace.displayName}</h1>{worker.defaultWorkspaceId === workspace.workspaceId && <Badge tone="warn">Default</Badge>}</div><p className="mono-subtitle">{workspace.root}</p></div><label className="profile-picker"><span>Permission profile</span><select value={workspace.profile} disabled={busyKey === `${workspace.workspaceId}:profile`} onChange={(e) => void mutate(`${workspace.workspaceId}:profile`, `${base}/profile`, { method: "PATCH", body: JSON.stringify({ profile: e.target.value }) }, `Profile changed to ${e.target.value}`)}><option value="read-only">read-only</option><option value="editor">editor</option><option value="coding">coding</option></select></label></div>

    <section className="summary-strip compact-summary"><SummaryCell label="Workspace ID" value={workspace.workspaceId} meta="Stable control-plane identifier"/><SummaryCell label="Tool policy" value={`${allowCount} allow · ${denyCount} deny`} meta={`${inheritCount} inherited decisions`}/><SummaryCell label="Commands" value={String(workspace.commands.allow.length)} meta="Explicit executable allowlist"/><SummaryCell label="Authority" value={workspace.profile} meta="Worker-enforced permission profile" tone={workspace.profile === "coding" ? "warn" : workspace.profile === "read-only" ? "good" : "neutral"}/></section>

    <section className="section-block"><div className="section-heading"><div><h2>Tool policy</h2><p>Per-tool overrides layered on top of the selected Workspace profile.</p></div><div className="policy-legend"><span><i className="legend-dot allow"/>Allow</span><span><i className="legend-dot inherit"/>Inherit</span><span><i className="legend-dot deny"/>Deny</span></div></div><div className="policy-table"><div className="policy-head"><span>Tool</span><span>Decision</span></div>{publicTools.map((tool) => { const state = workspace.tools.deny.includes(tool) ? "deny" : workspace.tools.allow.includes(tool) || workspace.tools.explicit.includes(tool) ? "allow" : "inherit"; const key = `${workspace.workspaceId}:tool:${tool}`; return <div className="policy-row" key={tool}><div className="tool-name"><Icon name="shield"/><code>{tool}</code></div><div className="segmented">{(["allow", "inherit", "deny"] as const).map((decision) => <button key={decision} className={state === decision ? `active ${decision}` : ""} disabled={busyKey === key} onClick={() => void mutate(key, `${base}/tools/${encodeURIComponent(tool)}`, { method: "PATCH", body: JSON.stringify({ decision }) }, `${tool}: ${decision}`)}>{decision}</button>)}</div></div>; })}</div></section>

    <section className="section-block"><div className="section-heading"><div><h2>Command allowlist</h2><p>Executables that may be launched from this Workspace under command policy.</p></div></div><div className="command-card"><div className="command-list">{workspace.commands.allow.length ? workspace.commands.allow.map((item) => <div className="command-item" key={item}><div className="command-name"><Icon name="terminal"/><code>{item}</code></div><button className="btn text-danger" onClick={() => void mutate(`${workspace.workspaceId}:command:${item}`, `${base}/commands`, { method: "PATCH", body: JSON.stringify({ command: item, decision: "deny" }) }, `${item} removed from allowlist`)}>Remove</button></div>) : <div className="command-empty"><Icon name="terminal"/><div><strong>No commands allowed</strong><span>Add an executable name to permit it explicitly.</span></div></div>}</div><form className="command-add" onSubmit={(e) => { e.preventDefault(); const value = command.trim(); if (!value) return; void mutate(`${workspace.workspaceId}:command:${value}`, `${base}/commands`, { method: "PATCH", body: JSON.stringify({ command: value, decision: "allow" }) }, `${value} added to allowlist`).then(() => setCommand("")); }}><label className="field grow"><span>Executable name</span><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="git"/></label><button className="btn secondary" type="submit">Add command</button></form></div></section>

    {worker.defaultWorkspaceId !== workspace.workspaceId && <section className="section-block danger-zone"><div><h2>Danger zone</h2><p>Removing this Workspace revokes the root from Queqiao management on this Worker.</p></div><button className="btn danger" disabled={busyKey === `${workspace.workspaceId}:remove`} onClick={() => confirm(`Remove Workspace ${workspace.workspaceId}?`) && void mutate(`${workspace.workspaceId}:remove`, base, { method: "DELETE" }, "Workspace removed")}><Icon name="trash"/>Remove Workspace</button></section>}
  </main>;
}

function EnrollDrawer({ busy, token, onCreate, onClose }: { busy: boolean; token: string | null; onCreate: () => void; onClose: () => void }) {
  return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer"><div className="drawer-header"><div><div className="eyebrow">ENROLLMENT</div><h2>Enroll Worker</h2></div><button className="drawer-close" onClick={onClose}>×</button></div><div className="drawer-body"><div className="step"><span className="step-index">1</span><div><strong>Create a short-lived join token</strong><p>The token authorizes one Worker enrollment transaction.</p></div></div>{!token ? <button className="btn primary full" disabled={busy} onClick={onCreate}>{busy ? "Creating…" : "Create join token"}</button> : <><div className="token-panel"><div className="token-heading"><span>Join token</span><Badge tone="warn">short-lived</Badge></div><code>{token}</code><button className="btn secondary full" onClick={() => void navigator.clipboard.writeText(token)}><Icon name="copy"/>Copy token</button></div><div className="step"><span className="step-index">2</span><div><strong>Join from the Worker host</strong><p>Run the Worker join command against this Gateway using the token above.</p></div></div><div className="cli-snippet"><code>queqiao worker join --token &lt;token&gt;</code></div></>}</div><div className="drawer-footer"><span>Tokens are single-use and expire automatically.</span></div></aside></div>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="folder"/></div><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

createRoot(document.getElementById("root")!).render(<App/>);
