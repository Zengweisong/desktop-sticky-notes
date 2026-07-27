use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};

#[cfg(windows)]
static BACKGROUND_RGBA: AtomicU32 = AtomicU32::new(0x00FFF8DA);
#[cfg(windows)]
static BACKGROUND_HWND: AtomicIsize = AtomicIsize::new(0);
#[cfg(windows)]
static BACKGROUND_TOPMOST: AtomicBool = AtomicBool::new(true);

// This style must be present while Tao creates the main window. It prevents DWM from
// allocating the opaque redirection surface that WebView2 otherwise reveals as black.
#[cfg(windows)]
const NO_REDIRECTION_BITMAP_STYLE: u32 = 0x0020_0000;
#[cfg(windows)]
static CREATE_WINDOW_HOOK: AtomicIsize = AtomicIsize::new(0);
#[cfg(windows)]
const BACKGROUND_INSET_CSS_PIXELS: f64 = 7.0;
#[cfg(windows)]
const PANEL_CORNER_RADIUS_CSS_PIXELS: f64 = 22.0;

#[cfg(windows)]
fn rounded_rect_coverage(x: i32, y: i32, width: i32, height: i32, radius: f64) -> u8 {
    let radius = radius.max(1.0).min(f64::from(width.min(height)) / 2.0);
    let pixel_x = f64::from(x) + 0.5;
    let pixel_y = f64::from(y) + 0.5;
    let right_center = f64::from(width) - radius;
    let bottom_center = f64::from(height) - radius;
    let corner_x = if pixel_x < radius {
        radius - pixel_x
    } else if pixel_x > right_center {
        pixel_x - right_center
    } else {
        0.0
    };
    let corner_y = if pixel_y < radius {
        radius - pixel_y
    } else if pixel_y > bottom_center {
        pixel_y - bottom_center
    } else {
        0.0
    };

    if corner_x == 0.0 || corner_y == 0.0 {
        return 255;
    }

    let distance = corner_x.hypot(corner_y);
    ((radius + 0.5 - distance).clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(windows)]
fn background_pixel(red: u8, green: u8, blue: u8, alpha: u8, coverage: u8) -> u32 {
    let effective_alpha = ((u32::from(alpha) * u32::from(coverage) + 127) / 255) as u8;
    let premultiply = |channel: u8| (u32::from(channel) * u32::from(effective_alpha) + 127) / 255;
    premultiply(blue)
        | (premultiply(green) << 8)
        | (premultiply(red) << 16)
        | (u32::from(effective_alpha) << 24)
}

#[cfg(windows)]
unsafe extern "system" fn no_redirection_window_hook(
    code: i32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, UnhookWindowsHookEx, CBT_CREATEWNDW, HCBT_CREATEWND,
    };

    if code == HCBT_CREATEWND as i32 {
        let create = &mut *(lparam as *mut CBT_CREATEWNDW);
        let structure = &mut *create.lpcs;
        let class_name = structure.lpszClass;
        const TAURI_WINDOW_CLASS: [u16; 13] = [
            b'T' as u16,
            b'a' as u16,
            b'u' as u16,
            b'r' as u16,
            b'i' as u16,
            b' ' as u16,
            b'W' as u16,
            b'i' as u16,
            b'n' as u16,
            b'd' as u16,
            b'o' as u16,
            b'w' as u16,
            0,
        ];
        let is_tauri_window = (class_name as usize) > 0xffff
            && (0..TAURI_WINDOW_CLASS.len())
                .all(|index| *class_name.add(index) == TAURI_WINDOW_CLASS[index]);
        if is_tauri_window {
            structure.dwExStyle |= NO_REDIRECTION_BITMAP_STYLE;
            let hook = CREATE_WINDOW_HOOK.swap(0, Ordering::Relaxed)
                as windows_sys::Win32::UI::WindowsAndMessaging::HHOOK;
            if !hook.is_null() {
                UnhookWindowsHookEx(hook);
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(windows)]
fn install_windows_transparency_hook() -> std::io::Result<()> {
    use windows_sys::Win32::{
        System::Threading::GetCurrentThreadId,
        UI::WindowsAndMessaging::{SetWindowsHookExW, WH_CBT},
    };

    let hook = unsafe {
        SetWindowsHookExW(
            WH_CBT,
            Some(no_redirection_window_hook),
            std::ptr::null_mut(),
            GetCurrentThreadId(),
        )
    };
    if hook.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    CREATE_WINDOW_HOOK.store(hook as isize, Ordering::Relaxed);
    Ok(())
}

#[cfg(windows)]
fn apply_windows_transparency<M: Manager<tauri::Wry>>(manager: &M) -> tauri::Result<()> {
    let Some(main) = manager.get_webview_window("main") else {
        return Ok(());
    };
    main.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))?;
    Ok(())
}

#[cfg(windows)]
fn setup_background_layer(app: &tauri::App) -> tauri::Result<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
        WS_POPUP,
    };

    let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
    let title: Vec<u16> = "\0".encode_utf16().collect();
    let background_hwnd = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if background_hwnd.is_null() {
        eprintln!("创建原生透明背景窗口失败");
    } else {
        BACKGROUND_HWND.store(background_hwnd as isize, Ordering::Relaxed);
        set_background_topmost_band(BACKGROUND_TOPMOST.load(Ordering::Relaxed))?;
        sync_background_layer(app);
    }
    Ok(())
}

