use std::path::Path;

fn main() {
    // Silence the "unexpected cfg condition" lint for Tauri's built-in cfgs.
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    println!("cargo::rustc-check-cfg=cfg(desktop)");

    // CI sets this directly — nothing to do.
    if std::env::var("KIRA_CLOUD_URL").is_ok() {
        return;
    }

    // Local dev: load from .env so `env!("KIRA_CLOUD_URL")` works at compile time.
    let env_path = Path::new(".env");
    if !env_path.exists() {
        // Neither CI nor .env — the compiler will fail with a clear error
        // from the `env!()` macro in admin_api.rs.
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
