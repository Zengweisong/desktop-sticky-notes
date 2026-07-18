// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../types/settings";
import { CategoryManager } from "./CategoryManager";
import { SettingsDrawer } from "./SettingsDrawer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("drawer focus", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

  it("opens category management without scrolling the app shell", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    await render(<CategoryManager open categories={[]} onClose={() => {}}
      onCreate={async () => true} onUpdate={async () => true} onMove={async () => true}
      onDelete={async () => true} countNotes={async () => 0} />);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("opens settings without scrolling the app shell", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    await render(<SettingsDrawer open settings={DEFAULT_SETTINGS} completedCount={0} onClose={() => {}}
      onUpdate={async () => {}} onClearCompleted={async () => true}
      onLaunchOnStartupChange={async () => true} onShortcutChange={async () => true}
      onImported={async () => {}} toast={() => {}} />);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  async function render(element: ReactNode) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(element));
  }
});