#[cfg(windows)]
fn set_background_topmost_band(always_on_top: bool) -> std::io::Result<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let background_hwnd =
        BACKGROUND_HWND.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;
    if background_hwnd.is_null() {
        return Ok(());
    }
    let insert_after = if always_on_top {
        HWND_TOPMOST
    } else {
        HWND_NOTOPMOST
    };
    if unsafe {
        SetWindowPos(
            background_hwnd,
            insert_after,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn sync_background_layer<M: Manager<tauri::Wry>>(manager: &M) {
    use windows_sys::Win32::{
        Foundation::{POINT, SIZE},
        Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
            SelectObject, BITMAPINFO, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS,
        },
        UI::WindowsAndMessaging::{
            IsIconic, IsWindowVisible, SetWindowPos, ShowWindow, UpdateLayeredWindow,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, ULW_ALPHA,
        },
    };

    let Some(main) = manager.get_webview_window("main") else {
        return;
    };
    let background_hwnd =
        BACKGROUND_HWND.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;
    if background_hwnd.is_null() {
        return;
    }
    let (Ok(main_hwnd), Ok(position), Ok(size), Ok(scale)) = (
        main.hwnd(),
        main.outer_position(),
        main.inner_size(),
        main.scale_factor(),
    ) else {
        return;
    };
    if unsafe { IsWindowVisible(main_hwnd.0) == 0 || IsIconic(main_hwnd.0) != 0 } {
        unsafe { ShowWindow(background_hwnd, SW_HIDE) };
        return;
    }
    let inset = (BACKGROUND_INSET_CSS_PIXELS * scale).round() as i32;
    let width = size.width as i32 - inset * 2;
    let height = size.height as i32 - inset * 2;
    let radius = PANEL_CORNER_RADIUS_CSS_PIXELS * scale;
    if width <= 0 || height <= 0 {
        return;
    }

    unsafe {
        // Showing a STATIC window after UpdateLayeredWindow triggers its default white paint.
        // Show first, then make the per-pixel buffer the final composed surface.
        ShowWindow(background_hwnd, SW_SHOWNOACTIVATE);
        let screen_dc = GetDC(std::ptr::null_mut());
        let memory_dc = CreateCompatibleDC(screen_dc);
        let mut bitmap_info: BITMAPINFO = std::mem::zeroed();
        bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
        bitmap_info.bmiHeader.biWidth = width;
        bitmap_info.bmiHeader.biHeight = -height;
        bitmap_info.bmiHeader.biPlanes = 1;
        bitmap_info.bmiHeader.biBitCount = 32;
        bitmap_info.bmiHeader.biCompression = BI_RGB;
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(
            screen_dc,
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        if !bitmap.is_null() && !bits.is_null() {
            let rgba = BACKGROUND_RGBA.load(Ordering::Relaxed);
            let alpha = (rgba >> 24) as u8;
            let red = ((rgba >> 16) & 0xff) as u8;
            let green = ((rgba >> 8) & 0xff) as u8;
            let blue = (rgba & 0xff) as u8;
            let pixels =
                std::slice::from_raw_parts_mut(bits as *mut u32, (width * height) as usize);
            for y in 0..height {
                for x in 0..width {
                    let coverage = rounded_rect_coverage(x, y, width, height, radius);
                    pixels[(y * width + x) as usize] =
                        background_pixel(red, green, blue, alpha, coverage);
                }
            }
            let old_bitmap = SelectObject(memory_dc, bitmap);
            let destination = POINT {
                x: position.x + inset,
                y: position.y + inset,
            };
            let layer_size = SIZE {
                cx: width,
                cy: height,
            };
            let source = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION {
                BlendOp: 0,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: 1,
            };
            UpdateLayeredWindow(
                background_hwnd,
                screen_dc,
                &destination,
                &layer_size,
                memory_dc,
                &source,
                0,
                &blend,
                ULW_ALPHA,
            );
            SelectObject(memory_dc, old_bitmap);
        }
        SetWindowPos(
            background_hwnd,
            main_hwnd.0,
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        );
        if !bitmap.is_null() {
            DeleteObject(bitmap);
        }
        DeleteDC(memory_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);
    }
}

#[tauri::command]
fn set_background_appearance(
    app: tauri::AppHandle,
    opacity: u8,
    theme: String,
    always_on_top: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (red, green, blue) = match theme.as_str() {
            "light" => (244_u8, 248_u8, 252_u8),
            "dark" => (36_u8, 40_u8, 48_u8),
            _ => (255_u8, 248_u8, 218_u8),
        };
        let alpha = ((opacity.min(100) as u16 * 255) / 100) as u8;
        let rgba =
            ((alpha as u32) << 24) | ((red as u32) << 16) | ((green as u32) << 8) | blue as u32;
        BACKGROUND_RGBA.store(rgba, Ordering::Relaxed);
        BACKGROUND_TOPMOST.store(always_on_top, Ordering::Relaxed);
        apply_windows_transparency(&app).map_err(|error| error.to_string())?;
        if let Some(main) = app.get_webview_window("main") {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            };
            let hwnd = main.hwnd().map_err(|error| error.to_string())?;
            let insert_after = if always_on_top {
                HWND_TOPMOST
            } else {
                HWND_NOTOPMOST
            };
            if unsafe {
                SetWindowPos(
                    hwnd.0,
                    insert_after,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        set_background_topmost_band(always_on_top).map_err(|error| error.to_string())?;
        sync_background_layer(&app);
    }
    #[cfg(not(windows))]
    let _ = (app, opacity, theme, always_on_top);
    Ok(())
}

#[tauri::command]
fn set_background_visible(app: tauri::AppHandle, visible: bool) {
    #[cfg(windows)]
    {
        if visible {
            sync_background_layer(&app);
        } else {
            use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
            let hwnd =
                BACKGROUND_HWND.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;
            if !hwnd.is_null() {
                unsafe { ShowWindow(hwnd, SW_HIDE) };
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (app, visible);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(windows)]
#[tauri::command]
fn show_reminder_notification(
    app: tauri::AppHandle,
    note_id: i64,
    title: String,
    details: String,
    context: String,
) -> Result<(), String> {
    use tauri_winrt_notification::Toast;

    let app_id = if tauri::is_dev() {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    let activation_app = app.clone();
    Toast::new(&app_id)
        .title(&title)
        .text1(&details)
        .text2(&context)
        .on_activated(move |_| {
            show_window(&activation_app);
            let _ = activation_app.emit("notification-activated", note_id);
            Ok(())
        })
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn show_reminder_notification(
    _app: tauri::AppHandle,
    _note_id: i64,
    _title: String,
    _details: String,
    _context: String,
) -> Result<(), String> {
    Err("原生 Windows 通知仅在 Windows 上可用".into())
}

// Migration 1 已发布，必须保持逐字节不变；concat! 可防止 rustfmt 改变其 checksum。
const MIGRATION_1_SQL: &str = concat!(
    "\n",
    "            CREATE TABLE IF NOT EXISTS notes (\n",
    "                id INTEGER PRIMARY KEY AUTOINCREMENT,\n",
    "                content TEXT NOT NULL,\n",
    "                completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),\n",
    "                pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),\n",
    "                created_at TEXT NOT NULL,\n",
    "                updated_at TEXT NOT NULL,\n",
    "                completed_at TEXT NULL,\n",
    "                sort_order INTEGER NOT NULL DEFAULT 0\n",
    "            );\n",
    "            CREATE INDEX IF NOT EXISTS idx_notes_display_order\n",
    "              ON notes(completed, pinned, created_at DESC);\n",
    "            CREATE TABLE IF NOT EXISTS settings (\n",
    "                key TEXT PRIMARY KEY NOT NULL,\n",
    "                value TEXT NOT NULL,\n",
    "                updated_at TEXT NOT NULL\n",
    "            );\n",
    "        "
);

const MIGRATION_6_SQL: &str = r#"
                ALTER TABLE notes ADD COLUMN scheduled_date TEXT NULL
                  CHECK (scheduled_date IS NULL OR scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
                ALTER TABLE notes ADD COLUMN scheduled_time TEXT NULL
                  CHECK (scheduled_time IS NULL OR
                    (scheduled_time GLOB '[0-2][0-9]:[0-5][0-9]' AND scheduled_time <= '23:59'));

                -- Preserve every historical non-all-day time, including a real 09:00.
                -- Rows explicitly marked all-day migrate to a date with no item time.
                -- v4 synthesized all-day scheduled_at values at midnight. Preserve the
                -- original due_at date before applying localtime so western time zones
                -- cannot move those rows to the previous day.
                UPDATE notes
                  SET scheduled_date = substr(due_at, 1, 10)
                  WHERE COALESCE(is_all_day, 0) = 1 AND due_at IS NOT NULL
                    AND substr(due_at, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND CAST(substr(due_at, 6, 2) AS INTEGER) BETWEEN 1 AND 12
                    AND CAST(substr(due_at, 9, 2) AS INTEGER) BETWEEN 1 AND CASE
                      WHEN CAST(substr(due_at, 6, 2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31
                      WHEN CAST(substr(due_at, 6, 2) AS INTEGER) IN (4,6,9,11) THEN 30
                      WHEN CAST(substr(due_at, 6, 2) AS INTEGER) = 2 THEN CASE
                        WHEN CAST(substr(due_at, 1, 4) AS INTEGER) % 400 = 0
                          OR (CAST(substr(due_at, 1, 4) AS INTEGER) % 4 = 0
                            AND CAST(substr(due_at, 1, 4) AS INTEGER) % 100 != 0)
                        THEN 29 ELSE 28 END
                      ELSE 0 END;
                UPDATE notes
                  SET scheduled_date = strftime('%Y-%m-%d', scheduled_at, 'localtime')
                  WHERE scheduled_at IS NOT NULL AND scheduled_date IS NULL;
                UPDATE notes
                  SET scheduled_time = strftime('%H:%M', scheduled_at, 'localtime')
                  WHERE scheduled_at IS NOT NULL
                    AND repeat_series_id IS NULL
                    AND COALESCE(is_all_day, 0) = 0;
                UPDATE notes
                  SET scheduled_date = substr(due_at, 1, 10)
                  WHERE scheduled_date IS NULL AND due_at IS NOT NULL
                    AND substr(due_at, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    AND CAST(substr(due_at, 6, 2) AS INTEGER) BETWEEN 1 AND 12
                    AND CAST(substr(due_at, 9, 2) AS INTEGER) BETWEEN 1 AND CASE
                      WHEN CAST(substr(due_at, 6, 2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31
                      WHEN CAST(substr(due_at, 6, 2) AS INTEGER) IN (4,6,9,11) THEN 30
                      WHEN CAST(substr(due_at, 6, 2) AS INTEGER) = 2 THEN CASE
                        WHEN CAST(substr(due_at, 1, 4) AS INTEGER) % 400 = 0
                          OR (CAST(substr(due_at, 1, 4) AS INTEGER) % 4 = 0
                            AND CAST(substr(due_at, 1, 4) AS INTEGER) % 100 != 0)
                        THEN 29 ELSE 28 END
                      ELSE 0 END;

                CREATE INDEX IF NOT EXISTS idx_notes_scheduled_date
                  ON notes(scheduled_date, scheduled_time);
            "#;

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create notes and settings tables",
            sql: MIGRATION_1_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add categories and extended todo fields",
            sql: r#"
                CREATE TABLE IF NOT EXISTS categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT '#D59D2A',
                    icon TEXT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_nocase
                  ON categories(name COLLATE NOCASE);

                INSERT OR IGNORE INTO categories (name, color, icon, sort_order, created_at, is_system) VALUES
                  ('未分类', '#8B95A5', 'inbox', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1),
                  ('工作', '#4F87C8', 'briefcase', 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0),
                  ('学习', '#8B6BC2', 'book-open', 20, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0),
                  ('生活', '#50A477', 'house', 30, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0),
                  ('临时事项', '#D8894B', 'clock', 40, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0);

                ALTER TABLE notes ADD COLUMN title TEXT NULL;
                ALTER TABLE notes ADD COLUMN details TEXT NULL;
                ALTER TABLE notes ADD COLUMN category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL;
                ALTER TABLE notes ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low', 'normal', 'high'));
                ALTER TABLE notes ADD COLUMN due_at TEXT NULL;

                UPDATE notes SET title = content WHERE title IS NULL OR trim(title) = '';
                UPDATE notes SET category_id = (SELECT id FROM categories WHERE name = '未分类' LIMIT 1)
                  WHERE category_id IS NULL;
                CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category_id);
                CREATE INDEX IF NOT EXISTS idx_notes_due_at ON notes(due_at);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add independent reminders and repeat series",
            sql: r#"
                CREATE TABLE IF NOT EXISTS repeat_series (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    details TEXT NULL,
                    category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
                    priority TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low', 'normal', 'high')),
                    repeat_type TEXT NOT NULL
                      CHECK (repeat_type IN ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
                    repeat_interval INTEGER NOT NULL DEFAULT 1 CHECK (repeat_interval > 0),
                    repeat_weekdays TEXT NULL,
                    repeat_month_day INTEGER NULL CHECK (repeat_month_day BETWEEN 1 AND 31),
                    start_at TEXT NOT NULL,
                    end_type TEXT NOT NULL DEFAULT 'never'
                      CHECK (end_type IN ('never', 'date', 'count')),
                    end_date TEXT NULL,
                    max_occurrences INTEGER NULL CHECK (max_occurrences IS NULL OR max_occurrences > 0),
                    generated_occurrences INTEGER NOT NULL DEFAULT 0,
                    default_reminder_enabled INTEGER NOT NULL DEFAULT 0
                      CHECK (default_reminder_enabled IN (0, 1)),
                    default_reminder_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (default_reminder_offset_minutes >= 0),
                    next_occurrence_at TEXT NULL,
                    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                ALTER TABLE notes ADD COLUMN scheduled_at TEXT NULL;
                ALTER TABLE notes ADD COLUMN repeat_series_id INTEGER NULL
                  REFERENCES repeat_series(id) ON DELETE SET NULL;
                ALTER TABLE notes ADD COLUMN repeat_occurrence_at TEXT NULL;
                ALTER TABLE notes ADD COLUMN reminder_enabled INTEGER NOT NULL DEFAULT 0
                  CHECK (reminder_enabled IN (0, 1));
                ALTER TABLE notes ADD COLUMN reminder_at TEXT NULL;
                ALTER TABLE notes ADD COLUMN reminder_offset_minutes INTEGER NOT NULL DEFAULT 0
                  CHECK (reminder_offset_minutes >= 0);
                ALTER TABLE notes ADD COLUMN reminder_triggered_at TEXT NULL;

                CREATE INDEX IF NOT EXISTS idx_notes_reminder_pending
                  ON notes(reminder_enabled, reminder_at, reminder_triggered_at, completed);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_repeat_occurrence
                  ON notes(repeat_series_id, repeat_occurrence_at)
                  WHERE repeat_series_id IS NOT NULL AND repeat_occurrence_at IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_repeat_series_next
                  ON repeat_series(active, next_occurrence_at);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "separate plan time and all-day reminder metadata",
            sql: r#"
                ALTER TABLE notes ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0
                  CHECK (is_all_day IN (0, 1));
                ALTER TABLE notes ADD COLUMN all_day_reminder_time TEXT NULL;
                ALTER TABLE repeat_series ADD COLUMN default_is_all_day INTEGER NOT NULL DEFAULT 0
                  CHECK (default_is_all_day IN (0, 1));
                ALTER TABLE repeat_series ADD COLUMN default_all_day_reminder_time TEXT NULL;

                -- The old top-level due date becomes an all-day plan when no more
                -- precise scheduled time exists. Keep due_at itself for rollback/export compatibility.
                UPDATE notes
                  SET scheduled_at = due_at || 'T00:00:00', is_all_day = 1
                  WHERE scheduled_at IS NULL AND due_at IS NOT NULL AND length(due_at) >= 10;

                -- Recover the offset from old independent reminder timestamps whenever possible.
                -- reminder_at is intentionally never cleared: unconvertible legacy reminders remain active.
                UPDATE notes
                  SET reminder_offset_minutes = CAST(ROUND(
                    (julianday(scheduled_at) - julianday(reminder_at)) * 1440
                  ) AS INTEGER)
                  WHERE scheduled_at IS NOT NULL AND reminder_at IS NOT NULL
                    AND julianday(scheduled_at) >= julianday(reminder_at);

                UPDATE notes
                  SET all_day_reminder_time = COALESCE(strftime('%H:%M', reminder_at, 'localtime'), '09:00')
                  WHERE is_all_day = 1 AND reminder_enabled = 1;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add persistent board columns and note placement",
            sql: r#"
                CREATE TABLE IF NOT EXISTS board_columns (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    type TEXT NOT NULL DEFAULT 'custom'
                      CHECK (type IN ('system', 'custom')),
                    status TEXT NOT NULL DEFAULT 'doing'
                      CHECK (status IN ('todo', 'doing', 'completed')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO board_columns
                  (id, name, sort_order, type, status, created_at, updated_at) VALUES
                  ('todo', '待处理', 10, 'system', 'todo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                  ('doing', '进行中', 20, 'custom', 'doing', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                  ('completed', '已完成', 30, 'system', 'completed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

                ALTER TABLE notes ADD COLUMN board_column_id TEXT NULL
                  REFERENCES board_columns(id) ON DELETE RESTRICT;
                ALTER TABLE notes ADD COLUMN board_order INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE notes ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'doing', 'completed'));
                ALTER TABLE notes ADD COLUMN previous_board_column_id TEXT NULL
                  REFERENCES board_columns(id) ON DELETE SET NULL;

                UPDATE notes
                  SET board_column_id = CASE WHEN completed = 1 THEN 'completed' ELSE 'todo' END,
                      status = CASE WHEN completed = 1 THEN 'completed' ELSE 'todo' END,
                      board_order = sort_order;
                CREATE INDEX IF NOT EXISTS idx_notes_board_order
                  ON notes(board_column_id, board_order, created_at);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "separate scheduled date and explicit time",
            sql: MIGRATION_6_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

fn emit_action(app: &tauri::AppHandle, action: &str) {
    if let Err(error) = app.emit("tray-action", action) {
        eprintln!("发送托盘事件 {action} 失败: {error}");
    }
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            eprintln!("显示主窗口失败: {error}");
        }
        if let Err(error) = window.unminimize() {
            eprintln!("恢复主窗口失败: {error}");
        }
        if let Err(error) = window.set_focus() {
            eprintln!("聚焦主窗口失败: {error}");
        }
        #[cfg(windows)]
        sync_background_layer(app);
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "显示便签").build(app)?;
    let quick_add = MenuItemBuilder::with_id("quick-add", "快速添加").build(app)?;
    let always_on_top = CheckMenuItemBuilder::with_id("toggle-top", "始终置顶")
        .checked(true)
        .build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "设置").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出程序").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[
            &show,
            &quick_add,
            &always_on_top,
            &settings,
            &separator,
            &quit,
        ])
        .build()?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("桌面便签")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                show_window(app);
                emit_action(app, "show");
            }
            "quick-add" => {
                show_window(app);
                emit_action(app, "quick-add");
            }
            "toggle-top" => emit_action(app, "toggle-top"),
            "settings" => {
                show_window(app);
                emit_action(app, "settings");
            }
            "quit" => emit_action(app, "quit"),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_window(app);
                emit_action(app, "show");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    install_windows_transparency_hook().expect("安装透明窗口创建钩子失败");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:desktop-notes.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            set_background_appearance,
            set_background_visible,
            quit_app,
            show_reminder_notification
        ])
        .setup(|app| {
            #[cfg(windows)]
            {
                apply_windows_transparency(app)?;
                setup_background_layer(app)?;
            }
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "main"
                && matches!(
                    event,
                    WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::Focused(true)
                )
            {
                sync_background_layer(window.app_handle());
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("隐藏窗口失败: {error}");
                }
                #[cfg(windows)]
                {
                    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                    let hwnd = BACKGROUND_HWND.load(Ordering::Relaxed)
                        as windows_sys::Win32::Foundation::HWND;
                    if !hwnd.is_null() {
                        unsafe { ShowWindow(hwnd, SW_HIDE) };
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("运行桌面便签时发生错误");
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    #[test]
    fn transparency_uses_the_no_redirection_bitmap_style() {
        assert_eq!(NO_REDIRECTION_BITMAP_STYLE, 0x0020_0000);
    }

    #[test]
    fn rounded_background_has_antialiased_edge_pixels() {
        let coverages =
            (0..44).flat_map(|y| (0..44).map(move |x| rounded_rect_coverage(x, y, 100, 100, 22.0)));

        assert!(coverages
            .into_iter()
            .any(|coverage| (1..255).contains(&coverage)));
    }

    #[test]
    fn rounded_background_applies_coverage_to_pixel_alpha() {
        let pixel = background_pixel(36, 40, 48, 200, 128);
        let effective_alpha = (pixel >> 24) as u8;

        assert!(effective_alpha > 0);
        assert!(effective_alpha < 200);
    }

    #[test]
    fn drag_sync_does_not_toggle_background_topmost_band() {
        let source = include_str!("lib.rs");
        let sync_body = source
            .split_once("fn sync_background_layer")
            .expect("sync_background_layer should exist")
            .1
            .split_once("#[tauri::command]")
            .expect("the next command should delimit sync_background_layer")
            .0;

        assert!(!sync_body.contains("HWND_TOPMOST"));
        assert!(!sync_body.contains("HWND_NOTOPMOST"));
        assert!(!sync_body.contains("set_background_topmost_band"));
        assert_eq!(sync_body.matches("SetWindowPos(").count(), 1);
    }

    #[test]
    fn schedule_migration_preserves_explicit_time_and_safe_date_only_rows() {
        let connection = Connection::open_in_memory().expect("open migration fixture");
        connection
            .execute_batch(
                "CREATE TABLE notes (
                    id INTEGER PRIMARY KEY,
                    content TEXT NOT NULL,
                    due_at TEXT NULL,
                    scheduled_at TEXT NULL,
                    repeat_series_id INTEGER NULL,
                    is_all_day INTEGER NOT NULL DEFAULT 0
                );",
            )
            .expect("create legacy notes table");
        let local_nine_as_utc: String = connection
            .query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', '2026-07-27 09:00:00', 'utc')",
                [],
                |row| row.get(0),
            )
            .expect("derive a UTC value for local 09:00");
        connection
            .execute(
                "INSERT INTO notes VALUES (1,'timed',NULL,?1,NULL,0)",
                params![local_nine_as_utc],
            )
            .expect("insert timed row");
        connection
            .execute_batch(
                "INSERT INTO notes VALUES (2,'all-day','2026-07-27','2026-07-27T00:00:00',NULL,1);
                 INSERT INTO notes VALUES (3,'malformed','not-a-date-value',NULL,NULL,0);
                 INSERT INTO notes VALUES (4,'impossible','2026-02-30',NULL,NULL,0);
                 INSERT INTO notes VALUES (5,'repeat',NULL,'2026-07-28T00:00:00Z',9,0);",
            )
            .expect("insert legacy date rows");

        connection
            .execute_batch(MIGRATION_6_SQL)
            .expect("migration should tolerate malformed legacy dates");

        let timed: (Option<String>, Option<String>) = connection
            .query_row(
                "SELECT scheduled_date, scheduled_time FROM notes WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read timed result");
        assert_eq!(timed.1.as_deref(), Some("09:00"));

        let all_day: (Option<String>, Option<String>) = connection
            .query_row(
                "SELECT scheduled_date, scheduled_time FROM notes WHERE id=2",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read all-day result");
        assert_eq!(all_day, (Some("2026-07-27".into()), None));

        for id in [3, 4] {
            let date: Option<String> = connection
                .query_row("SELECT scheduled_date FROM notes WHERE id=?1", [id], |row| row.get(0))
                .expect("read invalid legacy row");
            assert_eq!(date, None);
        }
        let repeat_time: Option<String> = connection
            .query_row("SELECT scheduled_time FROM notes WHERE id=5", [], |row| row.get(0))
            .expect("read repeat result");
        assert_eq!(repeat_time, None);
    }
}
