import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export class ConfigLockedError extends Error {
  constructor(file: string) { super(`Configuration is locked by another Queqiao CLI process: ${file}`); this.name = "ConfigLockedError"; }
}

export class AtomicJsonStore<T> {
  constructor(readonly file: string, private readonly validate: (value: unknown) => T) {}

  async read(): Promise<T> { return this.validate(JSON.parse(await readFile(this.file, "utf8"))); }

  async initialize(value: T): Promise<T> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const validated = this.validate(value);
    const handle = await open(this.file, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8"); }
    finally { await handle.close(); }
    return validated;
  }

  async update(mutator: (current: T) => T): Promise<T> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const lockFile = `${this.file}.lock`;
    let lock;
    try { lock = await open(lockFile, "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ConfigLockedError(this.file); throw error; }
    try {
      const current = await this.read();
      const next = this.validate(mutator(current));
      const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.file);
      return next;
    } finally { await lock.close(); await rm(lockFile, { force: true }); }
  }

  async metadata() { const info = await stat(this.file); return { file: this.file, bytes: info.size, modifiedAt: info.mtime.toISOString() }; }
}
