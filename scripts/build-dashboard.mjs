import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function buildDashboard({ clean = true } = {}) {
  const outdir = "dist/dashboard";
  if (clean) await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["apps/dashboard/src/main.tsx"],
    outfile: `${outdir}/app.js`,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["es2022"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
  });
  await copyFile("apps/dashboard/public/index.html", `${outdir}/index.html`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildDashboard();
}
