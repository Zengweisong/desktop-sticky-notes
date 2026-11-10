// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ChatSyncSettings } from "./ChatSyncSettings";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root.unmount()); vi.resetAllMocks(); });
it("only installs the hook after the user enables syncing", async () => {
  vi.mocked(invoke).mockResolvedValue({ enabled: false, pending: 0, failed: 0, recent: [], canUndo: false });
  root = createRoot(container);
  await act(async () => root.render(<ChatSyncSettings onChanged={async () => {}} />));
  expect(invoke).not.toHaveBeenCalledWith("configure_chat_sync", expect.anything());
  await act(async () => container.querySelector("button")!.click());
  expect(invoke).toHaveBeenCalledWith("configure_chat_sync", { enabled: true });
});
it("shows configuration failures without claiming syncing is enabled", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "configure_chat_sync") throw new Error("请先配置 AI 服务");
    return { enabled: false, pending: 0, failed: 0, recent: [], canUndo: false };
  });
  root = createRoot(container);
  await act(async () => root.render(<ChatSyncSettings onChanged={async () => {}} />));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("请先配置 AI 服务");
  expect(container.textContent).toContain("未开启");
});
it("refreshes tasks after undo and offers retries for failed turns", async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  vi.mocked(invoke).mockResolvedValue({ enabled: true, pending: 0, failed: 1, recent: ["报价已经发出去了"], canUndo: true, lastError: "AI 响应超时" });
  root = createRoot(container);
  await act(async () => root.render(<ChatSyncSettings onChanged={onChanged} />));
  const buttons = [...container.querySelectorAll("button")];
  await act(async () => buttons.find((b) => b.textContent === "撤销上次同步")!.click());
  expect(invoke).toHaveBeenCalledWith("undo_chat_sync"); expect(onChanged).toHaveBeenCalledOnce();
  await act(async () => buttons.find((b) => b.textContent?.startsWith("重试失败对话"))!.click());
  expect(invoke).toHaveBeenCalledWith("retry_chat_sync");
});
