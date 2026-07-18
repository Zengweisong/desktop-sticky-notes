import { getCurrentWindow } from "@tauri-apps/api/window";

const directions = [
  "North", "NorthEast", "East", "SouthEast",
  "South", "SouthWest", "West", "NorthWest"
] as const;

export function WindowResizeHandles() {
  return <div className="window-resize-handles" aria-hidden="true">
    {directions.map((direction) => <div key={direction} className={`resize-handle resize-${direction.toLowerCase()}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        void getCurrentWindow().startResizeDragging(direction)
          .catch((error) => console.error(`启动 ${direction} 方向缩放失败:`, error));
      }} />)}
  </div>;
}

