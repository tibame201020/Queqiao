import { createHash, timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export type DurableWorkerMembershipCredential = { gateway: string; credential: string };
export type StagedWorkerMembershipCredential = DurableWorkerMembershipCredential & { transactionId: string };

export class WorkerMembershipCredentialRegistry {
  private readonly durable = new Map<string, string>();
  private readonly staged = new Map<string, StagedWorkerMembershipCredential>();

  replaceDurable(records: readonly DurableWorkerMembershipCredential[]): void {
    this.durable.clear();
    for (const record of records) {
      if (Buffer.byteLength(record.credential) < 32) throw new Error(`Invalid membership credential for ${record.gateway}`);
      this.durable.set(new URL(record.gateway).href, record.credential);
    }
  }

  stage(input: StagedWorkerMembershipCredential): void {
    if (!input.transactionId || input.transactionId.length > 128) throw new Error("Invalid membership transaction id");
    if (Buffer.byteLength(input.credential) < 32) throw new Error("Invalid provisional membership credential");
    const gateway = new URL(input.gateway).href;
    if (this.staged.has(input.transactionId)) throw new Error(`Membership transaction is already staged: ${input.transactionId}`);
    this.staged.set(input.transactionId, { ...input, gateway });
  }

  commit(transactionId: string): void {
    const staged = this.staged.get(transactionId);
    if (!staged) throw new Error(`Membership transaction is not staged: ${transactionId}`);
    this.durable.set(staged.gateway, staged.credential);
    this.staged.delete(transactionId);
  }

  revoke(transactionId: string): void { this.staged.delete(transactionId); }

  accepts(credential: string): boolean {
    if (Buffer.byteLength(credential) < 32) return false;
    for (const value of this.durable.values()) if (safeEqual(value, credential)) return true;
    for (const value of this.staged.values()) if (safeEqual(value.credential, credential)) return true;
    return false;
  }
}
