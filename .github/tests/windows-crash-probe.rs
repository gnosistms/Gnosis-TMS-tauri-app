// Linked only into the disposable Windows smoke package.
use std::{path::PathBuf, time::Duration};

#[inline(never)]
fn gnosis_packaged_crash_probe() {
    #[link(name = "kernel32")]
    extern "system" {
        fn RaiseException(code: u32, flags: u32, count: u32, arguments: *const usize);
    }
    unsafe { RaiseException(0xE0424242, 1, 0, std::ptr::null()) };
    std::process::abort();
}

pub(super) fn when_requested() {
    let mut args = std::env::args_os().skip(1);
    match args.next().as_deref().and_then(|a| a.to_str()) {
        Some("--crash-before-window") => gnosis_packaged_crash_probe(),
        Some("--crash-on-marker") => {
            let Some(marker) = args.next().map(PathBuf::from) else {
                return;
            };
            std::thread::spawn(move || loop {
                if marker.is_file() {
                    gnosis_packaged_crash_probe();
                }
                std::thread::sleep(Duration::from_millis(50));
            });
        }
        _ => {}
    }
}
