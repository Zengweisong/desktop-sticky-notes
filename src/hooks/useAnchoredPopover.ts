import { useEffect, useLayoutEffect, useRef } from "react";

export function useAnchoredPopover(open: boolean, dismiss: () => void, { compact = false, matchAnchor = false } = {}) {
  const field = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = field.current?.getBoundingClientRect();
      const panel = popup.current;
      if (!anchor || !panel) return;
      const margin = 10;
      const gap = 7;
      const above = anchor.top - gap;
      const below = window.innerHeight - anchor.bottom - gap;
      if (matchAnchor) {
        panel.style.setProperty("--popover-anchor-width", `${anchor.width}px`);
        panel.style.setProperty("--popover-room", `${Math.max(above, below) - margin}px`);
      }
      const top = panel.offsetHeight <= above || above >= below
        ? above - panel.offsetHeight
        : anchor.bottom + gap;
      panel.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - panel.offsetHeight - margin))}px`;
      const left = matchAnchor ? anchor.left : anchor.right - panel.offsetWidth;
      panel.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - panel.offsetWidth - margin))}px`;
    };
    const followScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) place();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", followScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", followScroll, true);
    };
  }, [open, compact, matchAnchor]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !field.current?.contains(target) && !popup.current?.contains(target)) dismiss();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [open, dismiss]);

  return { field, popup, portalRoot: field.current?.closest(".app-shell") ?? document.body };
}
