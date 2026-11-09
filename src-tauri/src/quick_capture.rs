use std::time::{Duration, Instant};

const CLIPBOARD_WINDOW: Duration = Duration::from_secs(3);
const DOUBLE_CTRL_WINDOW: Duration = Duration::from_millis(400);
const CTRL_HOLD_LIMIT: Duration = Duration::from_millis(300);

#[derive(Default)]
struct ClipboardChange {
    sequence: u32,
    changed_at: Option<Instant>,
}

impl ClipboardChange {
    fn observe(&mut self, sequence: u32, now: Instant) {
        if sequence != 0 && sequence != self.sequence {
            self.sequence = sequence;
            self.changed_at = Some(now);
        }
    }

    fn is_recent(&self, sequence: u32, now: Instant) -> bool {
        sequence != 0
            && self.sequence == sequence
            && self
                .changed_at
                .is_some_and(|changed| now.saturating_duration_since(changed) <= CLIPBOARD_WINDOW)
    }
}

#[derive(Default)]
struct DoubleCtrl {
    down: Option<Instant>,
    previous_up: Option<Instant>,
    blocked: bool,
    keys: std::collections::HashSet<u32>,
}

impl DoubleCtrl {
    fn key(&mut self, code: u32, pressed: bool, now: Instant) -> bool {
        let control = matches!(code, 0x11 | 0xa2 | 0xa3);
        if pressed {
            if !self.keys.insert(code) {
                return false;
            } // Ignore auto-repeat.
            if control && self.keys.len() == 1 {
                self.down = Some(now);
                self.blocked = false;
            } else {
                self.blocked = true;
                self.previous_up = None;
            }
            return false;
        }
        if !self.keys.remove(&code) {
            return false;
        }
        if !control {
            return false;
        }
        let tapped = self
            .down
            .take()
            .is_some_and(|down| now.duration_since(down) <= CTRL_HOLD_LIMIT)
            && !self.blocked
            && self.keys.is_empty();
        if !tapped {
            self.previous_up = None;
            return false;
        }
        if self
            .previous_up
            .take()
            .is_some_and(|up| now.duration_since(up) <= DOUBLE_CTRL_WINDOW)
        {
            return true;
        }
        self.previous_up = Some(now);
        false
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedText {
    text: String,
    source: &'static str,
}

fn resolve_capture(
    selection: Result<Option<String>, String>,
    clipboard: impl FnOnce() -> Option<String>,
) -> Result<Option<CapturedText>, String> {
    if let Ok(Some(text)) = &selection {
        return Ok(Some(CapturedText {
            text: text.clone(),
            source: "selection",
        }));
    }
    if let Some(text) = clipboard() {
        return Ok(Some(CapturedText {
            text,
            source: "clipboard",
        }));
    }
    selection.map(|_| None)
}

#[tauri::command]
pub async fn capture_quick_add_text() -> Result<Option<CapturedText>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            // Freeze the time and sequence before UI Automation can take time.
            let requested_at = Instant::now();
            let sequence =
                unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() };
            resolve_capture(super::selection::windows_selection(), || {
                native::read_recent_clipboard(sequence, requested_at)
            })
        })
        .await
        .map_err(|_| "读取快捷添加文字失败".to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub fn set_double_ctrl_shortcut(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        native::set_enabled(enabled)
    }
    #[cfg(not(windows))]
    {
        if enabled {
            Err("双击 Ctrl 仅支持 Windows".into())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
pub use native::start;

#[cfg(windows)]
mod native {
    use super::*;
    use std::{
        cell::RefCell,
        sync::{
            atomic::{AtomicBool, AtomicU64, Ordering},
            Mutex,
        },
    };
    use tauri::Emitter;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::{
            DataExchange::{
                AddClipboardFormatListener, CloseClipboard, GetClipboardData,
                GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
                RemoveClipboardFormatListener,
            },
            LibraryLoader::GetModuleHandleW,
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
        UI::WindowsAndMessaging::*,
    };

    static CLIPBOARD: Mutex<ClipboardChange> = Mutex::new(ClipboardChange {
        sequence: 0,
        changed_at: None,
    });
    static ENABLED: AtomicBool = AtomicBool::new(false);
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    static HOOK_READY: AtomicBool = AtomicBool::new(false);
    const TRIGGER: u32 = WM_APP + 1;
    const CF_UNICODETEXT: u32 = 13;
    thread_local! {
        static DETECTOR: RefCell<(u64, DoubleCtrl)> = RefCell::new((0, DoubleCtrl::default()));
        static CONTEXT: RefCell<Option<(tauri::AppHandle, HWND)>> = const { RefCell::new(None) };
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        if enabled && !HOOK_READY.load(Ordering::Acquire) {
            return Err("无法监听双击 Ctrl，请使用组合快捷键".into());
        }
        ENABLED.store(false, Ordering::Release);
        GENERATION.fetch_add(1, Ordering::AcqRel);
        ENABLED.store(enabled, Ordering::Release);
        Ok(())
    }

    pub fn start(app: tauri::AppHandle) -> Result<(), String> {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("quick-capture".into())
            .spawn(move || unsafe {
                let instance = GetModuleHandleW(std::ptr::null());
                let name: Vec<u16> = "DesktopNotesQuickCapture\0".encode_utf16().collect();
                let class = WNDCLASSW {
                    lpfnWndProc: Some(window_proc),
                    hInstance: instance,
                    lpszClassName: name.as_ptr(),
                    ..std::mem::zeroed()
                };
                if RegisterClassW(&class) == 0 {
                    let _ = send.send(Err("创建剪贴板监听窗口失败".into()));
                    return;
                }
                let hwnd = CreateWindowExW(
                    0,
                    name.as_ptr(),
                    name.as_ptr(),
                    0,
                    0,
                    0,
                    0,
                    0,
                    HWND_MESSAGE,
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                if hwnd.is_null() {
                    let _ = send.send(Err("创建剪贴板监听窗口失败".into()));
                    return;
                }
                // Existing clipboard contents at startup are deliberately not considered new.
                *CLIPBOARD.lock().unwrap() = ClipboardChange {
                    sequence: GetClipboardSequenceNumber(),
                    changed_at: None,
                };
                if AddClipboardFormatListener(hwnd) == 0 {
                    DestroyWindow(hwnd);
                    let _ = send.send(Err("监听剪贴板更新失败".into()));
                    return;
                }
                CONTEXT.with(|context| *context.borrow_mut() = Some((app, hwnd)));
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), instance, 0);
                HOOK_READY.store(!hook.is_null(), Ordering::Release);
                let _ = send.send(Ok(()));
                let mut message = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                HOOK_READY.store(false, Ordering::Release);
                if !hook.is_null() {
                    UnhookWindowsHookEx(hook);
                }
                RemoveClipboardFormatListener(hwnd);
                DestroyWindow(hwnd);
            })
            .map_err(|error| error.to_string())?;
        receive.recv().map_err(|error| error.to_string())?
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_CLIPBOARDUPDATE {
            CLIPBOARD
                .lock()
                .unwrap()
                .observe(GetClipboardSequenceNumber(), Instant::now());
            return 0;
        }
        if message == TRIGGER {
            if ENABLED.load(Ordering::Acquire) {
                CONTEXT.with(|context| {
                    if let Some((app, _)) = context.borrow().as_ref() {
                        let _ = app.emit("double-ctrl-shortcut", ());
                    }
                });
            }
            return 0;
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && ENABLED.load(Ordering::Acquire) {
            let event = &*(lparam as *const KBDLLHOOKSTRUCT);
            let pressed = matches!(wparam as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            let generation = GENERATION.load(Ordering::Acquire);
            let trigger = DETECTOR.with(|detector| {
                let mut state = detector.borrow_mut();
                if state.0 != generation || event.flags & LLKHF_INJECTED != 0 {
                    *state = (generation, DoubleCtrl::default());
                }
                event.flags & LLKHF_INJECTED == 0
                    && state.1.key(event.vkCode, pressed, Instant::now())
            });
            if trigger {
                // Keep the hook fast; emit to the frontend from the window message loop.
                CONTEXT.with(|context| {
                    if let Some((_, hwnd)) = context.borrow().as_ref() {
                        PostMessageW(*hwnd, TRIGGER, 0, 0);
                    }
                });
            }
        }
        // Never swallow keys: Ctrl shortcuts keep their normal behavior in other apps.
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    pub fn read_recent_clipboard(sequence: u32, requested_at: Instant) -> Option<String> {
        if !CLIPBOARD.lock().ok()?.is_recent(sequence, requested_at) {
            return None;
        }
        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return None;
            }
            struct Close;
            impl Drop for Close {
                fn drop(&mut self) {
                    unsafe {
                        CloseClipboard();
                    }
                }
            }
            let _close = Close;
            if GetClipboardSequenceNumber() != sequence
                || IsClipboardFormatAvailable(CF_UNICODETEXT) == 0
            {
                return None;
            }
            let handle = GetClipboardData(CF_UNICODETEXT);
            if handle.is_null() {
                return None;
            }
            let size = GlobalSize(handle) / 2;
            if size == 0 {
                return None;
            }
            let pointer = GlobalLock(handle) as *const u16;
            if pointer.is_null() {
                return None;
            }
            let units = std::slice::from_raw_parts(pointer, size);
            let length = units.iter().position(|unit| *unit == 0).unwrap_or(size);
            let text = String::from_utf16_lossy(&units[..length])
                .trim()
                .to_string();
            GlobalUnlock(handle);
            (!text.is_empty()).then_some(text)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_wins_without_reading_clipboard_and_fallback_handles_selection_errors() {
        let selection = resolve_capture(Ok(Some("选区😀".into())), || {
            panic!("must not read clipboard")
        })
        .unwrap()
        .unwrap();
        assert_eq!(selection.text, "选区😀");
        assert_eq!(selection.source, "selection");
        for missing in [Ok(None), Err("selection unavailable".into())] {
            let result = resolve_capture(missing, || Some("复制文字".into()))
                .unwrap()
                .unwrap();
            assert_eq!(result.text, "复制文字");
            assert_eq!(result.source, "clipboard");
        }
        assert!(resolve_capture(Ok(None), || None).unwrap().is_none());
        assert!(resolve_capture(Err("selection unavailable".into()), || None).is_err());
    }
    #[test]
    fn clipboard_requires_a_real_change_and_expires_after_three_seconds() {
        let now = Instant::now();
        let mut clipboard = ClipboardChange {
            sequence: 10,
            changed_at: None,
        };
        clipboard.observe(10, now);
        assert!(!clipboard.is_recent(10, now));
        clipboard.observe(11, now);
        assert!(clipboard.is_recent(11, now + Duration::from_secs(3)));
        clipboard.observe(11, now + Duration::from_secs(2));
        assert!(!clipboard.is_recent(11, now + Duration::from_millis(3001)));
        assert!(!clipboard.is_recent(12, now));
        clipboard.observe(12, now + Duration::from_secs(4));
        assert!(clipboard.is_recent(12, now + Duration::from_secs(4)));
    }

    fn run(events: &[(u32, bool, u64)]) -> Vec<bool> {
        let mut detector = DoubleCtrl::default();
        let now = Instant::now();
        events
            .iter()
            .map(|(key, down, ms)| detector.key(*key, *down, now + Duration::from_millis(*ms)))
            .collect()
    }

    #[test]
    fn double_ctrl_requires_two_complete_short_taps() {
        assert_eq!(
            run(&[
                (0xa2, true, 0),
                (0xa2, false, 50),
                (0xa2, true, 150),
                (0xa2, false, 200)
            ]),
            [false, false, false, true]
        );
        assert_eq!(
            run(&[(0xa3, true, 0), (0xa3, true, 100), (0xa3, false, 150)]),
            [false; 3]
        );
        assert_eq!(
            run(&[
                (0xa2, true, 0),
                (0xa2, false, 301),
                (0xa2, true, 350),
                (0xa2, false, 400)
            ]),
            [false; 4]
        );
        assert_eq!(
            run(&[
                (0xa2, true, 0),
                (0xa2, false, 50),
                (0xa2, true, 450),
                (0xa2, false, 451)
            ]),
            [false; 4]
        );
    }

    #[test]
    fn combinations_and_intervening_keys_cancel_double_ctrl() {
        for other in [0x43, 0x56, 0x12, 0xa3] {
            assert_eq!(
                run(&[
                    (0xa2, true, 0),
                    (other, true, 20),
                    (other, false, 40),
                    (0xa2, false, 60),
                    (0xa2, true, 100),
                    (0xa2, false, 150)
                ]),
                [false; 6]
            );
        }
        assert_eq!(
            run(&[
                (0xa2, true, 0),
                (0xa2, false, 50),
                (0x41, true, 70),
                (0x41, false, 80),
                (0xa2, true, 100),
                (0xa2, false, 150)
            ]),
            [false; 6]
        );
    }
}
