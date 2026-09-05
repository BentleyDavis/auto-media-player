#[cfg(windows)]
mod win32 {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::thread;
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    static SPLASH_HWND: AtomicIsize = AtomicIsize::new(0);

    const CLASS_NAME: &[u16] = &[
        b'A' as u16, b'u' as u16, b't' as u16, b'o' as u16, b'M' as u16, b'e' as u16,
        b'd' as u16, b'i' as u16, b'a' as u16, b'P' as u16, b'l' as u16, b'a' as u16,
        b'y' as u16, b'e' as u16, b'r' as u16, b'S' as u16, b'p' as u16, b'l' as u16,
        b'a' as u16, b's' as u16, b'h' as u16, 0,
    ];

    const WINDOW_TITLE: &[u16] = &[
        b'S' as u16, b't' as u16, b'a' as u16, b'r' as u16, b't' as u16, b'i' as u16,
        b'n' as u16, b'g' as u16, 0,
    ];

    const FONT_NAME: &[u16] = &[
        b'S' as u16, b'e' as u16, b'g' as u16, b'o' as u16, b'e' as u16, b' ' as u16,
        b'U' as u16, b'I' as u16, 0,
    ];

    const SPLASH_TEXT: &[u16] = &[
        b'S' as u16, b't' as u16, b'a' as u16, b'r' as u16, b't' as u16, b'i' as u16,
        b'n' as u16, b'g' as u16, b' ' as u16, b'A' as u16, b'u' as u16, b't' as u16,
        b'o' as u16, b' ' as u16, b'M' as u16, b'e' as u16, b'd' as u16, b'i' as u16,
        b'a' as u16, b' ' as u16, b'P' as u16, b'l' as u16, b'a' as u16, b'y' as u16,
        b'e' as u16, b'r' as u16, 0,
    ];

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_PAINT => {
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                let hdc = BeginPaint(hwnd, &mut ps);
                if !hdc.is_null() {
                    let mut rect: RECT = std::mem::zeroed();
                    GetClientRect(hwnd, &mut rect);

                    // Dark slate background: #121214 (BGR: 0x00141212)
                    let bg_brush = CreateSolidBrush(0x00141212);
                    FillRect(hdc, &rect, bg_brush);
                    DeleteObject(bg_brush);

                    // Text styling
                    SetBkMode(hdc, TRANSPARENT as i32);
                    SetTextColor(hdc, 0x00f4f4f5); // Crisp off-white (BGR: 0x00f5f4f4)

                    let font = CreateFontW(
                        26, // Height
                        0,
                        0,
                        0,
                        FW_SEMIBOLD as i32,
                        0,
                        0,
                        0,
                        DEFAULT_CHARSET as u32,
                        OUT_DEFAULT_PRECIS as u32,
                        CLIP_DEFAULT_PRECIS as u32,
                        CLEARTYPE_QUALITY as u32,
                        DEFAULT_PITCH as u32,
                        FONT_NAME.as_ptr(),
                    );
                    let old_font = SelectObject(hdc, font);

                    DrawTextW(
                        hdc,
                        SPLASH_TEXT.as_ptr(),
                        (SPLASH_TEXT.len() - 1) as i32,
                        &mut rect,
                        DT_CENTER | DT_VCENTER | DT_SINGLELINE,
                    );

                    SelectObject(hdc, old_font);
                    DeleteObject(font);

                    EndPaint(hwnd, &mut ps);
                }
                0
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    pub fn show() {
        thread::spawn(|| unsafe {
            let hinstance = GetModuleHandleW(std::ptr::null());

            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: hinstance,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: CLASS_NAME.as_ptr(),
                hIconSm: std::ptr::null_mut(),
            };

            RegisterClassExW(&wc);

            let width = 440;
            let height = 160;
            let screen_w = GetSystemMetrics(SM_CXSCREEN);
            let screen_h = GetSystemMetrics(SM_CYSCREEN);
            let x = (screen_w - width) / 2;
            let y = (screen_h - height) / 2;

            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                CLASS_NAME.as_ptr(),
                WINDOW_TITLE.as_ptr(),
                WS_POPUP | WS_VISIBLE,
                x,
                y,
                width,
                height,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null(),
            );

            if hwnd.is_null() {
                return;
            }

            SPLASH_HWND.store(hwnd as isize, Ordering::SeqCst);

            ShowWindow(hwnd, SW_SHOW);
            UpdateWindow(hwnd);

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            SPLASH_HWND.store(0, Ordering::SeqCst);
        });
    }

    pub fn close() {
        let hwnd = SPLASH_HWND.swap(0, Ordering::SeqCst);
        if hwnd != 0 {
            unsafe {
                PostMessageW(hwnd as HWND, WM_CLOSE, 0, 0);
            }
        }
    }
}

#[cfg(windows)]
pub fn show() {
    win32::show();
}

#[cfg(not(windows))]
pub fn show() {}

#[cfg(windows)]
pub fn close() {
    win32::close();
}

#[cfg(not(windows))]
pub fn close() {}
