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

从 [Releases](https://github.com/Raaain9527/html-pdf/releases) 下载 `HTML-to-PDF-x.x.x.exe`（~20MB）。

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
2. 文件标签：点击拖拽区选择 HTML → 显示文件名
3. URL 标签：输入网址，点击加载
4. 展开「高级选项」设置水印、密码、元数据
5. 点击「导出 PDF」→ 保存框默认使用 HTML 原名 → 导出完成自动打开文件夹

## 项目结构

```
├── html2pdf.js          # CLI 命令行工具
├── html2pdf-lib.js      # 核心导出引擎（Puppeteer）
├── pdf-postprocess.js   # PDF 后处理（水印/加密/元数据）
├── server.js            # Web UI 后端
├── ui/
│   ├── index.html       # 桌面版 UI（Tauri 加载）
│   └── web.html         # 浏览器版 UI（Express 加载）
├── src-tauri/           # Tauri 桌面应用（Rust）
│   ├── src/lib.rs       # 后端命令（文件选择/导出）
│   └── src/main.rs      # 入口
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
| **P0** | 实时预览 | 导出前渲染预览，视口宽度/缩放等参数变化时预览实时更新。左右分栏布局（左侧设置、右侧 iframe 预览），解决"盲操作"问题 |
| **P0** | 交互式导出 | 预览中开启交互模式后，可点击页面元素（展开折叠区、切换标签等），导出交互后的 DOM 状态而非默认 HTML |
| P2 | Chrome 直调模式 | Rust 直接调用 Chrome `--headless --print-to-pdf`，移除 Node.js 依赖 |
| P3 | PDF 书签 | 根据 HTML h1–h6 自动生成 PDF 目录大纲 |
| P3 | 图片水印 | 支持 PNG/JPEG 图片作为水印 |
| P3 | macOS 支持 | 适配 macOS 桌面端 |

详见 [PRD §3.3–3.4](./PRD.md)。

## License

MIT
