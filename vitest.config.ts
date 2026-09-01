import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx", "apps/*/src/**/*.test.tsx"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    maxWorkers: 4,
  },
});
