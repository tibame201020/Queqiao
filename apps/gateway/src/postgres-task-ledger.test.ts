import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresTaskLedger } from "./postgres-task-ledger.js";
import { PostgresUnknownRunInspector } from "./pg-unknown-run-inspector.js";

const dsn = process.env.QUEQIAO_TEST_PG_URL;
const { Pool } = pg;
const schema = "qqledger_" + randomUUID().replace(/-/g, "");
const owner = (c: string) => c.repeat(64);
const revision = "a".repeat(40);
const gatewayA = randomUUID();
const gatewayB = randomUUID();
let pool: pg.Pool;
let poolB: pg.Pool;
let a: PostgresTaskLedger;
let b: PostgresTaskLedger;
let counter = 0;
const key = () => (++counter).toString(16).padStart(64, "0");
async function fresh(taskId = "gateway-vitest", ownerDigest = owner("b")) {
  return a.reserve({ ownerDigest, idempotencyDigest: key(), taskId, sourceRevision: revision });
}

describe.runIf(Boolean(dsn))("PostgreSQL transactional multi-Gateway ledger — real DB", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: dsn!, max: 15, connectionTimeoutMillis: 3000 });
    poolB = new Pool({ connectionString: dsn!, max: 15, connectionTimeoutMillis: 3000 });
  });
  beforeEach(async () => {
    await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await pool.query('CREATE SCHEMA "' + schema + '"');
    a = new PostgresTaskLedger(pool, schema);
    b = new PostgresTaskLedger(poolB, schema);
    await a.migrate();
  }, 12000);
  afterAll(async () => {
    if (pool) {
      await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
      await pool.end();
      await poolB.end();
    }
  });

  it("deduplicates 24 concurrent reservations from two Gateway instances under one database transaction", async () => {
    const args = { taskId: "gateway-vitest", ownerDigest: owner("a"), idempotencyDigest: key(), sourceRevision: revision };
    const submissions = await Promise.all(Array.from({ length: 24 }, (_, i) =>
      (i % 2 ? a : b).reserve(args)));
    expect(new Set(submissions.map(x => x.id)).size).toBe(1);
    expect(submissions[0]).toMatchObject({ state: "queued", ownerDigest: owner("a") });
    expect(await a.count()).toBe(1);
    await expect(b.reserve({ ...args, taskId: "gateway-cancel-smoke" })).rejects.toThrow(/idempotency/i);
  });

  it("enforces one active task per owner and 16 global tasks across competing Gateways", async () => {
    const first = fresh("gateway-vitest", owner("c"));
    const second = fresh("gateway-vitest", owner("c"));
    const result = await Promise.allSettled([first, second]);
    expect(result.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(x => x.status === "rejected").map(x => (x as PromiseRejectedResult).reason.message).join(" ")).toMatch(/quota/i);
    const submissions = await Promise.allSettled(Array.from({ length: 24 }, (_, i) =>
      (i % 2 ? a : b).reserve({
        taskId: "gateway-vitest",
        ownerDigest: (i + 30).toString(16).padStart(64, "0"),
        idempotencyDigest: key(), sourceRevision: revision,
      })));
    expect(submissions.filter(x => x.status === "fulfilled")).toHaveLength(15);
    expect(submissions.filter(x => x.status === "rejected")).toHaveLength(9);
    expect(await a.count()).toBe(16);
  });

  it("provides exclusive claim and monotonic fencing to reject stale writers after cancellation", async () => {
    const current = await fresh("gateway-vitest", owner("d"));
    const claims = await Promise.all([a.claim(current.id, gatewayA, 60), b.claim(current.id, gatewayB, 60)]);
    const winner = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(winner.fence).toBe("1");
    const loser = winner.holder === gatewayA ? gatewayB : gatewayA;
    expect(await a.bindRun(current.id, loser, winner.fence, "101", "gha_test")).toBe(false);
    expect(await a.bindRun(current.id, winner.holder!, winner.fence, "101", "gha_test")).toBe(true);
    expect(await b.read(owner("f"), current.id)).toBeNull();
    await expect(b.cancel(current.id, owner("f"))).rejects.toThrow(/not found/i);
    const cancellation = await b.cancel(current.id, owner("d"));
    expect(cancellation.state).toBe("cancelling");
    expect(Number(cancellation.fence)).toBeGreaterThan(Number(winner.fence));
    expect(await a.finish(current.id, winner.holder!, winner.fence, "completed")).toBe(false);
    expect((await a.read(owner("d"), current.id))?.state).toBe("cancelling");
  });

  it("permits a legitimate lease renewal and completion visible through another Gateway pool", async () => {
    const reserved = await fresh("gateway-vitest", owner("9"));
    const lease = await a.claim(reserved.id, gatewayA, 3);
    expect(lease?.holder).toBe(gatewayA);
    expect(await a.finish(reserved.id, gatewayA, lease!.fence, "completed")).toBe(false);
    expect(await a.bindRun(reserved.id, gatewayA, lease!.fence, "611", "gha_611")).toBe(true);
    expect(await a.renew(reserved.id, gatewayA, lease!.fence, 20)).toBe(true);
    expect(await b.renew(reserved.id, gatewayB, lease!.fence, 20)).toBe(false);
    expect(await b.finish(reserved.id, gatewayB, lease!.fence, "completed")).toBe(false);
    expect(await a.finish(reserved.id, gatewayA, lease!.fence, "completed")).toBe(true);
    expect((await b.read(owner("9"), reserved.id))?.state).toBe("completed");
    expect(await a.renew(reserved.id, gatewayA, lease!.fence, 20)).toBe(false);
  });

  it("inspects lost-run candidates only for the original HMAC owner and quarantined task", async () => {
    const reserved=await fresh("gateway-vitest",owner("b"));
    const finder={inspect:vi.fn(async ()=>({status:"candidate" as const,runId:9022}))};
    const inspector=new PostgresUnknownRunInspector(b,finder,{
      owner:"example",repo:"runtime-host",
      workflowId:"runtime-provider-poc-worker.yml",
      ref:"main",trustedActor:"trusted-bot",
    });
    await expect(inspector.inspect(owner("c"),reserved.id)).rejects.toThrow(/not found/i);
    expect(finder.inspect).not.toHaveBeenCalled();
    await expect(inspector.inspect(owner("b"),reserved.id)).rejects.toThrow(/not eligible/i);
    expect(finder.inspect).not.toHaveBeenCalled();
    const claimed=await a.claim(reserved.id,gatewayA,60);
    expect(await a.quarantineUncertainDispatch(reserved.id,gatewayA,claimed!.fence)).toBe(true);
    await expect(inspector.inspect(owner("b"),reserved.id)).resolves.toEqual({status:"candidate",runId:9022});
    expect(finder.inspect).toHaveBeenCalledWith(expect.objectContaining({
      leaseId:reserved.id,createdAt:reserved.createdAt.toISOString(),
      actor:"trusted-bot",workflowId:"runtime-provider-poc-worker.yml",
    }));
    const still=await a.read(owner("b"),reserved.id);
    expect(still).toMatchObject({state:"reconciling",runId:null});
  });
  it("validates schema identifiers and refuses arbitrary SQL/catalog names", async () => {
    expect(() => new PostgresTaskLedger(pool, "public; DROP TABLE secrets")).toThrow();
    await expect(a.reserve({
      ownerDigest: owner("2"), idempotencyDigest: key(),
      taskId: "node -e process.env", sourceRevision: revision,
    })).rejects.toThrow();
    expect(await a.count()).toBe(0);
  });
  it("does not redispatch expired provisioned tasks; moves them into fenced reconciliation", async () => {
    const before = await fresh("gateway-vitest", owner("e"));
    const claimed = await a.claim(before.id, gatewayA, 1);
    expect(claimed?.state).toBe("provisioning");
    expect(await b.claim(before.id, gatewayB, 20)).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 1300));
    const flagged = await b.flagExpired(10);
    expect(flagged.map(x => x.id)).toContain(before.id);
    expect(flagged.find(x => x.id === before.id)?.state).toBe("reconciling");
    expect(await a.bindRun(before.id, gatewayA, claimed!.fence, "909", "gha_old")).toBe(false);
    expect(await a.finish(before.id, gatewayA, claimed!.fence, "completed")).toBe(false);
    expect(await b.claim(before.id, gatewayB, 20)).toBeNull();
  });

  it("serializes cleanup ownership, retries after timeout, and rejects stale completion tokens", async () => {
    const original = await fresh("gateway-cancel-smoke", owner("7"));
    const old = await a.claim(original.id, gatewayA, 30);
    expect(old).not.toBeNull();
    expect(await a.bindRun(original.id, gatewayA, old!.fence, "9401", "gha_9401")).toBe(true);
    const request = await b.cancel(original.id, owner("7"));
    expect(request).toMatchObject({ state: "cancelling", runId: "9401" });
    const first = await a.claimCleanup(original.id, gatewayA, 1);
    const overlapping = await b.claimCleanup(original.id, gatewayB, 30);
    expect(first).toMatchObject({ state: "cancelling", holder: gatewayA });
    expect(overlapping).toBeNull();
    expect(await b.cancel(original.id, owner("7"))).toMatchObject({ fence: first!.fence });
    await new Promise(resolve => setTimeout(resolve, 1300));
    const takeover = await b.claimCleanup(original.id, gatewayB, 30);
    expect(takeover?.holder).toBe(gatewayB);
    expect(BigInt(takeover!.fence)).toBeGreaterThan(BigInt(first!.fence));
    expect(await a.acknowledgeCleanup(original.id, gatewayA, first!.fence, "cancelled")).toBe(false);
    expect(await b.acknowledgeCleanup(original.id, gatewayB, takeover!.fence, "cancelled")).toBe(true);
    expect((await a.read(owner("7"), original.id))?.state).toBe("cancelled");
  });

  it("claims orphan reconciliation once and does not finalize without a valid owner fence", async () => {
    const initial = await fresh("gateway-vitest", owner("8"));
    const old = await a.claim(initial.id, gatewayA, 1);
    expect(await a.bindRun(initial.id, gatewayA, old!.fence, "990", "gha_990")).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1300));
    expect((await a.flagExpired(10)).map(x => x.id)).toContain(initial.id);
    const claims = await Promise.all([
      a.claimCleanup(initial.id, gatewayA, 15), b.claimCleanup(initial.id, gatewayB, 15),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = claims.find(Boolean)!;
    const loser = winner.holder === gatewayA ? gatewayB : gatewayA;
    expect(await a.acknowledgeCleanup(initial.id, loser, winner.fence, "failed")).toBe(false);
    expect(await a.acknowledgeCleanup(initial.id, winner.holder!, winner.fence, "failed")).toBe(true);
    expect((await b.read(owner("8"), initial.id))?.state).toBe("failed");
  });
  it("preserves run correlation after lease expiry and cannot accept a late successful result", async () => {
    const before = await fresh("gateway-vitest", owner("f"));
    const claim = await a.claim(before.id, gatewayA, 1);
    expect(await a.bindRun(before.id, gatewayA, claim!.fence, "733", "gha_733")).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 1300));
    const expired = (await b.flagExpired(10)).find(x => x.id === before.id);
    expect(expired).toMatchObject({ runId: "733", environmentId: "gha_733", state: "reconciling" });
    expect(await a.finish(before.id, gatewayA, claim!.fence, "completed")).toBe(false);
  });
});
