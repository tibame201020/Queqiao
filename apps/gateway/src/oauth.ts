import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { GatewayRuntimeConfig } from "./config.js";

export const QUEQIAO_ACCESS_SCOPE = "queqiao:access" as const;
export const SUPPORTED_SCOPES = [QUEQIAO_ACCESS_SCOPE] as const;
const LEGACY_CHATGPT_SCOPE = "workspace:read";
const CURRENT_AUTHORIZATION_REVISION = 3;
const MAX_AUTHORIZED_CLIENTS = 1000;
const MAX_PENDING_CLIENTS = 100;
const PENDING_CLIENT_TTL_MS = 60 * 60 * 1000;
type Client = { client_id: string; client_name: string; redirect_uris: string[]; scope: string; authorization_revision: number; created_at: number; authorized_at?: number; current_refresh_token_id?: string; token_endpoint_auth_method: "none" };
type Code = { clientId: string; redirectUri: string; challenge: string; resource: string; scope: string; expiresAt: number };
export type AccessClaims = JWTPayload & { scope: string; client_id: string; token_use: "access" };
function safeEqual(a: string, b: string) { return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest()); }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!); }
function oauthError(res: Response, status: number, error: string, description: string) { res.status(status).json({ error, error_description: description }); }
function normalizeScope(value: unknown): typeof QUEQIAO_ACCESS_SCOPE {
  const requested = String(value || QUEQIAO_ACCESS_SCOPE).trim();
  if (requested === QUEQIAO_ACCESS_SCOPE || requested === LEGACY_CHATGPT_SCOPE) return QUEQIAO_ACCESS_SCOPE;
  throw new Error("Unsupported scope");
}
function migrateStoredScope(value: unknown): typeof QUEQIAO_ACCESS_SCOPE {
  const stored = String(value || "").split(/\s+/).filter(Boolean);
  const legacy = new Set(["workspace:read", "workspace:write", "workspace:exec"]);
  if (stored.length > 0 && stored.every((scope) => legacy.has(scope))) return QUEQIAO_ACCESS_SCOPE;
  return normalizeScope(value);
}

