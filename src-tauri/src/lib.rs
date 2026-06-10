use std::process::Command;
use tauri::{Manager, Emitter};
use tauri_plugin_dialog::{DialogExt, FilePath};

// Hide console window on Windows
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn hidden_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

fn find_project_root() -> std::path::PathBuf {
    // Try to find project root relative to the exe at runtime.
    // This is more robust than CARGO_MANIFEST_DIR (compile-time path).
    if let Ok(exe) = std::env::current_exe() {
        // exe is in src-tauri/target/release/html-pdf.exe
        // Go up 3 levels to project root
        if let Some(root) = exe.parent() // release
            .and_then(|p| p.parent())    // target
            .and_then(|p| p.parent())    // src-tauri
            .and_then(|p| p.parent())    // project root
        {
            let script = root.join("html2pdf.js");
            if script.exists() {
                return root.to_path_buf();
            }
        }
    }
    // Fallback: CARGO_MANIFEST_DIR compile-time path
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    if root.join("html2pdf.js").exists() {
        return root;
    }
    // Last resort: current directory
    std::env::current_dir().unwrap_or(root)
}

fn node_exe_path() -> String {
    // Priority: bundled portable Node.js, then system Node.js
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    if let Some(dir) = &exe_dir {
        let bundled = dir.join("nodejs-portable").join("node.exe");
        if bundled.exists() {
            eprintln!("[node] using bundled: {}", bundled.display());
            return bundled.to_string_lossy().to_string();
        }
        // Also check relative to project root (for cargo run)
        let project_bundled = dir.join("../../../nodejs-portable/node.exe");
        if project_bundled.exists() {
            eprintln!("[node] using project-bundled: {}", project_bundled.display());
            return project_bundled.to_string_lossy().to_string();
        }
    }
    // Fallback: absolute project path from build time
    let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let project_bundled = project_root.join("nodejs-portable").join("node.exe");
    if project_bundled.exists() {
        eprintln!("[node] using CARGO_MANIFEST_DIR bundled: {}", project_bundled.display());
        return project_bundled.to_string_lossy().to_string();
    }
    // Final fallback: system node
    eprintln!("[node] using system node");
    "node".to_string()
}

#[tauri::command]
fn check_node() -> bool {
    hidden_cmd(&node_exe_path()).arg("--version").output()
        .map(|o| o.status.success()).unwrap_or(false)
}

#[tauri::command]
fn pick_file(app: tauri::AppHandle) -> Result<String, String> {
    let file = app.dialog()
        .file()
        .add_filter("HTML", &["html", "htm"])
        .blocking_pick_file();
    match file {
        Some(FilePath::Path(p)) => Ok(p.to_string_lossy().to_string()),
        _ => Err("取消选择".into()),
    }
}

#[tauri::command]
fn export_pdf(app: tauri::AppHandle, input: String, options: String) -> Result<String, String> {
    // Generate default output filename from input
    let default_name = if input.starts_with("http://") || input.starts_with("https://") {
        // For URLs, use hostname as default filename
        input
            .replace("https://", "")
            .replace("http://", "")
            .split('/')
            .next()
            .unwrap_or("webpage")
            .to_string()
    } else {
        std::path::Path::new(&input)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "output".into())
    };

    // Save dialog
    let output = app.dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&format!("{}.pdf", default_name))
        .blocking_save_file();
    let output_path = match output {
        Some(FilePath::Path(p)) => p.to_string_lossy().to_string(),
        _ => return Err("取消保存".into()),
    };

    // Run export
    let project_root = find_project_root();
    let script_path = project_root.join("html2pdf.js");

    let mut cmd = hidden_cmd(&node_exe_path());
    cmd.current_dir(&project_root)
        .arg(&script_path)
        .arg(&input)
        .arg("-o")
        .arg(&output_path);

    if let Ok(opts) = serde_json::from_str::<serde_json::Value>(&options) {
        apply_options(&mut cmd, &opts);
    }

    let result = cmd.output().map_err(|e| format!("node 执行失败: {}", e))?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).to_string());
    }

    let _ = Command::new("explorer").arg("/select,").arg(&output_path).spawn();
    Ok(output_path)
}

fn apply_options(cmd: &mut Command, opts: &serde_json::Value) {
    if let Some(w) = opts.get("watermark").and_then(|v| v.as_object()) {
        if let Some(t) = w.get("text").and_then(|v| v.as_str()) {
            if !t.is_empty() { cmd.arg("--watermark").arg(t); }
        }
        if let Some(o) = w.get("opacity").and_then(|v| v.as_f64()) {
            cmd.arg("--watermark-opacity").arg(o.to_string());
        }
        if let Some(r) = w.get("rotation").and_then(|v| v.as_f64()) {
            cmd.arg("--watermark-rotation").arg(r.to_string());
        }
        if let Some(s) = w.get("fontSize").and_then(|v| v.as_f64()) {
            cmd.arg("--watermark-size").arg(s.to_string());
        }
    }
    if let Some(pw) = opts.get("password").and_then(|v| v.as_object()) {
        if let Some(u) = pw.get("userPassword").and_then(|v| v.as_str()) {
            if !u.is_empty() { cmd.arg("--password").arg(u); }
        }
        if let Some(o) = pw.get("ownerPassword").and_then(|v| v.as_str()) {
            if !o.is_empty() { cmd.arg("--owner-password").arg(o); }
        }
    }
    if let Some(meta) = opts.get("metadata").and_then(|v| v.as_object()) {
        if let Some(t) = meta.get("title").and_then(|v| v.as_str()) {
            if !t.is_empty() { cmd.arg("--title").arg(t); }
        }
        if let Some(a) = meta.get("author").and_then(|v| v.as_str()) {
            if !a.is_empty() { cmd.arg("--author").arg(a); }
        }
        if let Some(s) = meta.get("subject").and_then(|v| v.as_str()) {
            if !s.is_empty() { cmd.arg("--subject").arg(s); }
        }
        if let Some(k) = meta.get("keywords").and_then(|v| v.as_str()) {
            if !k.is_empty() { cmd.arg("--keywords").arg(k); }
        }
    }
    if let Some(v) = opts.get("viewportWidth").and_then(|v| v.as_u64()) {
        cmd.arg("--viewport-width").arg(v.to_string());
    }
    if let Some(s) = opts.get("scale").and_then(|v| v.as_f64()) {
        cmd.arg("--scale").arg(s.to_string());
    }
    if let Some(w) = opts.get("width").and_then(|v| v.as_str()) {
        if !w.is_empty() { cmd.arg("-w").arg(w); }
    }
    if let Some(h) = opts.get("height").and_then(|v| v.as_str()) {
        if !h.is_empty() { cmd.arg("-H").arg(h); }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Check Node.js is available
            let has_node = hidden_cmd(&node_exe_path()).arg("--version").output()
                .map(|o| o.status.success()).unwrap_or(false);
            if !has_node {
                eprintln!("WARNING: Node.js not found. PDF export will not work.");
            }

            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let h = handle.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                        if let Some(path) = paths.first() {
                            let _ = h.emit("file-dropped", path.to_string_lossy().to_string());
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_node, pick_file, export_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
