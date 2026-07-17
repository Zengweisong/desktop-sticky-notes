import { describe, expect, it } from "vitest";
import type { WindowState } from "../types/settings";
import { resolveWindowPlacement, type DisplayWorkArea } from "./windowStateManager";

const primary: DisplayWorkArea = { x: 0, y: 0, width: 1920, height: 1040, scaleFactor: 1 };
const baseState: WindowState = {
  x: 200,
  y: 100,
  width: 400,
  height: 580,
  maximized: false,
  scaleFactor: 1
};

describe("resolveWindowPlacement", () => {
  it("centers a window whose saved monitor is no longer connected", () => {
    expect(resolveWindowPlacement({ ...baseState, x: 2500, y: 200 }, [primary])).toMatchObject({
      x: 760,
      y: 230,
      width: 400,
      height: 580
    });
  });

  it("clamps partially visible windows and oversized dimensions to the work area", () => {
    expect(resolveWindowPlacement({ ...baseState, x: 1700, y: 900 }, [primary])).toMatchObject({
      x: 1520,
      y: 460
    });
    expect(resolveWindowPlacement({ ...baseState, width: 2500, height: 1600 }, [primary])).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040
    });
  });

  it("rejects a tiny visible sliver and recenters instead", () => {
    expect(resolveWindowPlacement({ ...baseState, x: 1850, y: 100 }, [primary])).toMatchObject({
      x: 760,
      y: 230
    });
  });

  it("converts legacy physical sizes once and preserves maximized state", () => {
    const scaled: DisplayWorkArea = { x: 1920, y: 0, width: 2560, height: 1400, scaleFactor: 1.25 };
    const placement = resolveWindowPlacement({
      x: 2200,
      y: 100,
      width: 500,
      height: 725,
      maximized: true,
      scaleFactor: null
    }, [primary, scaled]);

    expect(placement).toMatchObject({
      x: 2200,
      y: 100,
      width: 400,
      height: 580,
      maximized: true,
      scaleFactor: 1.25
    });
  });
});
