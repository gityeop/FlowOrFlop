use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let model_path = manifest_dir.join("models").join("L2CSNet_gaze360.pkl");
    if !model_path.exists() {
        println!(
            "cargo:warning=FlowOrFlop packaging warning: missing L2CS weights at {}",
            model_path.display()
        );
    }

    if let Some(sidecar_binary_name) = bundled_sidecar_binary_name() {
        let sidecar_path = manifest_dir.join("binaries").join(sidecar_binary_name);
        if !sidecar_path.exists() {
            println!(
                "cargo:warning=FlowOrFlop packaging warning: missing bundled L2CS sidecar at {}",
                sidecar_path.display()
            );
        }
    }

    tauri_build::build()
}

fn bundled_sidecar_binary_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("floworflop-l2cs-sidecar-aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("floworflop-l2cs-sidecar-x86_64-apple-darwin"),
        ("windows", "x86_64") => Some("floworflop-l2cs-sidecar-x86_64-pc-windows-msvc.exe"),
        _ => None,
    }
}
