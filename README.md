# HTML → PDF

长页面单页导出为矢量 PDF，文字可选中复制。

## 特性

- **长页面自适应单页** — 自动计算内容高度，不分页截断
- **矢量文字可选中** — Skia/PDF 引擎，中英文可搜索复制
- **高清渲染** — 2x deviceScaleFactor，文字锐利
- **批量导出** — 一次输入多个文件/URL，复用浏览器实例
- **中文水印** — 平铺水印，自动嵌入 CJK 字体
- **密码保护** — PDF 打开密码 + 所有者密码
- **元数据** — 自定义标题/作者/主题/关键词
- **内置 Node.js** — 桌面版捆绑便携 Node.js，免安装依赖

**桌面版预览（v1.3.0）**

- **流式投影预览** — 后台真实 Chrome 渲染，前端直接显示真实渲染结果，所见即所得
- **高清双通道** — 滚动/交互时实时帧保持流畅，静止后自动切换到高清帧
- **断点感知自动适配** — 打开页面自动把视口调到内容宽度，避开页面自身的响应式断点（两列布局不会塌成一列）
- **交互式导出** — 预览中的点击、填写、展开等交互状态会进入导出的 PDF
- **缩放控制** — 适配面板 / 1:1 / Ctrl+滚轮图像缩放

## 快速开始

```bash
git clone https://github.com/Raaain9527/html-pdf.git
cd html-pdf
npm install
```

需要系统已安装 Chrome / Edge / Chromium 浏览器。

## 使用方式

### CLI 命令行

```bash
# HTML 文件 → 单页 PDF
node html2pdf.js resume.html -o resume.pdf

# URL → PDF
node html2pdf.js https://example.com -o page.pdf

# 批量导出
node html2pdf.js a.html b.html c.html -o pdf-output/

# 水印 + 密码 + 元数据
node html2pdf.js resume.html -o out.pdf \
  --watermark "机密文件" \
  --watermark-opacity 0.06 \
  --password "123456" \
  --title "简历" --author "姓名"

# 查看所有选项
node html2pdf.js --help
```

### Web UI

```bash
npm run ui
# 打开 http://localhost:3456
```

拖拽 HTML 文件或输入 URL，设置参数后导出。

### 桌面应用

从 [Releases](https://github.com/Raaain9527/html-pdf/releases) 下载安装包：

- **NSIS 安装包**（推荐）：`HTML-to-PDF_1.3.0_x64-setup.exe`（~37MB）
- **MSI 安装包**：`HTML-to-PDF_1.3.0_x64_en-US.msi`（~68MB）

安装包已捆绑便携 Node.js 与全部依赖，免装 Node。**仍需系统已安装 Chrome / Edge**（导出与预览引擎使用）。

或从源码编译：

```bash
# 需要 Rust 工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 构建
cargo build --release --manifest-path src-tauri/Cargo.toml
.\src-tauri\target\release\html-pdf.exe
```

## 桌面版使用流程

1. 打开应用 → 文件标签 / URL 标签
2. 文件标签：点击拖拽区选择 HTML → 右侧**实时预览自动渲染**（首次会懒加载预览服务，约 1-3 秒）
3. URL 标签：输入网址，点击加载
4. 预览交互：滚轮滚动页面、Ctrl+滚轮图像缩放、点击/填写直接作用于真实页面；视口宽度自动适配内容宽
5. 预览服务：工具栏显示运行状态，点「关闭 Node」可手动停止（下次预览自动重启）
6. 展开「高级选项」设置水印、密码、元数据
7. 点击「导出 PDF」→ 保存框默认使用 HTML 原名 → 导出完成自动打开文件夹

## 项目结构

```
├── html2pdf.js          # CLI 命令行工具
├── html2pdf-lib.js      # 核心导出引擎（Puppeteer）
├── pdf-postprocess.js   # PDF 后处理（水印/加密/元数据）
├── preview-daemon.js    # 桌面版预览 daemon（流式投影，v1.3.0）
├── server.js            # Web UI 后端
├── ui/
│   ├── index.html       # 桌面版 UI（Tauri 加载）
│   └── web.html         # 浏览器版 UI（Express 加载）
├── src-tauri/           # Tauri 桌面应用（Rust）
│   ├── src/lib.rs       # 后端命令（文件选择/导出/预览 daemon 生命周期）
│   └── src/main.rs      # 入口
├── docs/                # 架构决策记录（ADR）+ 术语表
└── nodejs-portable/     # 便携 Node.js（构建时下载）
```

## 技术栈

| 组件 | 技术 |
|------|------|
| PDF 渲染 | Puppeteer + Chromium Skia/PDF |
| PDF 后处理 | pdf-lib-plus-encrypt |
| 桌面框架 | Tauri v2 (Rust + WebView2) |
| Web 服务 | Express |
| CLI | Commander |

## 后续计划

| 优先级 | 功能 | 描述 |
|------|------|------|
| P2 | 分发体积优化 | 移除捆绑 Node.js（Rust 直调 Chrome CDP）或精简依赖，当前安装包约 37MB |
| P2 | Chrome 直调模式 | Rust 直接通过 DevTools 协议驱动 Chrome，移除 Node.js 依赖 |
| P3 | PDF 书签 | 根据 HTML h1–h6 自动生成 PDF 目录大纲 |
| P3 | 图片水印 | 支持 PNG/JPEG 图片作为水印 |
| P3 | macOS 支持 | 适配 macOS 桌面端 |

详见 [PRD §3.3–3.4](./PRD.md)。

## 已知限制

- **`vh` 单位页面**（如 `100vh`、`min-height:100vh`）：在"长页面单页导出"下会分页——Chromium 打印布局中 `vh` 按 PDF 页高解析的固有行为
- **安装包体积**：桌面版捆绑便携 Node.js 与依赖，NSIS 约 37MB（压缩后）；可通过"后续计划"中的体积优化缩减

## License

MIT
