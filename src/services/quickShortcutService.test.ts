import { beforeEach, describe, expect, it, vi } from "vitest";
import { register, unregister } from "./quickShortcutService";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), register: vi.fn(), unregister: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register: native.register, unregister: native.unregister }));

describe("quick shortcut registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.invoke.mockResolvedValue(undefined);
    native.register.mockResolvedValue(undefined);
    native.unregister.mockResolvedValue(undefined);
  });

  it("keeps normal shortcut combinations on the existing global shortcut API", async () => {
    const onPress = vi.fn();
    await register("Ctrl+Alt+Space", onPress);
    expect(native.register).toHaveBeenCalledWith("Ctrl+Alt+Space", onPress);
    await unregister("Ctrl+Alt+Space");
    expect(native.unregister).toHaveBeenCalledWith("Ctrl+Alt+Space");
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("listens before enabling double Ctrl, forwards presses and removes its listener on disable", async () => {
    const unlisten = vi.fn();
    const onPress = vi.fn();
    native.listen.mockResolvedValue(unlisten);
    await register("Ctrl+Ctrl", onPress);
    expect(native.listen).toHaveBeenCalledWith("double-ctrl-shortcut", expect.any(Function));
    expect(native.listen.mock.invocationCallOrder[0]).toBeLessThan(native.invoke.mock.invocationCallOrder[0]);
    native.listen.mock.calls[0][1]();
    expect(onPress).toHaveBeenCalledWith({ state: "Pressed" });
    expect(native.invoke).toHaveBeenCalledWith("set_double_ctrl_shortcut", { enabled: true });
    expect(native.register).not.toHaveBeenCalled();
    await unregister("Ctrl+Ctrl");
    expect(native.invoke).toHaveBeenLastCalledWith("set_double_ctrl_shortcut", { enabled: false });
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("cleans up the listener when Windows hook registration is unavailable", async () => {
    const unlisten = vi.fn();
    native.listen.mockResolvedValue(unlisten);
    native.invoke.mockRejectedValueOnce(new Error("hook unavailable"));
    await expect(register("Ctrl+Ctrl", vi.fn())).rejects.toThrow("hook unavailable");
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
