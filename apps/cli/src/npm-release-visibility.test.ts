import { describe, expect, it } from "vitest";
import { probeNpmRelease, waitForNpmReleaseVisibility } from "../../../scripts/npm-release-visibility.js";

function packument(versionVisible: boolean, latest = "0.9.15") {
  return new Response(JSON.stringify({
    versions: versionVisible ? { "0.9.16": {} } : { "0.9.15": {} },
    "dist-tags": { latest },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("npm release visibility", () => {
  it("treats an exact version as visible independently from the latest dist-tag", async () => {
    const state = await probeNpmRelease("@tibame201020/queqiao", "0.9.16", async () => packument(true, "0.9.15") as any);
    expect(state).toMatchObject({ visible: true, latestMatches: false, latest: "0.9.15", status: 200 });
  });

  it("waits until both the exact version and latest dist-tag are public", async () => {
    const responses = [packument(false), packument(true, "0.9.15"), packument(true, "0.9.16")];
    let index = 0;
    let clock = 0;
    const state = await waitForNpmReleaseVisibility({
      packageName: "@tibame201020/queqiao",
      version: "0.9.16",
      fetchImpl: (async () => responses[Math.min(index++, responses.length - 1)]!) as typeof fetch,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
      timeoutMs: 30,
      intervalMs: 10,
    });
    expect(state).toMatchObject({ visible: true, latestMatches: true, latest: "0.9.16" });
    expect(index).toBe(3);
  });

  it("fails boundedly when npm accepts a publish but never exposes the version", async () => {
    let clock = 0;
    await expect(waitForNpmReleaseVisibility({
      packageName: "@tibame201020/queqiao",
      version: "0.9.16",
      fetchImpl: (async () => packument(false)) as typeof fetch,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
      timeoutMs: 20,
      intervalMs: 10,
    })).rejects.toThrow(/not publicly ready.*visible=false.*latest=0\.9\.15/);
  });
});
