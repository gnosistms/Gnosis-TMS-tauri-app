fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Desktop thread waits must resolve through the Windows SDK import
        // library before a transitive library can supply the enclave versions.
        println!("cargo:rustc-link-lib=dylib=synchronization");
    }
    tauri_build::build()
}
