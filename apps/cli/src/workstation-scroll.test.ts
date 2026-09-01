import { describe, expect, it } from "vitest";
import { clampScrollOffset, ensureVisibleScrollOffset } from "./workstation-scroll.js";

describe("Workstation scroll geometry", () => {
  it("clamps offsets to the measured viewport bounds", () => {
    expect(clampScrollOffset(-3, 20, 5)).toBe(0);
    expect(clampScrollOffset(4, 20, 5)).toBe(4);
    expect(clampScrollOffset(99, 20, 5)).toBe(15);
    expect(clampScrollOffset(4, 3, 5)).toBe(0);
  });

  it("keeps a selected row visible without jumping when it is already in view", () => {
    expect(ensureVisibleScrollOffset(5, { start: 6 }, 30, 8)).toBe(5);
    expect(ensureVisibleScrollOffset(5, { start: 3 }, 30, 8)).toBe(3);
    expect(ensureVisibleScrollOffset(5, { start: 13 }, 30, 8)).toBe(6);
  });

  it("accounts for multi-row options when ensuring visibility", () => {
    expect(ensureVisibleScrollOffset(0, { start: 8, height: 2 }, 20, 6)).toBe(4);
    expect(ensureVisibleScrollOffset(12, { start: 8, height: 2 }, 20, 6)).toBe(8);
  });
});
