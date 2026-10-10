import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const taskName = z.enum(["gateway-vitest", "gateway-cancel-smoke"]);
const states = ["queued","provisioning","ready","running","cancelling","reconciling"];
export type LedgerTask = {
  id:string; ownerDigest:string; idempotencyDigest:string; taskId:string; sourceRevision:string;
  state:string; holder:string|null; fence:string; leaseUntil:Date|null; runId:string|null;
  environmentId:string|null; updatedAt:Date; createdAt:Date;
};
type Row = {
  id:string; owner_digest:string; idempotency_digest:string;task_id:string; source_revision:string;
  state:string; holder:string|null;fence:string;lease_until:Date|null;
  run_id:string|null;environment_id:string|null;updated_at:Date;created_at:Date;
};
function fromRow(r:Row):LedgerTask {
  return {id:r.id,ownerDigest:r.owner_digest,idempotencyDigest:r.idempotency_digest,
    taskId:r.task_id,sourceRevision:r.source_revision,state:r.state,holder:r.holder,
    fence:r.fence,leaseUntil:r.lease_until,runId:r.run_id,
    environmentId:r.environment_id,updatedAt:r.updated_at,createdAt:r.created_at};
}
const uuid=(id:string)=>z.string().uuid().parse(id);
function epoch(raw:string):string {
  const n=BigInt(z.string().regex(/^[1-9][0-9]*$/).parse(raw));
  if(n>9223372036854775807n)throw new Error("Fence token overflow");
  return n.toString();
}

/**
 * Cross-Gateway transactional coordination primitive. No production MCP
 * integration yet: all hosts must share PostgreSQL, not a JSON checkpoint.
 * Never store plaintext client IDs, credentials or user-supplied commands.
 */