export class OAuthService {
  readonly router: Router = express.Router();
  private readonly clients = new Map<string, Client>();
  private readonly codes = new Map<string, Code>();
  private readonly clientsFile: string;
  private saveQueue: Promise<void> = Promise.resolve();
  private refreshQueue: Promise<void> = Promise.resolve();
  constructor(private readonly config: GatewayRuntimeConfig) { this.clientsFile = path.join(config.stateDir, "oauth-clients.json"); this.routes(); }
  async initialize() {
    await mkdir(this.config.stateDir, { recursive: true });
    let changed = false;
    try {
      for (const stored of JSON.parse(await readFile(this.clientsFile, "utf8")) as Array<Omit<Client, "authorization_revision"> & { authorization_revision?: number }>) {
        const client: Client = {
          ...stored,
          scope: migrateStoredScope(stored.scope),
          authorization_revision: Math.max(stored.authorization_revision ?? 0, CURRENT_AUTHORIZATION_REVISION),
          created_at: stored.created_at ?? Date.now(),
          authorized_at: stored.authorized_at ?? stored.created_at ?? Date.now(),
        };
        if (client.scope !== stored.scope || client.authorization_revision !== stored.authorization_revision || stored.created_at === undefined || stored.authorized_at === undefined) changed = true;
        this.clients.set(client.client_id, client);
      }
      if (changed) await this.saveClients();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  private saveClients() { this.saveQueue = this.saveQueue.then(async () => { const temp = `${this.clientsFile}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify([...this.clients.values()], null, 2), { mode: 0o600 }); await rename(temp, this.clientsFile); }); return this.saveQueue; }
  private routes() {
    this.router.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => res.json({ resource: this.config.resourceUrl, authorization_servers: [this.config.publicBaseUrl.href], scopes_supported: [...SUPPORTED_SCOPES], bearer_methods_supported: ["header"] }));
    this.router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({ issuer: this.config.publicBaseUrl.href, authorization_endpoint: new URL("oauth/authorize", this.config.publicBaseUrl).href, token_endpoint: new URL("oauth/token", this.config.publicBaseUrl).href, registration_endpoint: new URL("oauth/register", this.config.publicBaseUrl).href, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: [...SUPPORTED_SCOPES] }));
    this.router.post("/oauth/register", express.json({ limit: "32kb" }), async (req, res) => {
      try { const uris = req.body?.redirect_uris; this.pruneExpiredPendingClients(); const clients = [...this.clients.values()]; if (clients.filter((client) => client.authorized_at).length >= MAX_AUTHORIZED_CLIENTS || clients.filter((client) => !client.authorized_at).length >= MAX_PENDING_CLIENTS) return oauthError(res, 503, "temporarily_unavailable", "Client registration capacity reached"); if (!Array.isArray(uris) || !uris.length || uris.length > 8 || !uris.every((uri) => validRedirectUri(uri, this.config.allowedRedirectOrigins))) return oauthError(res, 400, "invalid_client_metadata", "redirect_uris contain an invalid URI"); const client: Client = { client_id: randomBytes(24).toString("base64url"), client_name: String(req.body?.client_name || "ChatGPT MCP client").slice(0, 120), redirect_uris: [...new Set(uris)], scope: normalizeScope(req.body?.scope), authorization_revision: CURRENT_AUTHORIZATION_REVISION, created_at: Date.now(), token_endpoint_auth_method: "none" }; this.clients.set(client.client_id, client); await this.saveClients(); const { authorization_revision: _revision, created_at: _created, authorized_at: _authorized, current_refresh_token_id: _refresh, ...registration } = client; res.status(201).json(registration); } catch (error) { oauthError(res, 400, "invalid_client_metadata", error instanceof Error ? error.message : "Invalid metadata"); }
    });
    this.router.get("/oauth/authorize", (req, res) => { try { const data = this.validate(req.query as Record<string, string>); const hidden = Object.entries(data).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join(""); res.type("html").send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Queqiao authorization</title><style>body{font:16px system-ui;max-width:620px;margin:8vh auto;padding:24px}main{border:1px solid #d9dee5;border-radius:14px;padding:28px}input{width:100%;box-sizing:border-box;padding:12px;margin:8px 0 18px}button{padding:12px 18px}</style></head><body><main><h1>Allow ChatGPT to use Queqiao?</h1><p>Client: <strong>${escapeHtml(data.clientName)}</strong></p><p>Scopes: ${escapeHtml(data.scope)}</p><form method="post" action="${escapeHtml(new URL("oauth/authorize", this.config.publicBaseUrl).pathname)}">${hidden}<label>Queqiao approval secret<input name="approval_secret" type="password" required></label><button type="submit">Allow connection</button></form></main></body></html>`); } catch (error) { res.status(400).type("text").send(error instanceof Error ? error.message : "Invalid request"); } });
    this.router.post("/oauth/authorize", express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => { try { const data = this.validate(req.body as Record<string, string>); if (!safeEqual(String(req.body.approval_secret || ""), this.config.approvalSecret)) return res.status(403).send("Approval secret is incorrect"); const client = this.clients.get(data.client_id)!; if (!client.authorized_at) { client.authorized_at = Date.now(); await this.saveClients(); } this.pruneExpiredCodes(); const code = randomBytes(32).toString("base64url"); this.codes.set(code, { clientId: data.client_id, redirectUri: data.redirect_uri, challenge: data.code_challenge, resource: data.resource, scope: data.scope, expiresAt: Date.now() + 300_000 }); const callback = new URL(data.redirect_uri); callback.searchParams.set("code", code); callback.searchParams.set("state", data.state); callback.searchParams.set("iss", this.config.publicBaseUrl.href); res.redirect(303, callback.href); } catch (error) { res.status(400).send(error instanceof Error ? error.message : "Invalid request"); } });
    this.router.post("/oauth/token", express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => { try { if (req.body.grant_type === "authorization_code") { const value = String(req.body.code || ""); const code = this.codes.get(value); this.codes.delete(value); if (!code || code.expiresAt < Date.now() || code.clientId !== req.body.client_id || code.redirectUri !== req.body.redirect_uri || !safeEqual(createHash("sha256").update(String(req.body.code_verifier || "")).digest("base64url"), code.challenge)) return oauthError(res, 400, "invalid_grant", "Authorization code is invalid"); if (req.body.resource !== code.resource || code.resource !== this.config.resourceUrl) return oauthError(res, 400, "invalid_target", "Token resource does not match the authorized MCP resource"); return res.json(await this.issue(code.clientId, code.scope)); } if (req.body.grant_type === "refresh_token") return res.json(await this.rotateRefreshToken(String(req.body.refresh_token || ""), String(req.body.client_id || ""))); return oauthError(res, 400, "unsupported_grant_type", "Unsupported grant type"); } catch { oauthError(res, 400, "invalid_grant", "Token request could not be verified"); } });
  }
  private validate(input: Record<string, string>) { const client = this.clients.get(input.client_id || ""); if (!client) throw new Error("Unknown client_id"); if (input.response_type !== "code" || input.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge || "")) throw new Error("Authorization Code with PKCE S256 is required"); if (!client.redirect_uris.includes(input.redirect_uri || "")) throw new Error("redirect_uri is not registered"); if (input.resource !== this.config.resourceUrl) throw new Error(`resource must be ${this.config.resourceUrl}`); if ((input.state || "").length > 512) throw new Error("state is too long"); const scope = normalizeScope(input.scope || client.scope); return { client_id: input.client_id!, clientName: client.client_name, redirect_uri: input.redirect_uri!, response_type: "code", code_challenge: input.code_challenge!, code_challenge_method: "S256", scope, resource: input.resource!, state: input.state || "" }; }
  private pruneExpiredPendingClients() { const cutoff = Date.now() - PENDING_CLIENT_TTL_MS; for (const [id, client] of this.clients) if (!client.authorized_at && client.created_at < cutoff) this.clients.delete(id); }
  private pruneExpiredCodes() { const now = Date.now(); for (const [code, value] of this.codes) if (value.expiresAt < now) this.codes.delete(code); }
  private rotateRefreshToken(token: string, clientId: string) { const operation = this.refreshQueue.then(() => this.consumeRefreshToken(token, clientId)); this.refreshQueue = operation.then(() => undefined, () => undefined); return operation; }
  private async consumeRefreshToken(token: string, requestedClientId: string) { const verified = await jwtVerify(token, this.config.jwtSecret, { issuer: this.config.publicBaseUrl.href, audience: this.config.resourceUrl }); const client = this.clients.get(String(verified.payload.client_id || "")); const structurallyValid = verified.payload.token_use === "refresh" && client?.authorized_at && verified.payload.client_id === requestedClientId && verified.payload.authorization_revision === client.authorization_revision; if (!structurallyValid) throw new Error("Refresh token requires reauthorization"); const legacyMigration = !client.current_refresh_token_id && !verified.payload.jti; if (!legacyMigration && (!verified.payload.jti || verified.payload.jti !== client.current_refresh_token_id)) { client.authorization_revision += 1; delete client.current_refresh_token_id; await this.saveClients(); throw new Error("Refresh token reuse revoked the authorization"); } return this.issue(client.client_id, normalizeScope(verified.payload.scope)); }
  private async issue(clientId: string, scope: string) { const client = this.clients.get(clientId); if (!client) throw new Error("Unknown client_id"); const common = { client_id: clientId, scope, authorization_revision: client.authorization_revision }; const access_token = await new SignJWT({ ...common, token_use: "access" }).setProtectedHeader({ alg: "HS256" }).setIssuer(this.config.publicBaseUrl.href).setAudience(this.config.resourceUrl).setSubject("queqiao-owner").setIssuedAt().setExpirationTime("1h").sign(this.config.jwtSecret); const refreshTokenId = randomBytes(24).toString("base64url"); const refresh_token = await new SignJWT({ ...common, token_use: "refresh" }).setProtectedHeader({ alg: "HS256" }).setIssuer(this.config.publicBaseUrl.href).setAudience(this.config.resourceUrl).setSubject("queqiao-owner").setJti(refreshTokenId).setIssuedAt().setExpirationTime("30d").sign(this.config.jwtSecret); client.current_refresh_token_id = refreshTokenId; await this.saveClients(); return { access_token, refresh_token, token_type: "Bearer", expires_in: 3600, scope }; }
  authenticate = async (req: Request, res: Response, next: NextFunction) => { const token = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]; if (!token) return this.challenge(res); try { const verified = await jwtVerify(token, this.config.jwtSecret, { issuer: this.config.publicBaseUrl.href, audience: this.config.resourceUrl }); const client = this.clients.get(String(verified.payload.client_id || "")); if (verified.payload.token_use !== "access" || !client || verified.payload.authorization_revision !== client.authorization_revision) return this.challenge(res); res.locals.oauth = verified.payload as AccessClaims; next(); } catch { this.challenge(res); } };
  private challenge(res: Response) { const metadata = new URL(".well-known/oauth-protected-resource/mcp", this.config.publicBaseUrl).href; res.set("WWW-Authenticate", `Bearer resource_metadata="${metadata}"`); res.status(401).json({ error: "invalid_token" }); }
}

function redirectOriginAllowed(url: URL, allowedOrigins: ReadonlySet<string>): boolean {
  if (allowedOrigins.has(url.origin)) return true;
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  return allowedOrigins.has(`http://${url.hostname}`);
}

function validRedirectUri(value: unknown, allowedOrigins: ReadonlySet<string>): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || !redirectOriginAllowed(url, allowedOrigins)) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  } catch { return false; }
}
