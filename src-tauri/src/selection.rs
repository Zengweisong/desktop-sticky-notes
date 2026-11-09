#[tauri::command]
pub async fn capture_selected_text() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(windows_selection)
            .await
            .map_err(|_| "读取选中文字失败".to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

#[cfg(windows)]
pub(crate) fn windows_selection() -> Result<Option<String>, String> {
    use windows::{
        core::Interface,
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_MULTITHREADED,
            },
            UI::Accessibility::{
                CUIAutomation8, IUIAutomation, IUIAutomation2, IUIAutomationTextPattern,
                UIA_TextPatternId,
            },
        },
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    // Capture before the caller shows or focuses our window. UI Automation reads
    // the real selection without synthesizing Ctrl+C or replacing the clipboard.
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.is_null() {
            return Ok(None);
        }
        let mut process_id = 0;
        GetWindowThreadProcessId(foreground, &mut process_id);
        if process_id == std::process::id() {
            return Ok(None);
        }
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|_| "初始化选区读取失败".to_string())?;
        let _com = ComGuard;
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                .map_err(|_| "初始化选区读取失败".to_string())?;
        let timeouts: IUIAutomation2 = automation
            .cast()
            .map_err(|_| "初始化选区读取失败".to_string())?;
        timeouts
            .SetConnectionTimeout(500)
            .map_err(|_| "初始化选区读取失败".to_string())?;
        timeouts
            .SetTransactionTimeout(500)
            .map_err(|_| "初始化选区读取失败".to_string())?;
        let Ok(mut element) = automation.GetFocusedElement() else {
            return Ok(None);
        };
        let walker = automation
            .ControlViewWalker()
            .map_err(|_| "读取选中文字失败".to_string())?;
        // Focus may be on a link or paragraph inside a document. Walk to its
        // text provider, but stop at the first provider even if its selection is empty.
        for _ in 0..16 {
            if GetForegroundWindow() != foreground
                || element
                    .CurrentIsPassword()
                    .map_or(true, |value| value.as_bool())
            {
                return Ok(None);
            }
            if let Ok(pattern) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                let text = selected_text(&pattern).map_err(|_| "读取选中文字失败".to_string())?;
                if GetForegroundWindow() != foreground {
                    return Ok(None);
                }
                return Ok(text);
            }
            let Ok(parent) = walker.GetParentElement(&element) else {
                break;
            };
            element = parent;
        }
        Ok(None)
    }
}

#[cfg(windows)]
unsafe fn selected_text(
    pattern: &windows::Win32::UI::Accessibility::IUIAutomationTextPattern,
) -> windows::core::Result<Option<String>> {
    let ranges = pattern.GetSelection()?;
    let mut parts = Vec::new();
    for index in 0..ranges.Length()? {
        let text = ranges.GetElement(index)?.GetText(-1)?.to_string();
        if !text.trim().is_empty() {
            parts.push(text);
        }
    }
    let text = parts.join("\n").trim().to_string();
    Ok((!text.is_empty()).then_some(text))
}

#[cfg(all(test, windows))]
mod tests {
    use super::selected_text;
    use windows::{
        core::Interface,
        Win32::{
            Foundation::HWND,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_MULTITHREADED,
            },
            UI::Accessibility::{
                CUIAutomation8, IUIAutomation, IUIAutomationTextPattern, UIA_TextPatternId,
            },
        },
    };
    use windows_sys::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, DispatchMessageW, GetMessageW, PostThreadMessageW,
            SendMessageW, TranslateMessage, ES_MULTILINE, MSG, WM_QUIT, WS_OVERLAPPEDWINDOW,
        },
    };

    #[test]
    fn native_edit_selection_preserves_unicode_and_ignores_an_empty_caret() {
        // A private, hidden EDIT fixture exercises the real Windows text provider.
        // Its owner pumps messages on a different thread from the MTA UIA client.
        let (send, receive) = std::sync::mpsc::channel();
        let owner = std::thread::spawn(move || unsafe {
            let class: Vec<u16> = "EDIT\0".encode_utf16().collect();
            let text: Vec<u16> = "前缀：选中文字😀 后缀\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                text.as_ptr(),
                WS_OVERLAPPEDWINDOW | ES_MULTILINE as u32,
                0,
                0,
                300,
                120,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!hwnd.is_null(), "create private EDIT fixture");
            // EM_SETSEL uses UTF-16 offsets, so the emoji occupies two units.
            SendMessageW(hwnd, 0x00B1, 3, 9);
            send.send((hwnd as isize, GetCurrentThreadId())).unwrap();
            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            DestroyWindow(hwnd);
        });
        let (handle, thread_id) = receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        struct Fixture(u32, Option<std::thread::JoinHandle<()>>);
        impl Drop for Fixture {
            fn drop(&mut self) {
                unsafe {
                    PostThreadMessageW(self.0, WM_QUIT, 0, 0);
                }
                self.1.take().unwrap().join().unwrap();
            }
        }
        let _fixture = Fixture(thread_id, Some(owner));
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().unwrap();
            let result = (|| -> windows::core::Result<()> {
                let automation: IUIAutomation =
                    CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)?;
                let element = automation.ElementFromHandle(HWND(handle as *mut _))?;
                let pattern: IUIAutomationTextPattern =
                    element.GetCurrentPattern(UIA_TextPatternId)?.cast()?;
                assert_eq!(selected_text(&pattern)?, Some("选中文字😀".into()));
                SendMessageW(handle as *mut _, 0x00B1, 3, 3);
                assert_eq!(selected_text(&pattern)?, None);
                Ok(())
            })();
            CoUninitialize();
            result.unwrap();
        }
    }
}