export class PostgresTaskLedger {
  private readonly table:string;
  constructor(private readonly pool:Pool,schema="public") {
    const name=z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).parse(schema);
    this.table='"'+name+'"."queqiao_short_tasks_v1"';
  }
  private sql(q:string):string{return q.replaceAll("@T@",this.table);}
  async migrate():Promise<void>{
    await this.pool.query(this.sql(`CREATE TABLE IF NOT EXISTS @T@ (
      id uuid PRIMARY KEY,
      owner_digest char(64) NOT NULL CHECK (owner_digest ~ '^[0-9a-f]{64}$'),
      idempotency_digest char(64) NOT NULL CHECK (idempotency_digest ~ '^[0-9a-f]{64}$'),
      task_id text NOT NULL CHECK (task_id IN ('gateway-vitest','gateway-cancel-smoke')),
      source_revision char(40) NOT NULL CHECK (source_revision ~ '^[0-9a-f]{40}$'),
      state text NOT NULL DEFAULT 'queued' CHECK (state IN
        ('queued','provisioning','ready','running','cancelling','reconciling','completed','failed','cancelled')),
      holder uuid, fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0),
      lease_until timestamptz,run_id text,environment_id text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(owner_digest,idempotency_digest))`));
  }
  private async tx<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T>{
    const db=await this.pool.connect();
    try {
      await db.query("BEGIN");
      try {const result=await fn(db);await db.query("COMMIT");return result;}
      catch(e){await db.query("ROLLBACK");throw e;}
    } finally{db.release();}
  }
  async reserve(input:{ownerDigest:string;idempotencyDigest:string;taskId:string;sourceRevision:string}):Promise<LedgerTask>{
    const o=hex64.parse(input.ownerDigest),d=hex64.parse(input.idempotencyDigest),
      t=taskName.parse(input.taskId),s=sha.parse(input.sourceRevision);
    return this.tx(async db=>{
      // Transaction-wide lock prevents concurrent quota write-skew.
      await db.query("SELECT pg_advisory_xact_lock(120991,115)");
      const old=await db.query<Row>(this.sql("SELECT * FROM @T@ WHERE owner_digest=$1 AND idempotency_digest=$2"),[o,d]);
      if(old.rows[0]){
        if(old.rows[0].task_id!==t||old.rows[0].source_revision!==s)throw new Error("Idempotency conflict");
        return fromRow(old.rows[0]);
      }
      const counts=await db.query<{active:number;mine:number;total:number}>(this.sql(`
        SELECT count(*) FILTER(WHERE state = ANY($2::text[]))::int active,
        count(*) FILTER(WHERE owner_digest=$1 AND state = ANY($2::text[]))::int mine,
        count(*)::int total FROM @T@`),[o,states]);
      if(counts.rows[0]!.mine>=1)throw new Error("Owner active task quota exceeded");
      if(counts.rows[0]!.active>=16)throw new Error("Global task quota exceeded");
      if(counts.rows[0]!.total>=256)throw new Error("History capacity exceeded");
      const result=await db.query<Row>(this.sql(`INSERT INTO @T@
        (id,owner_digest,idempotency_digest,task_id,source_revision)
        VALUES($1,$2,$3,$4,$5) RETURNING *`),[randomUUID(),o,d,t,s]);
      return fromRow(result.rows[0]!);
    });
  }
  async read(ownerDigest:string,id:string):Promise<LedgerTask|null>{
    const r=await this.pool.query<Row>(this.sql("SELECT * FROM @T@ WHERE id=$1 AND owner_digest=$2"),[uuid(id),hex64.parse(ownerDigest)]);
    return r.rows[0]?fromRow(r.rows[0]):null;
  }
  async count():Promise<number>{
    const r=await this.pool.query<{n:number}>(this.sql("SELECT count(*)::int n FROM @T@"));
    return r.rows[0]!.n;
  }
  async claim(id:string,holder:string,seconds:number):Promise<LedgerTask|null>{
    const ttl=z.number().int().min(1).max(300).parse(seconds);
    const r=await this.pool.query<Row>(this.sql(`UPDATE @T@ SET
      holder=$2,fence=fence+1,state='provisioning',
      lease_until=clock_timestamp()+make_interval(secs=>$3::int),
      updated_at=clock_timestamp()
      WHERE id=$1 AND state='queued' RETURNING *`),[uuid(id),uuid(holder),ttl]);
    return r.rows[0]?fromRow(r.rows[0]):null;
  }
  async bindRun(id:string,holder:string,fence:string,runId:string,environmentId:string):Promise<boolean>{
    const r=await this.pool.query(this.sql(`UPDATE @T@ SET
      run_id=$4,environment_id=$5,updated_at=clock_timestamp()
      WHERE id=$1 AND holder=$2 AND fence=$3::bigint
        AND lease_until>clock_timestamp() AND state='provisioning'
        AND (run_id IS NULL OR (run_id=$4 AND environment_id=$5)) RETURNING id`),
      [uuid(id),uuid(holder),epoch(fence),
        z.string().regex(/^[0-9]{1,20}$/).parse(runId),z.string().min(1).max(128).parse(environmentId)]);
    return r.rowCount===1;
  }
  async renew(id:string,holder:string,fence:string,seconds:number):Promise<boolean>{
    const r=await this.pool.query(this.sql(`UPDATE @T@ SET
      lease_until=clock_timestamp()+make_interval(secs=>$4::int),updated_at=clock_timestamp()
      WHERE id=$1 AND holder=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()
        AND state IN ('provisioning','ready','running') RETURNING id`),
      [uuid(id),uuid(holder),epoch(fence),z.number().int().min(1).max(300).parse(seconds)]);
    return r.rowCount===1;
  }
  async finish(id:string,holder:string,fence:string,state:"completed"|"failed"):Promise<boolean>{
    const r=await this.pool.query(this.sql(`UPDATE @T@ SET
      state=$4,holder=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id=$1 AND holder=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()
        AND run_id IS NOT NULL AND state IN ('provisioning','ready','running') RETURNING id`),
      [uuid(id),uuid(holder),epoch(fence),state]);
    return r.rowCount===1;
  }
  async cancel(id:string,ownerDigest:string):Promise<LedgerTask>{
    return this.tx(async db=>{
      const old=await db.query<Row>(this.sql("SELECT * FROM @T@ WHERE id=$1 AND owner_digest=$2 FOR UPDATE"),
        [uuid(id),hex64.parse(ownerDigest)]);
      const v=old.rows[0];
      if(!v)throw new Error("Task not found");
      if(["cancelling","completed","failed","cancelled"].includes(v.state))return fromRow(v);
      const r=await db.query<Row>(this.sql(`UPDATE @T@ SET
        state='cancelling',fence=fence+1,holder=NULL,lease_until=NULL,
        updated_at=clock_timestamp() WHERE id=$1 RETURNING *`),[uuid(id)]);
      return fromRow(r.rows[0]!);
    });
  }
  /**
   * Only one Gateway can own cancellation/reconciliation at a time.
   * A timed-out cleanup claim may be taken over with a higher fence.
   * The caller MUST verify GitHub disposal before acknowledging cleanup.
   */
  /**
   * A dispatch can have reached GitHub even if its response was lost.
   * Quarantine the task and invalidate its fencing token: do not retry
   * the dispatch until remote correlation/reconciliation is implemented.
   */
  async quarantineUncertainDispatch(id:string,holder:string,fence:string):Promise<boolean>{
    const r=await this.pool.query(this.sql(`UPDATE @T@ SET
      state='reconciling',holder=NULL,lease_until=NULL,fence=fence+1,
      updated_at=clock_timestamp()
      WHERE id=$1 AND holder=$2 AND fence=$3::bigint
        AND state='provisioning'
      RETURNING id`),[uuid(id),uuid(holder),epoch(fence)]);
    return r.rowCount===1;
  }
  async claimCleanup(id:string,holder:string,seconds:number):Promise<LedgerTask|null>{
    const ttl=z.number().int().min(1).max(300).parse(seconds);
    const r=await this.pool.query<Row>(this.sql(`UPDATE @T@ SET
      holder=$2,fence=fence+1,
      lease_until=clock_timestamp()+make_interval(secs=>$3::int),
      updated_at=clock_timestamp()
      WHERE id=$1 AND state IN ('cancelling','reconciling')
        AND (holder IS NULL OR lease_until<clock_timestamp())
      RETURNING *`),[uuid(id),uuid(holder),ttl]);
    return r.rows[0]?fromRow(r.rows[0]):null;
  }
  /**
   * Must be called only after remote cancellation completed or remote
   * nonexistence was independently verified by the recovery controller.
   */
  async acknowledgeCleanup(id:string,holder:string,fence:string,state:"cancelled"|"failed"):Promise<boolean>{
    const r=await this.pool.query(this.sql(`UPDATE @T@ SET
      state=$4,holder=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id=$1 AND holder=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()
        AND ((state='cancelling' AND $4='cancelled') OR
             (state='reconciling' AND $4='failed'))
      RETURNING id`),[uuid(id),uuid(holder),epoch(fence),state]);
    return r.rowCount===1;
  }
  /** Expiry is NOT a retry: remote Actions may still be running. */
  async flagExpired(limit=10):Promise<LedgerTask[]>{
    const r=await this.pool.query<Row>(this.sql(`WITH expired AS (
      SELECT id FROM @T@
      WHERE state IN ('provisioning','ready','running') AND lease_until<clock_timestamp()
      ORDER BY updated_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
      UPDATE @T@ SET state='reconciling',fence=fence+1,
        holder=NULL,lease_until=NULL,updated_at=clock_timestamp()
      FROM expired WHERE @T@.id=expired.id RETURNING @T@.*`),
      [z.number().int().min(1).max(100).parse(limit)]);
    return r.rows.map(fromRow);
  }
}