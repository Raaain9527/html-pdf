# HTML → PDF 导出工具 PRD

## 1. 项目背景与目标

在日常工作中，经常需要将 HTML 页面（如在线简历、报告、发票、课程笔记、文档页面等）导出为 PDF 存档或打印。现有方案（浏览器「另存为 PDF」、wkhtmltopdf 等）存在分页不智能、文字被栅格化无法选中、长页面被截断等痛点。

本项目的目标是开发一款**将任意 HTML 导出为高质量矢量 PDF** 的桌面/命令行工具，核心卖点：**长页面自适应单页、矢量文字可选中、排版忠实还原**。

## 2. 目标用户

| 用户角色 | 典型场景 |
|---------|---------|
| 求职者 | 将 HTML 简历导出为单页 PDF，排版不炸，文字可被 ATS 解析 |
| 运营/商务 | 将活动落地页、数据报表页面导出为 PDF 发送给客户 |
| 开发者 | 将 API 文档、CHANGELOG、技术笔记批量导出 PDF |
| 普通办公用户 | 把网页文章、教程保存为 PDF 离线阅读 |

## 3. 功能需求

### 3.1 核心功能

| 编号 | 功能 | 描述 | 优先级 |
|------|------|------|--------|
| F1 | HTML → PDF 导出 | 输入 HTML 文件或 URL，输出 PDF 文件 | P0 |
| F2 | 长页面单页导出 | 自动计算内容高度，将整页内容渲染为单张 PDF 页面，不分页截断 | P0 |
| F3 | 矢量文字输出 | PDF 中的文字以矢量方式嵌入，可选中、复制、搜索 | P0 |
| F4 | 中文字体支持 | 自动嵌入中文字体子集，确保中文正常显示不失真 | P0 |

### 3.2 进阶功能

| 编号 | 功能 | 描述 | 优先级 |
|------|------|------|--------|
| F5 | CSS 排版保真 | 完整支持 CSS3 常用属性（Flex、Grid、定位、圆角、阴影、渐变） | P1 |
| F6 | 图片/背景支持 | 正确渲染 `<img>`、CSS `background-image`、SVG 图标 | P1 |
| F7 | 自定义页面尺寸 | 支持 A4 / Letter / 自定义宽高（mm / px） | P1 |
| F8 | 页边距控制 | 支持自定义上下左右页边距 | P1 |
| F9 | URL 直接导出 | 输入网址，自动抓取并渲染后导出 | P1 |
| F10 | 批量导出 | 支持一次输入多个 HTML/URL，批量生成 PDF | P2 |
| F11 | 水印叠加 | 支持文字/图片水印，可调透明度、位置、旋转角度 | P2 |
| F12 | 密码保护 | 输出 PDF 可设置打开密码 | P2 |
| F13 | 目录/书签生成 | 根据 HTML 中的 h1~h6 自动生成 PDF 书签大纲 | P2 |

### 3.3 交互方式

| 编号 | 方式 | 描述 |
|------|------|------|
| I1 | CLI 命令行 | `html2pdf input.html -o output.pdf --single-page` |
| I2 | 本地 Web UI | 启动本地服务，拖拽 HTML 文件或粘贴 URL，预览后导出 |
| I3 | GUI 桌面应用 | 基于 Electron/Tauri 的桌面窗口，拖拽即导出（远期规划） |

## 4. 非功能需求

### 4.1 性能
- 单个 HTML 文件（≤ 5MB）导出应在 10 秒内完成
- 支持 ≤ 50MB 的 HTML 文件不崩溃

### 4.2 兼容性
- 支持 Windows 10+ / macOS 12+ / Linux (Ubuntu 20.04+)
- 输出 PDF 兼容 Adobe Acrobat Reader、Chrome PDF 查看器、macOS Preview

### 4.3 可维护性
- 核心引擎与 UI 解耦，可独立升级
- PDF 生成使用成熟开源方案，不重复造轮子

## 5. 技术方案建议

| 方案 | 核心技术 | 优点 | 缺点 |
|------|---------|------|------|
| **方案 A：Puppeteer + 无头 Chromium** | Puppeteer/Playwright 驱动 Chromium，调用 `Page.printToPDF` | 排版保真度最高，CSS 完美兼容 | 长页面自动单页需要注入 JS 计算高度；依赖 Chromium（体积大） |
| **方案 B：wkhtmltopdf** | Qt WebKit 渲染引擎 | 轻量，命令行友好 | 对现代 CSS（Flex/Grid）支持差，已多年不维护 |
| **方案 C：WeasyPrint** | Python 纯自研布局引擎 | 轻量，纯 Python，矢量输出质量高 | 不支持 JavaScript，复杂 CSS 兼容性有限 |
| **推荐方案：A（Puppeteer）** | 见上 | 排版保真度无可替代，单页方案成熟 | 通过 `puppeteer-core` + 系统 Chromium 减小包体积 |

## 6. 关键实现路径

```
输入 HTML/URL
    │
    ▼
Chromium 无头浏览器加载页面
    │
    ▼
等待所有资源加载完成（图片、字体、CSS）
    │
    ▼
注入 JS 脚本：
  - 设置 document.documentElement.style.height = 内容真实高度
  - 隐藏固定定位元素（避免重复）
  - 展开折叠区域
    │
    ▼
Page.printToPDF({
  printBackground: true,
  preferCSSPageSize: false,   // 忽略 CSS 分页，强制单页
  width: '...',               // 用户指定或按视口
  height: '...',              // 动态计算的内容高度
  displayHeaderFooter: false
})
    │
    ▼
输出 PDF ──→ 可选：用 qpdf/pikepdf 后处理（加水印、密码、压缩）
```

## 7. 版本规划

| 版本 | 内容 | 交付物 |
|------|------|--------|
| v0.1 MVP | CLI 工具：输入 HTML 文件 → 单页矢量 PDF | npm 包 / 可执行文件 |
| v0.2 | 支持 URL 输入，批量导出，页面尺寸自定义 | 同上 |
| v0.3 | 本地 Web UI（Express + 前端拖拽页） | npm 包 + Web 界面 |
| v0.4 | 水印、密码保护、PDF 元数据 | 同上 |
| v1.0 | 桌面应用（Electron），一键拖拽导出 | 安装包 |

## 8. 成功指标

- 导出的 PDF 在 Chrome PDF 查看器中打开，文字可选中复制
- 导出的 PDF 排版与浏览器中预览一致度 ≥ 95%
- 一个 3 屏长的 HTML 页面导出为 1 页 PDF，无截断
- CLI 单次导出耗时 ≤ 5 秒（不含 Chromium 冷启动）
