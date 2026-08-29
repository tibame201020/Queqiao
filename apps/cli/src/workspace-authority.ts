import { realpathSync, statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function resolveWorkspaceAuthorityRoot(value: string): Promise<string> {
  const resolved = path.resolve(value);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`Workspace root is not a directory: ${resolved}`);
  return realpath(resolved);
}

export function workspaceRootsEqual(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  try {
    const leftInfo = statSync(resolvedLeft);
    const rightInfo = statSync(resolvedRight);
    const hasStableIdentity = leftInfo.dev !== 0 || leftInfo.ino !== 0 || rightInfo.dev !== 0 || rightInfo.ino !== 0;
    if (hasStableIdentity && leftInfo.dev === rightInfo.dev && leftInfo.ino === rightInfo.ino) return true;
  } catch {
    // Fall back to path identity below for stale/missing configured roots.
  }

  const canonical = (value: string) => {
    try { return realpathSync(value); } catch { return value; }
  };
  const leftResolved = canonical(resolvedLeft);
  const rightResolved = canonical(resolvedRight);
  if (process.platform === "win32") return leftResolved.toLowerCase() === rightResolved.toLowerCase();
  return leftResolved === rightResolved;
}
