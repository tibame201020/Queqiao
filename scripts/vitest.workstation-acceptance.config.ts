import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/cli-protocol-flow-e2e.test.ts",
      "scripts/workstation-isolated-verify.test.ts",
      "apps/cli/src/workstation-ui-v2.test.tsx",
      "scripts/workstation-enrollment-e2e.test.tsx",
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
