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

describe("quick category menu layering", () => {
  it("raises the transformed input stacking context and keeps the menu opaque", () => {
    const openRule = css.match(/\.quick-input-wrap\.category-menu-open\s*\{([^}]*)\}/)?.[1] ?? "";
    const navigationRule = css.match(/\.category-nav\s*\{([^}]*)\}/)?.[1] ?? "";
    const menuRule = css.match(/\.quick-category-menu\s*\{([^}]*)\}/)?.[1] ?? "";
    const openLayer = Number(openRule.match(/z-index:\s*(\d+)/)?.[1] ?? 0);
    const navigationLayer = Number(navigationRule.match(/z-index:\s*(\d+)/)?.[1] ?? 0);

    expect(openLayer).toBeGreaterThan(navigationLayer);
    expect(menuRule).toContain("background: rgb(var(--panel-rgb))");
    expect(menuRule).not.toContain("background: rgba");
    expect(menuRule).not.toContain("backdrop-filter");
  });
});

describe("main list scrolling", () => {
  it("keeps wheel scrolling while hiding the WebView scrollbar", () => {
    const viewportRule = css.match(/\.content-viewport\s*\{([^}]*)\}/)?.[1] ?? "";
    const scrollbarRule = css.match(/\.content-viewport::\-webkit-scrollbar\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(viewportRule).toContain("overflow-y: auto");
    expect(viewportRule).toContain("scrollbar-width: none");
    expect(scrollbarRule).toContain("width: 0");
  });
});

describe("compact filter popover", () => {
  it("anchors the filter panel to the full navigation row at narrow widths", () => {
    const compactStart = css.indexOf("@media (max-width: 400px)");
    const compactEnd = css.indexOf("@media (max-width: 620px)", compactStart);
    const compactRules = compactStart >= 0 ? css.slice(compactStart, compactEnd) : "";
    const pickerRule = compactRules.match(/\.category-filter-picker\s*\{([^}]*)\}/)?.[1] ?? "";
    const popoverRule = compactRules.match(/\.category-filter-popover\s*\{([^}]*)\}/)?.[1] ?? "";
    const coveredListRule = compactRules.match(/\.list-area:has\(\.category-filter-popover\)\s*\{([^}]*)\}/)?.[1] ?? "";
    const coveredViewportRule = compactRules.match(/\.list-area:has\(\.category-filter-popover\) \.content-viewport\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(pickerRule).toContain("position: static");
    expect(popoverRule).toContain("left: 0");
    expect(popoverRule).toContain("right: 4px");
    expect(popoverRule).toContain("width: auto");
    expect(coveredListRule).toContain("overflow-y: hidden");
    expect(coveredViewportRule).toContain("overflow-y: hidden");
  });
});

describe("minimal mode layout", () => {
  it("hides the app title and compacts the title, input, and filter rows", () => {
    const panelRule = css.match(/\.minimal-mode \.panel\s*\{([^}]*)\}/)?.[1] ?? "";
    const titleRule = css.match(/\.minimal-mode \.app-title\s*\{([^}]*)\}/)?.[1] ?? "";
    const inputRule = css.match(/\.quick-input-wrap\.minimal \.quick-input-row\s*\{([^}]*)\}/)?.[1] ?? "";
    const navigationRule = css.match(/\.minimal-mode \.category-nav\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(panelRule).toContain("grid-template-rows: 40px");
    expect(titleRule).toContain("display: none");
    expect(inputRule).toContain("minmax(0, 1fr) 32px 38px");
    expect(inputRule).toContain("gap: 4px");
    expect(navigationRule).toContain("min-height: 30px");
  });
});

describe("schedule form layout", () => {
  it("keeps the advanced panel inside its parent width", () => {
    const panelRule = css.match(/\.quick-advanced-panel\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(panelRule).toContain("width: 100%");
    expect(panelRule).toContain("max-width: 100%");
    expect(panelRule).toContain("overflow-x: hidden");
    expect(panelRule).toContain("margin: 0");
    expect(panelRule).not.toMatch(/flex:\s*0\s+0\s+100%/);
  });

  it("keeps primary settings balanced, time fields equal, and room for select arrows", () => {
    const primaryGrid = css.match(/\.schedule-primary-row\s*\{([^}]*)\}/)?.[1] ?? "";
    const planGrid = css.match(/\.plan-time-row\s*\{([^}]*)\}/)?.[1] ?? "";
    const controlsRule = css.match(/\.note-edit-form textarea,[\s\S]*?\.custom-offset-row select\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(primaryGrid).toContain("minmax(0, 1fr) minmax(132px, .65fr)");
    expect(planGrid).toContain("minmax(0, 1fr) minmax(0, 1fr)");
    expect(controlsRule).toMatch(/padding:\s*0\s+40px\s+0\s+14px/);
    expect(css).not.toContain(".advanced-classification");
  });

  it("stacks primary settings before time fields at narrow breakpoints", () => {
    const narrowRule = css.match(/@media \(max-width: 380px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const smallestRule = css.match(/@media \(max-width: 350px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(narrowRule).toContain(".schedule-primary-row");
    expect(narrowRule).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(smallestRule).toContain(".plan-time-row");
    expect(smallestRule).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});

describe("Markdown list markers", () => {
  it("restores unordered and ordered markers after the Tailwind reset", () => {
    const unorderedRule = css.match(/(?:^|\n)\.markdown-content ul\s*\{([^}]*)\}/)?.[1] ?? "";
    const orderedRule = css.match(/(?:^|\n)\.markdown-content ol\s*\{([^}]*)\}/)?.[1] ?? "";
    const taskRule = css.match(/\.markdown-content \.contains-task-list\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(unorderedRule).toContain("list-style: disc");
    expect(orderedRule).toContain("list-style: decimal");
    expect(taskRule).toContain("list-style: none");
  });
});
