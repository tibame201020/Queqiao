import { readFile, stat } from "node:fs/promises";

export class WorkerCredentialSource {
  private cached: { token: string; mtimeMs: number } | undefined;

  constructor(readonly file: string) {}

  async current(): Promise<string> {
    const info = await stat(this.file);
    if (this.cached && info.mtimeMs === this.cached.mtimeMs) return this.cached.token;
    const token = (await readFile(this.file, "utf8")).trim();
    if (Buffer.byteLength(token) < 32) throw new Error("Worker credential must be at least 32 bytes");
    this.cached = { token, mtimeMs: info.mtimeMs };
    return token;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}
