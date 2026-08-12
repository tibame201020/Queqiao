import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { queqiao: "apps/cli/src/index.ts", "queqiao-gateway": "apps/gateway/src/index.ts", "queqiao-worker": "apps/worker/src/index.ts" },
  outdir: "dist", bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false,
  legalComments: "external", banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
