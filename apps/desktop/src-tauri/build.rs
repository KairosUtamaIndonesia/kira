use std::{env, fs, path::Path};

fn main() {
    // Tauri validates that sidecar binaries exist at build time.
    // If the actual agent-pi binary hasn't been compiled yet (e.g., during
    // `cargo check` in local dev), create a placeholder to satisfy the check.
    // Real builds override this in `beforeBuildCommand` via the copy script.
    ensure_sidecar_placeholder();

    tauri_build::build();

    // Tell Cargo to re-run this script when .env or KIRA_CLOUD_URL changes.
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-env-changed=KIRA_CLOUD_URL");

    // CI sets this directly — nothing to do.
    if std::env::var("KIRA_CLOUD_URL").is_ok() {
        return;
    }

    // Local dev: load from .env so `env!("KIRA_CLOUD_URL")` works at compile time.
    let env_path = Path::new(".env");
    if !env_path.exists() {
        // Neither CI nor .env — the compiler will fail with a clear error
        // from the `env!()` macro in cloud_api.rs.
        return;
    }

    let content = match std::fs::read_to_string(env_path) {
        Ok(c) => c,
        Err(e) => {
            println!("cargo:warning=Failed to read .env: {e}");
            return;
        }
    };

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            if key.trim() == "KIRA_CLOUD_URL" {
                let value = value.trim().trim_matches('"').trim_matches('\'');
                println!("cargo:rustc-env=KIRA_CLOUD_URL={value}");
                return;
            }
        }
    }
}

/// Creates a minimal placeholder file at the expected sidecar binary path
/// so that `tauri_build::build()` doesn't fail when the agent-pi hasn't
/// been compiled yet. The placeholder is overwritten during production
/// builds by `scripts/copy-agent-pi-sidecar.ts`.
fn ensure_sidecar_placeholder() {
    let target_triple = match env::var("TARGET") {
        Ok(triple) => triple,
        Err(_) => {
            eprintln!("cargo:warning=TARGET env var not set, skipping sidecar placeholder");
            return;
        }
    };

    let ext = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let binary_name = format!("kira-agent-pi-{target_triple}{ext}");
    let binary_path = Path::new("binaries").join(&binary_name);

    if binary_path.exists() {
        return;
    }

    if let Some(parent) = binary_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if fs::write(&binary_path, Vec::new()).is_ok() {
        println!("cargo:warning=Created placeholder sidecar at {} — run `bun run compile` in agent-pi and re-build to ship real binary", binary_path.display());
    }
}
