import {
  LogicalSize,
  PhysicalPosition,
  availableMonitors,
  primaryMonitor,
  type Monitor,
  type Window
} from "@tauri-apps/api/window";
import type { WindowState } from "../types/settings";

export const DEFAULT_WINDOW_WIDTH = 400;
export const DEFAULT_WINDOW_HEIGHT = 580;
export const MIN_WINDOW_WIDTH = 340;
export const MIN_WINDOW_HEIGHT = 440;
export const WINDOW_STATE_DEBOUNCE_MS = 450;

const MIN_VISIBLE_WIDTH = 160;
const MIN_VISIBLE_HEIGHT = 72;

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface ResolvedWindowPlacement extends WindowState {
  x: number;
  y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function logicalDimension(value: number, scaleFactor: number | null, targetScale: number): number {
  // Versions before window-state v2 saved outerSize() directly in physical pixels.
  return scaleFactor === null ? value / targetScale : value;
}

function intersectionLength(startA: number, lengthA: number, startB: number, lengthB: number): number {
  return Math.max(0, Math.min(startA + lengthA, startB + lengthB) - Math.max(startA, startB));
}

/** Pure placement calculation used both at startup and in regression tests. */
export function resolveWindowPlacement(
  state: WindowState,
  displays: DisplayWorkArea[],
  primaryDisplayIndex = 0
): ResolvedWindowPlacement {
  if (!displays.length) {
    return {
      ...state,
      x: 0,
      y: 0,
      width: Math.max(MIN_WINDOW_WIDTH, state.width),
      height: Math.max(MIN_WINDOW_HEIGHT, state.height),
      scaleFactor: 1
    };
  }

  const primaryIndex = clamp(primaryDisplayIndex, 0, displays.length - 1);
  let targetIndex = primaryIndex;
  let savedPositionIsUsable = false;
  let bestVisibleArea = 0;

  if (state.x !== null && state.y !== null) {
    displays.forEach((display, index) => {
      const width = logicalDimension(state.width, state.scaleFactor, display.scaleFactor) * display.scaleFactor;
      const height = logicalDimension(state.height, state.scaleFactor, display.scaleFactor) * display.scaleFactor;
      const visibleWidth = intersectionLength(state.x!, width, display.x, display.width);
      const visibleHeight = intersectionLength(state.y!, height, display.y, display.height);
      const enoughTitleBar = visibleWidth >= Math.min(width, MIN_VISIBLE_WIDTH * display.scaleFactor)
        && visibleHeight >= Math.min(height, MIN_VISIBLE_HEIGHT * display.scaleFactor);
      const visibleArea = visibleWidth * visibleHeight;
      if (enoughTitleBar && visibleArea > bestVisibleArea) {
        bestVisibleArea = visibleArea;
        targetIndex = index;
        savedPositionIsUsable = true;
      }
    });
  }

  const target = displays[targetIndex];
  const maximumWidth = Math.max(1, Math.floor(target.width / target.scaleFactor));
  const maximumHeight = Math.max(1, Math.floor(target.height / target.scaleFactor));
  const minimumWidth = Math.min(MIN_WINDOW_WIDTH, maximumWidth);
  const minimumHeight = Math.min(MIN_WINDOW_HEIGHT, maximumHeight);
  const width = Math.round(clamp(
    logicalDimension(state.width, state.scaleFactor, target.scaleFactor),
    minimumWidth,
    maximumWidth
  ));
  const height = Math.round(clamp(
    logicalDimension(state.height, state.scaleFactor, target.scaleFactor),
    minimumHeight,
    maximumHeight
  ));
  const physicalWidth = Math.round(width * target.scaleFactor);
  const physicalHeight = Math.round(height * target.scaleFactor);
  const maximumX = target.x + Math.max(0, target.width - physicalWidth);
  const maximumY = target.y + Math.max(0, target.height - physicalHeight);
  const x = savedPositionIsUsable
    ? clamp(state.x!, target.x, maximumX)
    : target.x + Math.round((target.width - physicalWidth) / 2);
  const y = savedPositionIsUsable
    ? clamp(state.y!, target.y, maximumY)
    : target.y + Math.round((target.height - physicalHeight) / 2);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    maximized: state.maximized,
    scaleFactor: target.scaleFactor
  };
}

