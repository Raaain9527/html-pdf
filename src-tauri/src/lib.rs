use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::io::{BufRead, BufReader};
use tauri::{Manager, Emitter};
use tauri_plugin_dialog::{DialogExt, FilePath};

// 预览 daemon 生命周期状态（ADR 0001/0002: 懒加载 + 常驻 + 用户可关闭）
struct DaemonState {
    child: Mutex<Option<Child>>,
    url: Mutex<Option<String>>,
}

#[tauri::command]
fn start_preview_daemon(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<DaemonState>();

    // 已在运行 → 返回已有 URL
    {
        let mut guard = state.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(state.url.lock().unwrap().clone().unwrap_or_default());
            }
        }
    }

    // spawn preview-daemon.js, 读 stdout 首行 "LISTENING <port>"
    let project_root = find_project_root();
    let script = project_root.join("preview-daemon.js");
    let mut cmd = hidden_cmd(&node_exe_path());
    cmd.current_dir(&project_root)
        .arg(&script)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("启动预览服务失败: {}", e))?;
    let stdout = child.stdout.take().ok_or("无法读取预览服务输出")?;

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        if BufReader::new(stdout).read_line(&mut line).is_ok() {
            let _ = tx.send(line);
        }
    });

    let line = rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| {
            let _ = child.kill();
            "预览服务启动超时".to_string()
        })?;
    let port: u16 = line
        .split_whitespace()
        .nth(1)
        .and_then(|p| p.parse().ok())
        .ok_or_else(|| {
            let _ = child.kill();
            "预览服务端口解析失败".to_string()
        })?;

    let url = format!("ws://127.0.0.1:{}", port);
    *state.child.lock().unwrap() = Some(child);
    *state.url.lock().unwrap() = Some(url.clone());
    Ok(url)
}

#[tauri::command]
fn stop_preview_daemon(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<DaemonState>();
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.url.lock().unwrap() = None;
    Ok(())
}

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
        if let Some(exe_dir) = exe.parent() {
            // 安装版: 捆绑资源与 exe 同目录 (或 exe/resources), html2pdf.js 就在其中
            for cand in [exe_dir.to_path_buf(), exe_dir.join("resources")] {
                if cand.join("html2pdf.js").exists() {
                    return cand;
                }
            }
            // 开发布局: exe 在 src-tauri/target/release, 上溯 4 层到项目根
            if let Some(root) = exe_dir.parent() // target
                .and_then(|p| p.parent())        // src-tauri
                .and_then(|p| p.parent())        // project root
            {
                if root.join("html2pdf.js").exists() {
                    return root.to_path_buf();
                }
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
        // 安装版: 资源可能放在 exe/resources 子目录
        let installed = dir.join("resources").join("nodejs-portable").join("node.exe");
        if installed.exists() {
            eprintln!("[node] using installed-resources: {}", installed.display());
            return installed.to_string_lossy().to_string();
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
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
fn write_temp_html(original_path: Option<String>, html: String) -> Result<String, String> {
    if let Some(ref orig) = original_path {
        let orig_path = std::path::Path::new(orig);
        let parent = orig_path.parent().unwrap_or(std::path::Path::new("."));
        let temp_path = parent.join(".html-pdf-preview-temp.html");
        std::fs::write(&temp_path, &html).map_err(|e| format!("写入失败: {}", e))?;
        Ok(temp_path.to_string_lossy().to_string())
    } else {
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join("html-pdf-url-capture.html");
        std::fs::write(&temp_path, &html).map_err(|e| format!("写入失败: {}", e))?;
        Ok(temp_path.to_string_lossy().to_string())
    }
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
fn pick_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let files = app.dialog()
        .file()
        .add_filter("HTML", &["html", "htm"])
        .blocking_pick_files();
    match files {
        Some(paths) if !paths.is_empty() => {
            Ok(paths.into_iter()
                .filter_map(|fp| match fp { FilePath::Path(p) => Some(p.to_string_lossy().to_string()), _ => None })
                .collect())
        }
        _ => Err("取消选择".into()),
    }
}

#[tauri::command]
fn export_pdf(app: tauri::AppHandle, input: String, options: String) -> Result<String, String> {
    export_pdf_inner(app, vec![input], options)
}

fn export_pdf_inner(app: tauri::AppHandle, inputs: Vec<String>, options: String) -> Result<String, String> {
    if inputs.is_empty() { return Err("没有输入文件".into()); }

    let project_root = find_project_root();
    let script_path = project_root.join("html2pdf.js");
    let mut cmd = hidden_cmd(&node_exe_path());
    cmd.current_dir(&project_root).arg(&script_path);

    if inputs.len() == 1 {
        // Single file: save dialog
        let input = &inputs[0];
        let default_name = if input.starts_with("http://") || input.starts_with("https://") {
            input.replace("https://", "").replace("http://", "").split('/').next().unwrap_or("webpage").to_string()
        } else {
            std::path::Path::new(input).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "output".into())
        };
        let output = app.dialog().file().add_filter("PDF", &["pdf"]).set_file_name(&format!("{}.pdf", default_name)).blocking_save_file();
        let output_path = match output {
            Some(FilePath::Path(p)) => p.to_string_lossy().to_string(),
            _ => return Err("取消保存".into()),
        };
        cmd.arg(input).arg("-o").arg(&output_path);
        if let Ok(opts) = serde_json::from_str::<serde_json::Value>(&options) { apply_options_from_json(&mut cmd, &opts); }
        let result = cmd.output().map_err(|e| format!("node 执行失败: {}", e))?;
        if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).to_string()); }
        let _ = Command::new("explorer").arg("/select,").arg(&output_path).spawn();
        Ok(output_path)
    } else {
        // Batch: directory picker
        let out_dir = app.dialog().file().blocking_pick_folder();
        let out_dir_path = match out_dir {
            Some(FilePath::Path(p)) => p.to_string_lossy().to_string(),
            _ => return Err("取消选择输出目录".into()),
        };
        for input in &inputs { cmd.arg(input); }
        cmd.arg("-o").arg(&out_dir_path);
        if let Ok(opts) = serde_json::from_str::<serde_json::Value>(&options) { apply_options_from_json(&mut cmd, &opts); }
        let result = cmd.output().map_err(|e| format!("node 执行失败: {}", e))?;
        if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).to_string()); }
        let _ = Command::new("explorer").arg(&out_dir_path).spawn();
        Ok(out_dir_path)
    }
}

fn apply_options_from_json(cmd: &mut Command, opts: &serde_json::Value) {
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
            app.manage(DaemonState { child: Mutex::new(None), url: Mutex::new(None) });

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
                        let file_paths: Vec<String> = paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
                        if file_paths.len() == 1 {
                            let _ = h.emit("file-dropped", &file_paths[0]);
                        } else {
                            let _ = h.emit("files-dropped", file_paths);
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, read_file_base64, start_preview_daemon, stop_preview_daemon, write_temp_html, check_node, pick_file, pick_files, export_pdf])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 应用退出时清理预览 daemon 子进程
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = app_handle.state::<DaemonState>().child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
