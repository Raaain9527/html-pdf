use std::process::Command;
use tauri_plugin_dialog::{DialogExt, FilePath};

#[tauri::command]
async fn pick_and_export(app: tauri::AppHandle, url: Option<String>, options: String) -> Result<String, String> {
    // 1. Determine input: file dialog or URL
    let input = if let Some(u) = url {
        if !u.is_empty() { u } else { return Err("URL is empty".into()); }
    } else {
        let file = app.dialog()
            .file()
            .add_filter("HTML", &["html", "htm"])
            .blocking_pick_file();
        match file {
            Some(FilePath::Path(p)) => p.to_string_lossy().to_string(),
            _ => return Err("未选择文件".into()),
        }
    };

    // 2. Save dialog
    let output = app.dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();
    let output_path = match output {
        Some(FilePath::Path(p)) => p.to_string_lossy().to_string(),
        _ => return Err("取消保存".into()),
    };

    // 3. Parse options and build command
    let mut cmd = Command::new("node");
    cmd.arg("html2pdf.js")
        .arg(&input)
        .arg("-o")
        .arg(&output_path);

    if let Ok(opts) = serde_json::from_str::<serde_json::Value>(&options) {
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

    let result = cmd.output().map_err(|e| format!("执行失败: {}", e))?;

    if result.status.success() {
        // Open the output folder
        if let Some(parent) = std::path::Path::new(&output_path).parent() {
            let _ = Command::new("explorer").arg("/select,").arg(parent.join(std::path::Path::new(&output_path).file_name().unwrap())).spawn();
        }
        Ok(output_path)
    } else {
        Err(String::from_utf8_lossy(&result.stderr).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![pick_and_export])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
