import { rm } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";

const internalPackages = new Map(["config", "platform-paths", "policy", "process-runtime", "protocol", "security", "tool-runtime", "workspace"].map((name) => [`@queqiao/${name}`, path.resolve(`packages/${name}/src/index.ts`)]));
const internalSourcePlugin = { name: "queqiao-internal-source", setup(build) { build.onResolve({ filter: /^@queqiao\// }, (args) => ({ path: internalPackages.get(args.path) || "", ...(internalPackages.has(args.path) ? {} : { errors: [{ text: `Unknown internal package: ${args.path}` }] }) })); } };

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { queqiao: "apps/cli/src/index.ts", "queqiao-gateway": "apps/gateway/src/index.ts", "queqiao-worker": "apps/worker/src/index.ts" },
  outdir: "dist", bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false,
  legalComments: "external", banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [internalSourcePlugin],
});
