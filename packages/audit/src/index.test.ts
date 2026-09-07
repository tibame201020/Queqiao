import { mkdtemp, readdir, readFile, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLogStore, createAuditEvent } from "./index.js";

function event(action: string, detail: Record<string, unknown> = {}) {
  return createAuditEvent({
    at: "2026-09-07T04:00:00.000Z",
    component: "worker",
    category: "tool",
    action,
    outcome: "success",
    subject: { workspaceId: "workspace-a", tool: "read_file" },
    detail,
  });
}

describe("audit event contract", () => {
  it("redacts secret-bearing keys and credential-shaped values before persistence", () => {
    const record = event("tool.execute", {
      approvalSecret: "do-not-store",
      nested: { credential: "worker-secret", safe: "kept" },
      authorization: "Bearer abc.def.ghi",
      joinCode: "qjq1:very-secret-value",
      url: "https://example.test/callback?code=oauth-code&state=visible",
    });

    expect(record.detail).toEqual({
      approvalSecret: "[REDACTED]",
      nested: { credential: "[REDACTED]", safe: "kept" },
      authorization: "[REDACTED]",
      joinCode: "[REDACTED]",
      url: "https://example.test/callback?code=%5BREDACTED%5D&state=visible",
    });
    expect(JSON.stringify(record)).not.toContain("do-not-store");
    expect(JSON.stringify(record)).not.toContain("oauth-code");
  });

  it("bounds oversized metadata without changing the event envelope", () => {
    const record = event("tool.execute", { huge: "x".repeat(20_000) });
    expect(record.schemaVersion).toBe(1);
    expect(record.detail?.huge).toMatch(/\[TRUNCATED\]$/);
    expect(JSON.stringify(record).length).toBeLessThan(20_000);
  });
});

describe("AuditLogStore", () => {
  it("appends JSONL and returns newest events without mutating the store during reads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-audit-"));
    const store = new AuditLogStore(directory, { maxFileBytes: 16_384, maxFiles: 3, maxAgeMs: 86_400_000 });
    await store.append(event("one"));
    await store.append(event("two"));

    const file = path.join(directory, "events.jsonl");
    const before = (await stat(file)).mtimeMs;
    const result = await store.query({ limit: 10 });
    const after = (await stat(file)).mtimeMs;

    expect(result.events.map((entry) => entry.action)).toEqual(["two", "one"]);
    expect(result.issues).toEqual([]);
    expect(after).toBe(before);
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("rotates before the active file exceeds its bound and retains only the configured generations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-audit-"));
    const store = new AuditLogStore(directory, { maxFileBytes: 650, maxFiles: 2, maxAgeMs: 86_400_000 });
    for (let index = 0; index < 12; index += 1) await store.append(event(`event-${index}`, { payload: "y".repeat(120) }));

    const files = (await readdir(directory)).filter((name) => name.startsWith("events") && name.endsWith(".jsonl")).sort();
    expect(files).toEqual(["events.1.jsonl", "events.2.jsonl", "events.jsonl"]);
    for (const name of files) expect((await stat(path.join(directory, name))).size).toBeLessThanOrEqual(650);
    const result = await store.query({ limit: 100 });
    expect(result.events[0]?.action).toBe("event-11");
    expect(result.events.some((entry) => entry.action === "event-0")).toBe(false);
  });

  it("prunes expired generations only when a new event is written", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-audit-"));
    let now = Date.now();
    const store = new AuditLogStore(directory, { maxFileBytes: 500, maxFiles: 2, maxAgeMs: 1_000, now: () => now });
    await store.append(event("old-a", { payload: "z".repeat(150) }));
    await store.append(event("old-b", { payload: "z".repeat(150) }));
    await store.append(event("old-c", { payload: "z".repeat(150) }));
    const rotated = path.join(directory, "events.1.jsonl");
    const oldDate = new Date(now - 10_000);
    await utimes(rotated, oldDate, oldDate);

    const beforeRead = await readdir(directory);
    await store.query({ limit: 10 });
    expect(await readdir(directory)).toEqual(beforeRead);

    now += 20_000;
    await store.append(event("new"));
    expect(await readdir(directory)).not.toContain("events.1.jsonl");
  });
});

