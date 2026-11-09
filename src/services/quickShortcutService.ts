import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { register as registerGlobal, unregister as unregisterGlobal } from "@tauri-apps/plugin-global-shortcut";

export const DOUBLE_CTRL_SHORTCUT = "Ctrl+Ctrl";
let doubleCtrlListener: UnlistenFn | null = null;

export async function register(shortcut: string, onPress: (event: { state: "Pressed" | "Released" }) => void): Promise<void> {
  if (shortcut !== DOUBLE_CTRL_SHORTCUT) {
    await registerGlobal(shortcut, onPress);
    return;
  }
  const unlisten = await listen("double-ctrl-shortcut", () => onPress({ state: "Pressed" }));
  try {
    await invoke("set_double_ctrl_shortcut", { enabled: true });
    doubleCtrlListener?.();
    doubleCtrlListener = unlisten;
  } catch (error) {
    unlisten();
    throw error;
  }
}

export async function unregister(shortcut: string): Promise<void> {
  if (shortcut !== DOUBLE_CTRL_SHORTCUT) {
    await unregisterGlobal(shortcut);
    return;
  }
  await invoke("set_double_ctrl_shortcut", { enabled: false });
  doubleCtrlListener?.();
  doubleCtrlListener = null;
}
