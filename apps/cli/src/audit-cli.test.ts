import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLogStore, createAuditEvent } from "@queqiao/audit";
import { listAuditEvents, recordCliAudit } from "./audit-cli.js";

describe("audit CLI query", () => {
  it("returns bounded filtered events without creating a second audit model", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-audit-cli-"));
    const store = new AuditLogStore(directory);
    await store.append(createAuditEvent({ component: "gateway", category: "transport", action: "transport.select", outcome: "success" }));
    await store.append(createAuditEvent({ component: "worker", category: "tool", action: "tool.execute", outcome: "denied", subject: { workspaceId: "one", tool: "shell" } }));

    await expect(listAuditEvents(directory, { category: "tool", outcome: "denied", limit: "10" })).resolves.toMatchObject({
      schemaVersion: "1.0",
      events: [{ category: "tool", action: "tool.execute", outcome: "denied" }],
      issues: [],
    });
  });

  it("rejects invalid filters before touching storage", async () => {
    await expect(listAuditEvents("does-not-matter", { category: "secret", limit: "0" })).rejects.toThrow();
  });

  it("records CLI management events into the same store", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-audit-cli-write-"));
    await expect(recordCliAudit(directory, { category: "workspace", action: "workspace.edit", outcome: "success", subject: { workspaceId: "one" } })).resolves.toBe(true);
    await expect(listAuditEvents(directory, { category: "workspace" })).resolves.toMatchObject({ events: [{ component: "cli", action: "workspace.edit", subject: { workspaceId: "one" } }] });
  });
});
