import { readFile, rm } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";

const internalPackages = new Map(["config", "contracts", "core-manifest", "mcp-compat", "operations", "platform-paths", "policy", "process-runtime", "protocol", "security", "tool-runtime", "worker-protocol", "workspace"].map((name) => [`@queqiao/${name}`, path.resolve(`packages/${name}/src/index.ts`)]));
const internalSourcePlugin = { name: "queqiao-internal-source", setup(build) { build.onResolve({ filter: /^@queqiao\// }, (args) => ({ path: internalPackages.get(args.path) || "", ...(internalPackages.has(args.path) ? {} : { errors: [{ text: `Unknown internal package: ${args.path}` }] }) })); } };
const inkProductionPlugin = {
  name: "queqiao-ink-production",
  setup(build) {
    // Ink exposes React DevTools as an optional peer behind DEV=true. Bundling that peer
    // changes its module initialization order, so production Queqiao intentionally omits it.
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: "react-devtools-core", namespace: "queqiao-ink-optional" }));
    build.onLoad({ filter: /.*/, namespace: "queqiao-ink-optional" }, () => ({
      contents: "export default { initialize() {}, connectToDevTools() {} };",
      loader: "js",
    }));
  },
};

const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const outdir = path.resolve(process.env.QUEQIAO_BUILD_OUTDIR || "dist");

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: { queqiao: "apps/cli/src/index.ts", "queqiao-gateway": "apps/gateway/src/index.ts", "queqiao-worker": "apps/worker/src/index.ts", "queqiao-extension": "packages/extension-sdk/src/index.ts" },
  outdir, bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false,
  legalComments: "external", banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  define: { __QUEQIAO_VERSION__: JSON.stringify(packageJson.version) },
  plugins: [internalSourcePlugin, inkProductionPlugin],
});
