import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type DiscoveryCandidate = { root: string; name: string };

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveDiscoveryRoot(candidate: string, roots: readonly string[]): Promise<string> {
  const resolved = await realpath(candidate);
  const allowedRoots = await Promise.all(roots.map((root) => realpath(root)));
  if (!allowedRoots.some((root) => within(root, resolved))) throw new Error("Workspace must be inside a configured discovery root");
  const marker = path.join(resolved, ".git");
  if (!(await stat(marker).catch(() => undefined))) throw new Error("Workspace candidate must contain a .git marker");
  return resolved;
}

export async function discoverWorkspaces(roots: readonly string[], maxDepth: number, excludes: readonly string[]): Promise<DiscoveryCandidate[]> {
  const excluded = new Set(excludes.map((value) => process.platform === "win32" ? value.toLowerCase() : value));
  const found = new Map<string, DiscoveryCandidate>();
  const visit = async (directory: string, depth: number): Promise<void> => {
    const canonical = await realpath(directory);
    const entries = await readdir(canonical, { withFileTypes: true });
    if (entries.some((entry) => entry.name === ".git" && (entry.isDirectory() || entry.isFile()))) {
      found.set(process.platform === "win32" ? canonical.toLowerCase() : canonical, { root: canonical, name: path.basename(canonical) });
      return;
    }
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      const key = process.platform === "win32" ? entry.name.toLowerCase() : entry.name;
      if (!entry.isDirectory() || entry.isSymbolicLink() || excluded.has(key)) continue;
      if (entry.name.startsWith(".")) continue;
      await visit(path.join(canonical, entry.name), depth + 1).catch(() => undefined);
    }
  };
  for (const root of roots) await visit(root, 0);
  return [...found.values()].sort((left, right) => left.root.localeCompare(right.root));
}
