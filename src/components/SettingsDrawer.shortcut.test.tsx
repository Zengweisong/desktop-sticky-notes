// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../types/settings";
import { SettingsDrawer } from "./SettingsDrawer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("shortcut recording", () => {
  let root: Root;
  let container: HTMLDivElement;
  let button: HTMLButtonElement;
  let now: number;
  const onShortcutChange = vi.fn();
  const onShortcutRecordingChange = vi.fn();
  beforeEach(async () => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    onShortcutChange.mockReset().mockResolvedValue(true);
    onShortcutRecordingChange.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<SettingsDrawer open settings={DEFAULT_SETTINGS} completedCount={0}
      onClose={() => {}} onUpdate={async () => {}} onClearCompleted={async () => true}
      onLaunchOnStartupChange={async () => true} onShortcutChange={onShortcutChange}
      onShortcutRecordingChange={onShortcutRecordingChange}
      onImported={async () => {}} toast={() => {}} />));
    button = container.querySelector<HTMLButtonElement>(".shortcut-card")!;
    await act(async () => button.click());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function key(type: "keydown" | "keyup", ms: number, init: KeyboardEventInit = {}) {
    now = ms;
    await act(async () => button.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true, key: "Control", code: "ControlLeft", ctrlKey: type === "keydown", ...init
    })));
  }

  it("records two short Ctrl taps when the second key is released", async () => {
    await key("keydown", 0); await key("keyup", 40); await key("keydown", 140);
    expect(onShortcutChange).not.toHaveBeenCalled();
    await key("keyup", 180);
    expect(onShortcutChange).toHaveBeenCalledWith("Ctrl+Ctrl");
    expect(onShortcutChange).toHaveBeenCalledOnce();
    expect(onShortcutRecordingChange).toHaveBeenCalledWith(true);
    expect(onShortcutRecordingChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores long holds, repeated keydown and taps outside the time window", async () => {
    await key("keydown", 0); await key("keydown", 100, { repeat: true }); await key("keyup", 350);
    await key("keydown", 400); await key("keyup", 450);
    await key("keydown", 900); await key("keyup", 950);
    expect(onShortcutChange).not.toHaveBeenCalled();
  });

  it("still records normal combinations and supports Escape to cancel", async () => {
    await key("keydown", 0, { key: "Escape", code: "Escape", ctrlKey: false });
    await key("keydown", 40); await key("keyup", 80); await key("keydown", 120); await key("keyup", 160);
    expect(onShortcutChange).not.toHaveBeenCalled();
    await act(async () => button.click());
    await key("keydown", 200, { key: " ", code: "Space", ctrlKey: true, altKey: true });
    expect(onShortcutChange).toHaveBeenCalledWith("Ctrl+Alt+Space");
  });
});