function toDisplay(monitor: Monitor): DisplayWorkArea {
  return {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
    scaleFactor: monitor.scaleFactor
  };
}

function sameMonitor(left: Monitor, right: Monitor): boolean {
  return left.position.x === right.position.x
    && left.position.y === right.position.y
    && left.size.width === right.size.width
    && left.size.height === right.size.height;
}

export async function restoreWindowState(win: Window, state: WindowState): Promise<WindowState> {
  try {
    const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
    const allMonitors = monitors.length ? monitors : primary ? [primary] : [];
    const primaryIndex = primary ? Math.max(0, allMonitors.findIndex((monitor) => sameMonitor(monitor, primary))) : 0;
    const placement = resolveWindowPlacement(state, allMonitors.map(toDisplay), primaryIndex);

    if (await win.isMinimized()) await win.unminimize();
    if (await win.isMaximized()) await win.unmaximize();
    await win.setMinSize(new LogicalSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT));
    await win.setSize(new LogicalSize(placement.width, placement.height));
    if (allMonitors.length) {
      await win.setPosition(new PhysicalPosition(placement.x, placement.y));
    } else {
      await win.center();
    }
    if (placement.maximized) await win.maximize();
    return placement;
  } catch (error) {
    console.error("恢复窗口状态失败，已使用安全的居中尺寸:", error);
    const fallback: WindowState = {
      x: null,
      y: null,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      maximized: false,
      scaleFactor: 1
    };
    try {
      if (await win.isMaximized()) await win.unmaximize();
      if (await win.isMinimized()) await win.unminimize();
      await win.setMinSize(new LogicalSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT));
      await win.setSize(new LogicalSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));
      await win.center();
      const [position, scaleFactor] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
      return { ...fallback, x: position.x, y: position.y, scaleFactor };
    } catch (fallbackError) {
      console.error("应用安全窗口尺寸失败:", fallbackError);
      return fallback;
    }
  }
}

export interface WindowStateManager {
  start: () => Promise<void>;
  flush: () => Promise<void>;
  dispose: () => void;
}

export function createWindowStateManager(
  win: Window,
  initialState: WindowState,
  persist: (state: WindowState) => Promise<void>
): WindowStateManager {
  let lastNormalState = { ...initialState, maximized: false };
  let timer: number | undefined;
  let captureQueue: Promise<void> = Promise.resolve();
  let unlisteners: Array<() => void> = [];
  let started = false;
  let disposed = false;

  const capture = async () => {
    try {
      if (await win.isMinimized()) return;
      const maximized = await win.isMaximized();
      if (maximized) {
        await persist({ ...lastNormalState, maximized: true });
        return;
      }

      const [position, size, scaleFactor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor()
      ]);
      const logicalSize = size.toLogical(scaleFactor);
      lastNormalState = {
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: Math.max(MIN_WINDOW_WIDTH, Math.round(logicalSize.width)),
        height: Math.max(MIN_WINDOW_HEIGHT, Math.round(logicalSize.height)),
        maximized: false,
        scaleFactor
      };
      await persist(lastNormalState);
    } catch (error) {
      console.error("保存窗口状态失败:", error);
    }
  };

  const flush = () => {
    window.clearTimeout(timer);
    timer = undefined;
    captureQueue = captureQueue.catch(() => undefined).then(capture);
    return captureQueue;
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), WINDOW_STATE_DEBOUNCE_MS);
  };

  const start = async () => {
    if (started || disposed) return;
    started = true;
    const registrations = await Promise.allSettled([
      win.onMoved(schedule),
      win.onResized(schedule),
      win.onScaleChanged(schedule),
      win.onCloseRequested(async () => { await flush(); })
    ]);
    const registered = registrations.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    registrations.forEach((result) => {
      if (result.status === "rejected") console.error("注册窗口状态监听器失败:", result.reason);
    });
    if (disposed) registered.forEach((unlisten) => unlisten());
    else unlisteners = registered;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timer);
    timer = undefined;
    unlisteners.forEach((unlisten) => unlisten());
    unlisteners = [];
  };

  return { start, flush, dispose };
}
