import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("overlay animation performance", () => {
  it("keeps moving overlays on compositor-friendly properties", () => {
    for (const selector of [".settings-drawer", ".category-manager"]) {
      const start = css.indexOf(selector);
      const rule = start >= 0 ? css.slice(start, css.indexOf("}", start)) : "";
      expect(rule).toContain("translate3d");
      expect(rule).toContain("will-change: transform");
      expect(rule).not.toContain("backdrop-filter");
      expect(rule).not.toContain("visibility");
    }

    const backdropStart = css.indexOf(".drawer-backdrop");
    const backdropRule = backdropStart >= 0 ? css.slice(backdropStart, css.indexOf("}", backdropStart)) : "";
    expect(backdropRule).toContain("will-change: opacity");
    expect(backdropRule).not.toContain("backdrop-filter");
  });
});
