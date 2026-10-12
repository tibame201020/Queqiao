import { writeFile } from "node:fs/promises";
import path from "node:path";

// No input is evaluated. This entrypoint is pinned by the Worker exact-argv policy.
// The marker establishes that the actual remote process started before cancellation.
const marker = path.join(process.cwd(), "runtime-cancel-smoke.started");
await writeFile(marker, "QUEQIAO_ACTIONS_CLI_STARTED\n", { encoding: "utf8", flag: "w", mode: 0o600 });
process.stdout.write("QUEQIAO_ACTIONS_CLI_STARTED\n");
await new Promise((resolve) => setTimeout(resolve, 85_000));
process.stdout.write("QUEQIAO_ACTIONS_CLI_COMPLETED\n");
