import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Options {
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
  const requestClose = useCallback(() => setOpen(true), []);
  const cancel = useCallback(() => { if (!pending.current) setOpen(false); }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("window-close-requested", requestClose).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => latest.current.onError("无法监听窗口关闭操作"));
    return () => { disposed = true; unlisten?.(); };
  }, [requestClose]);

  const choose = useCallback(async (action: "quit" | "minimize") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await latest.current.beforeClose();
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

  return { open, busy, requestClose, cancel, choose };
}
