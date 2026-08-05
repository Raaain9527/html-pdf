# ADR 0001: 预览改为「流式远程浏览器投影」(CDP screencast)

**日期**：2026-08-05
**状态**：已决定（grilling 会话确认）

## 上下文

当前预览（`ui/index.html`）用 srcdoc iframe 在 Tauri WebView2 里重渲染。但存在两个不可调和的问题：

1. **渲染坍塌**：导出引擎（`html2pdf-lib.js:76-77`）用 Puppeteer 以 **1680×900** 视口渲染（高度 900 硬编码），而预览 iframe 设了 `height:auto`（`ui/index.html:311`），Chrome 下实际只有 150px 高。视口高度不一致 → 任何用 `vh` / `100%` / `min-height:100vh` / flex 高度 / `position:fixed` 的布局，预览与导出必然不一致。
2. **单页 PDF 悖论**：本工具的产物是 `1680 × 30000` 的单页 PDF。单个 iframe 无法同时满足「视口高度正确（=900，保证 vh 布局）」和「展示全部内容（高度=scrollHeight）」。数学上无解。

**用户确认的需求**：
- 交互模式必须保留（点击/填表后状态进入导出的 PDF）
- 预览的"投影映射"定义 = **在固定视口大小内、流式的、可滚动的**显示

## 决策

放弃 srcdoc iframe 预览，改为**常驻 Puppeteer 预览 daemon**：

- Rust 侧启动一个长期运行的 Node 进程（`preview-daemon`），持有 warm Puppeteer，用 `findBrowser()` 扫到的用户本机 Chrome/Edge 渲染真实页面
- 通过 CDP `Page.startScreencast` 把 **1680×900 视口**的帧流推到前端
- 前端把鼠标/滚轮/键盘事件转发回 daemon，驱动**真实 DOM** 交互
- 导出时直接抓取 daemon 中真实 DOM（含交互状态）写临时文件导出，复用现有 `write_temp_html` + `export_pdf` 链路

## 理由

- 唯一同时满足「保真（与导出同引擎、同视口参数）」和「可交互」的路径
- 坍塌从根上消失：预览就是导出的那个渲染，不再是 webview 重渲染
- 交互模式天然成立：交互作用于真实 DOM，导出捕获的也是真实 DOM
- 不再需要 base64 图片内嵌、`file://` CSS url() 重写、viewport meta 注入等 iframe hack（`ui/index.html:260-291`）

## 后果

**正面**
- 预览 = 导出渲染，WYSIWYG 在视口窗口内成立
- 交互状态捕获比现在的 `outerHTML` 抓取更干净（无 base64 包袱）
- 视口高度 900 从硬编码浮升为一等设置，随参数变化实时反映

**负面**
- 新增常驻 Node daemon 子系统（约 200-400 行）+ 新依赖（`ws`）
- 首次预览有浏览器冷启动延迟（~1-2s，warm 后 ~200-400ms）
- 交互延迟 ~100-300ms，鼠标事件需节流
- 缩放模型待设计：视口宽 1680 常大于面板宽，需「1:1 平移 / fit 缩放 / 图像缩放」三模式
- daemon 常驻持有 Chrome，额外内存 ~200MB

## 备选方案

| 方案 | 结论 | 原因 |
|------|------|------|
| A 全页截图投影 | 否决 | 不可交互，杀死交互模式 |
| C PDF 投影（pdf.js 显示） | 否决 | 每次参数变化需全量导出，慢；单页 30000px 同样有缩放问题 |
| 维持 srcdoc iframe | 否决 | 单页 PDF 悖论无解，只能缓解不能根治 |

## 关联

- 视口高度硬编码：`html2pdf-lib.js:77`
- 现预览 iframe 高度缺陷：`ui/index.html:307-313`
- 术语：见 `docs/glossary.md`（投影映射、渲染坍塌、视口高度、交互模式）
