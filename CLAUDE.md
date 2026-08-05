# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

HTML → PDF 矢量导出工具，支持 CLI / Web UI / Tauri 桌面应用三种形态。核心卖点：长页面自适应单页、Skia/PDF 矢量文字（可选中复制）、水印/密码/元数据后处理。

## 常用命令

```bash
# CLI 导出
node html2pdf.js input.html -o output.pdf
node html2pdf.js https://example.com -o page.pdf
node html2pdf.js a.html b.html -o pdf-output/          # 批量
node html2pdf.js --help

# Web UI
npm run ui                                              # 启动 Express → http://localhost:3456

# 桌面应用
npm run desktop                                         # 编译 + 启动
# 或分步：
cargo build --release --manifest-path src-tauri/Cargo.toml
.\src-tauri\target\release\html-pdf.exe

# 构建安装包（NSIS + MSI）
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri build
```

## 架构

```
                 ┌──────────────┐
                 │ html2pdf-lib │  核心引擎 (~150行)
                 │ (Puppeteer)  │  纯 Node.js，不依赖框架
                 └──────┬───────┘
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   html2pdf.js      server.js      src-tauri/
   (CLI入口)        (Express)      (Rust + Tauri v2)
   Commander         Multer上传      IPC 调用 Node
```

**核心引擎** (`html2pdf-lib.js`)：`findBrowser()` 扫描系统 Chrome/Edge 路径 → Puppeteer 无头启动 → 注入 JS 计算 scrollHeight 和 body 宽 → `page.pdf()` 输出单页 → 可选调用 `pdf-postprocess.js`（水印/加密/元数据）。

**三大入口共享同一份引擎**，各自只是调用方式不同。CLI 用 Commander 解析选项，Web UI 用 Express + Multer 接收上传文件，桌面应用用 Tauri Rust 后端 spawn `node` 子进程执行导出。

## 关键文件

| 文件 | 作用 |
|------|------|
| `html2pdf-lib.js` | 核心引擎：`findBrowser()`, `getBrowser()`, `exportPage()`, `closeBrowser()` |
| `html2pdf.js` | CLI 入口 (Commander)，含 `buildExportOptions()` 选项转换 |
| `pdf-postprocess.js` | 后处理：水印平铺 (CJK 字体自动检测)、AES 加密、元数据 |
| `server.js` | Express 服务：`POST /api/export/file` (上传)、`POST /api/export/url` |
| `ui/index.html` | 桌面版 UI（Tauri 资产协议加载，IPC 调用） |
| `ui/web.html` | 浏览器版 UI（Express 加载，fetch API 上传） |
| `src-tauri/src/lib.rs` | Rust 后端：`pick_file`、`export_pdf` 命令，拖拽事件监听 |
| `src-tauri/tauri.conf.json` | Tauri 配置：资产协议、窗口设置、资源捆绑 |

## 技术要点

- **Puppeteer** 需要系统有 Chrome/Edge。`findBrowser()` 按平台自动扫描标准安装路径，`CHROME_PATH` 环境变量可覆盖
- **Tauri v2** 需要 Rust 工具链 + `protocol-asset` feature（Cargo.toml 中已配置）。`withGlobalTauri: true` + `csp: null` 确保 `__TAURI__` API 注入
- **文件对话框**必须是同步 `fn` 而非 `async fn`——Windows COM STA 线程模型要求。这是 v1.1 迁移中最耗时的一个 bug
- **便携 Node.js** 捆绑在 `nodejs-portable/node.exe`（构建时下载）。Rust 的 `node_exe_path()` 优先用捆绑版，fallback 到系统 Node
- **中文文件名**：Express `res.download()` 需手动设 RFC 5987 `Content-Disposition`。Web 上传文件需加 `.html` 后缀（multer 去掉了后缀名，Chrome 不认识）

## 报告文档

项目包含求职用的 AI 作品展示报告（凉屋游戏运营实习岗）。报告位于 `docs/reports/`，采用文件名后缀（_v1/_v2/_v3）版本管理，由 git 之外维护：

- `docs/reports/current/` — 当前有效版：
  - `AI作品展示报告_html-pdf_v3.md` — 最新运营版正文
  - `AI作品展示报告_html-pdf_框架规划_v3.md` — v3 框架
- `docs/reports/archive/` — 历史/派生版：
  - `AI作品展示报告_html-pdf_v1.md` — 技术版（含全部 3 个 Bug 细节、选型详述）
  - `AI作品展示报告_html-pdf_v2.md` — 废弃版（含编造内容，仅供参考）
  - `AI作品展示报告_html-pdf.md` — 原版/全栈工程师版
  - `AI作品展示报告_html-pdf_框架规划.md` / `_v1.md` — v1.0 框架（两份为副本）
  - `AI作品展示报告_html-pdf_框架规划_v2.md` — 废弃框架
  - `推文——AI作品展示报告_html-pdf_v1 1.md` + 两张截图 PNG（Obsidian 嵌入引用，须同目录）
- `PRD.md` — 产品需求文档
- `README.md` — 项目 README

报告经过双 Agent 交叉审查（事实核查 + 结构/受众审查），v3 清除了所有编造内容。
