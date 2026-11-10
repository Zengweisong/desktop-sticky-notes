import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CloseAction } from "../types/settings";

interface Options {
  closeAction: CloseAction;
  rememberAction: (action: Exclude<CloseAction, "ask">) => Promise<void>;
  hideWindow: () => Promise<void>;
  beforeClose: () => Promise<void>;
  onError: (message: string) => void;
}

export function useWindowClose(options: Options) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const latest = useRef(options);
  latest.current = options;
  const cancel = useCallback(() => { if (!pending.current) setOpen(false); }, []);

  const choose = useCallback(async (action: "quit" | "minimize") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await latest.current.beforeClose();
      if (latest.current.closeAction !== action) await latest.current.rememberAction(action);
      if (action === "quit") {
        await invoke("quit_app");
      } else {
        await latest.current.hideWindow();
        await invoke("set_background_visible", { visible: false });
      }
      setOpen(false);
    } catch {
      latest.current.onError(action === "quit" ? "关闭应用失败，请重试" : "最小化失败，请重试");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);

  const requestClose = useCallback(() => {
    if (pending.current) return;
    const action = latest.current.closeAction;
    if (action === "ask") setOpen(true);
    else void choose(action);
  }, [choose]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("window-close-requested", requestClose).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => latest.current.onError("无法监听窗口关闭操作"));
    return () => { disposed = true; unlisten?.(); };
  }, [requestClose]);

  return { open, busy, requestClose, cancel, choose };
}
