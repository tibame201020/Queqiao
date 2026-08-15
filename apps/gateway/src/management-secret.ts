import { randomBytes } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";

export async function ensureGatewayManagementSecret(stateDirectory: string): Promise<{ file: string; secret: string }> {
  await secureRuntimeDirectory(stateDirectory);
  const file = path.join(stateDirectory, "management.secret");
  try {
    const secret = (await readFile(file, "utf8")).trim();
    if (Buffer.byteLength(secret) < 32) throw new Error("Gateway management secret is too short");
    await secureRuntimeFile(file);
    return { file, secret };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32).toString("base64url");
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${secret}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await secureRuntimeFile(file);
  return { file, secret };
}
