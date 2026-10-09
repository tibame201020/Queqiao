import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import net from "node:net";

/**
 * Single-host guard for an existing JSON-based Gateway stateDirectory.
 * The OS owns a deterministic loopback socket while this process
 * holds Gateway state. SIGKILL closes it without unsafe stale-file deletion.
 *
 * This is NOT a distributed lock. Any port collision denies startup.
 * Multiple hosts or network namespaces remain unsupported.
 */
export async function acquireGatewayStateOwner(stateDirectory: string): Promise<{
  lockPort: number;
  release: () => Promise<void>;
}> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(stateDirectory);
  const identity = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const hash = createHash("sha256").update(identity).digest();
  const lockPort = 30000 + hash.readUInt32BE(0) % 16000;
  const server = net.createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: lockPort, exclusive: true }, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE" || code === "EACCES") {
      throw new Error("Gateway state directory already owned or unavailable on this host; refusing concurrent state recovery", { cause: error });
    }
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    lockPort,
    release: () => {
      if (!closing) {
        closing = new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
      return closing;
    },
  };
}
