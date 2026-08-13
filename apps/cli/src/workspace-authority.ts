import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function resolveWorkspaceAuthorityRoot(value: string): Promise<string> {
  const resolved = path.resolve(value);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`Workspace root is not a directory: ${resolved}`);
  return realpath(resolved);
}
