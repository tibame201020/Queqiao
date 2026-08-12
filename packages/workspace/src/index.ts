import { constants, type Stats } from "node:fs";
import { access, chmod, lstat, open, readFile, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_TEXT_MUTATION_BYTES } from "@queqiao/protocol";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const DEFAULT_IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
export type DirectoryEntry = { path: string; name: string; type: "file" | "directory" | "symlink" | "other"; size?: number };
export type TextMatch = { path: string; line: number; column: number; preview: string };

export class SafeWorkspace {
  readonly root: string;
  private canonicalRoot = "";

  constructor(root: string) { this.root = path.resolve(root); }

  async initialize(): Promise<void> {
    const info = await stat(this.root);
    if (!info.isDirectory()) throw new Error(`Workspace root is not a directory: ${this.root}`);
    await access(this.root, constants.R_OK);
    this.canonicalRoot = await realpath(this.root);
  }

  private assertInitialized(): void {
    if (!this.canonicalRoot) throw new Error("Workspace is not initialized");
  }

  private isInside(candidate: string): boolean {
    const relative = path.relative(this.canonicalRoot, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  }

  private lexicalPath(relativePath: string): string {
    this.assertInitialized();
    if (!relativePath || path.isAbsolute(relativePath)) throw new Error("Path must be relative to the workspace");
    const lexical = path.resolve(this.canonicalRoot, relativePath);
    if (!this.isInside(lexical)) throw new Error("Path escapes the workspace");
    return lexical;
  }

  private async existingFile(relativePath: string): Promise<{ absolute: string; info: Stats }> {
    const lexical = this.lexicalPath(relativePath);
    const linkInfo = await lstat(lexical);
    if (linkInfo.isSymbolicLink()) throw new Error("Symbolic-link files are not supported");
    const absolute = await realpath(lexical);
    if (!this.isInside(absolute)) throw new Error("Path escapes the workspace");
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("Path is not a file");
    if (info.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes`);
    return { absolute, info };
  }

  private async writableTarget(relativePath: string): Promise<{ absolute: string; existing?: Stats }> {
    const absolute = this.lexicalPath(relativePath);
    const canonicalParent = await realpath(path.dirname(absolute));
    if (!this.isInside(canonicalParent)) throw new Error("Parent directory escapes the workspace");
    const target = path.join(canonicalParent, path.basename(absolute));
    let existing: Stats | undefined;
    try {
      existing = await lstat(target);
      if (existing.isSymbolicLink()) throw new Error("Symbolic-link files are not supported");
      if (!existing.isFile()) throw new Error("Path is not a file");
      if (existing.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    return { absolute: target, ...(existing ? { existing } : {}) };
  }

  private async atomicWrite(relativePath: string, content: string): Promise<{ path: string; bytes: number }> {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_TEXT_MUTATION_BYTES) throw new Error(`Content exceeds ${MAX_TEXT_MUTATION_BYTES} bytes`);
    const target = await this.writableTarget(relativePath);
    const temporary = path.join(path.dirname(target.absolute), `.queqiao-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", target.existing?.mode ?? 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (target.existing) await chmod(temporary, target.existing.mode);
      await rename(temporary, target.absolute);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return { path: relativePath.replaceAll("\\", "/"), bytes };
  }

  async read(relativePath: string, offset: number, limit: number) {
    const { absolute } = await this.existingFile(relativePath);
    const buffer = await readFile(absolute);
    if (buffer.includes(0)) throw new Error("Binary files are not supported");
    const lines = buffer.toString("utf8").split(/\r?\n/);
    const selected = lines.slice(offset, offset + limit);
    return { path: relativePath.replaceAll("\\", "/"), offset, limit, startLine: selected.length ? offset + 1 : 0, endLine: offset + selected.length, totalLines: lines.length, text: selected.join("\n") };
  }

  async resolveDirectory(relativePath = "."): Promise<string> {
    const lexical = this.lexicalPath(relativePath);
    const absolute = await realpath(lexical);
    if (!this.isInside(absolute)) throw new Error("Directory escapes the workspace");
    const info = await stat(absolute);
    if (!info.isDirectory()) throw new Error("Working directory is not a directory");
    return absolute;
  }

  async listDirectory(relativePath = ".", depth = 1, limit = 500, cursor?: string, includeHidden = false) {
    if (!Number.isInteger(depth) || depth < 1 || depth > 5) throw new Error("depth must be between 1 and 5");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit must be between 1 and 1000");
    const offset = decodeCursor(cursor);
    if (offset > 100_000) throw new Error("Directory cursor exceeds the traversal limit");
    const requiredEntries = offset + limit + 1;
    const root = await this.resolveDirectory(relativePath);
    const entries: DirectoryEntry[] = [];
    const walk = async (directory: string, prefix: string, remainingDepth: number): Promise<boolean> => {
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name, "en"));
      for (const child of children) {
        if (entries.length >= requiredEntries) return false;
        if (!includeHidden && child.name.startsWith(".")) continue;
        const relative = prefix ? `${prefix}/${child.name}` : child.name;
        const absolute = path.join(directory, child.name);
        if (child.isSymbolicLink()) { entries.push({ path: relative, name: child.name, type: "symlink" }); continue; }
        if (child.isDirectory()) {
          entries.push({ path: relative, name: child.name, type: "directory" });
          if (remainingDepth > 1 && !DEFAULT_IGNORED_DIRECTORIES.has(child.name) && !(await walk(absolute, relative, remainingDepth - 1))) return false;
          continue;
        }
        if (child.isFile()) { entries.push({ path: relative, name: child.name, type: "file", size: (await stat(absolute)).size }); continue; }
        entries.push({ path: relative, name: child.name, type: "other" });
      }
      return true;
    };
    await walk(root, relativePath === "." ? "" : relativePath.replaceAll("\\", "/").replace(/^\.\//, ""), depth);
    if (offset > entries.length) throw new Error("Invalid directory cursor");
    const selected = entries.slice(offset, offset + limit);
    const nextOffset = offset + selected.length;
    return { path: relativePath.replaceAll("\\", "/"), entries: selected, nextCursor: nextOffset < entries.length ? encodeCursor(nextOffset) : null, truncated: nextOffset < entries.length };
  }

  async searchText(input: { query: string; path?: string; globs?: string[]; maxResults?: number; caseSensitive?: boolean; timeoutMs?: number; signal?: AbortSignal }) {
    if (!input.query) throw new Error("query must not be empty");
    const maxResults = input.maxResults ?? 100;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 500) throw new Error("maxResults must be between 1 and 500");
    const timeoutMs = input.timeoutMs ?? 10_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error("timeoutMs must be between 100 and 30000");
    const startedAt = Date.now();
    const searchRoot = await this.resolveDirectory(input.path ?? ".");
    const basePrefix = (input.path ?? ".") === "." ? "" : (input.path ?? ".").replaceAll("\\", "/").replace(/^\.\//, "");
    const patterns = (input.globs ?? []).map(globRegex);
    const needle = input.caseSensitive ? input.query : input.query.toLocaleLowerCase();
    const matches: TextMatch[] = [];
    let filesScanned = 0;
    let filesSkipped = 0;
    let timedOut = false;
    const ensureActive = () => {
      if (input.signal?.aborted) throw input.signal.reason ?? new Error("Search aborted");
      if (Date.now() - startedAt >= timeoutMs) { timedOut = true; return false; }
      return true;
    };
    const walk = async (directory: string, prefix: string): Promise<boolean> => {
      if (!ensureActive()) return false;
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name, "en"));
      for (const child of children) {
        if (!ensureActive()) return false;
        if (child.name.startsWith(".") || DEFAULT_IGNORED_DIRECTORIES.has(child.name)) continue;
        const relative = prefix ? `${prefix}/${child.name}` : child.name;
        const absolute = path.join(directory, child.name);
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory()) { if (!(await walk(absolute, relative))) return false; continue; }
        if (!child.isFile() || (patterns.length && !patterns.some((pattern) => pattern.test(relative)))) continue;
        const info = await stat(absolute);
        if (info.size > MAX_SEARCH_FILE_BYTES) { filesSkipped += 1; continue; }
        const buffer = await readFile(absolute);
        if (buffer.includes(0)) { filesSkipped += 1; continue; }
        filesScanned += 1;
        const lines = buffer.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]!;
          const haystack = input.caseSensitive ? line : line.toLocaleLowerCase();
          let column = haystack.indexOf(needle);
          while (column >= 0) {
            matches.push({ path: relative, line: index + 1, column: column + 1, preview: line.slice(0, 500) });
            if (matches.length >= maxResults) return false;
            column = haystack.indexOf(needle, column + Math.max(1, needle.length));
          }
        }
      }
      return true;
    };
    await walk(searchRoot, basePrefix);
    return { query: input.query, path: input.path ?? ".", matches, filesScanned, filesSkipped, truncated: matches.length >= maxResults, timedOut, durationMs: Date.now() - startedAt };
  }

  write(relativePath: string, content: string) { return this.atomicWrite(relativePath, content); }

  async edit(relativePath: string, oldText: string, newText: string) {
    if (!oldText) throw new Error("oldText must not be empty");
    const { absolute } = await this.existingFile(relativePath);
    const buffer = await readFile(absolute);
    if (buffer.includes(0)) throw new Error("Binary files are not supported");
    const content = buffer.toString("utf8");
    const first = content.indexOf(oldText);
    if (first < 0) throw new Error("oldText was not found");
    if (content.indexOf(oldText, first + oldText.length) >= 0) throw new Error("oldText must match exactly once");
    const written = await this.atomicWrite(relativePath, content.slice(0, first) + newText + content.slice(first + oldText.length));
    return { ...written, replacements: 1 };
  }
}

function encodeCursor(offset: number): string { return Buffer.from(String(offset), "utf8").toString("base64url"); }
function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^\d+$/.test(decoded)) throw new Error("Invalid directory cursor");
  return Number(decoded);
}
function globRegex(glob: string): RegExp {
  if (!glob || glob.length > 256 || glob.includes("\0")) throw new Error("Invalid glob");
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*" && glob[index + 2] === "/") { source += "(?:.*/)?"; index += 2; }
    else if (char === "*" && glob[index + 1] === "*") { source += ".*"; index += 1; }
    else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}
