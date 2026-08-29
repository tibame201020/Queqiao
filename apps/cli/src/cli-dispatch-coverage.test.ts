import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CLI_LEAF_CONTRACTS, resolveCliDispatch } from "./command-surface.js";

describe("production CLI dispatch coverage", () => {
  it.each(CLI_LEAF_CONTRACTS)("resolves $route to its production handler", (contract) => {
    const input = contract.route.split(" ");
    expect(resolveCliDispatch(input)).toMatchObject({ route: contract.route, handler: contract.handler });
  });

  it("contains an explicit production branch for every handler used by public leaves", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    for (const handler of new Set(CLI_LEAF_CONTRACTS.map((contract) => contract.handler))) {
      expect(source, `missing production handler branch for ${handler}`).toContain(`handler === \"${handler}\"`);
    }
  });
});
