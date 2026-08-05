# 术语表 (Glossary)

维护约定：本项目的领域术语、易混淆概念、架构内部名词。新增条目时保持与既有条目统一。

## 视口宽度 (viewportWidth)
Puppeteer 渲染页面的浏览器窗口**宽度**（CLI 默认 1280，UI 默认 1680），决定页面布局：媒体查询、`vw`、百分比宽度。**不等于** PDF 页面宽度。
- 引用：`html2pdf-lib.js:76`、`ui/index.html:262`

## 视口高度
Puppeteer 渲染窗口**高度**，**当前硬编码 900**。`vh`、`min-height:100vh`、`height:100%`、`position:fixed` 均按它解析。**预览坍塌与"预览窗口高度不正确"的共同根因**——预览 iframe 实际只有 150px 高。
- 引用：`html2pdf-lib.js:77`（硬编码 900）

## 页面宽度/高度 (pdfWidth / pdfHeight)
PDF 页面的物理尺寸。宽度留空时 = 内容容器宽度（`wrapperW` 裁剪结果）；高度留空时 = 单页 `scrollHeight`。对应 UI 的"页面宽度 / 页面高度"输入框。

## 输出缩放 (scale)
`page.pdf()` 的整体缩放倍数（`html2pdf-lib.js:154`）。作用于整张 PDF，**不改布局视口**，与"视口宽度"是正交概念。

## 渲染坍塌
同一 HTML 在预览端与导出端布局不一致。**两个独立根因**（均已定位并用渲染实测复现）：

1. **视口高度不一致**：预览 iframe 曾设 `height:auto`（Chrome 默认 150px），导出视口高 900px——`vh` 在预览按 1.5px 解析、导出按 9px 解析，`vh`/百分比/flex 高度布局坍塌。
2. **视口宽度被 flex 收缩**（主要根因）：`.preview-frame` 是 `.preview-frame-wrap`（`display:flex`）的 flex 子项，默认 `flex-shrink:1`。**窗口化时面板比设定视口（如 1680px）窄，iframe 被压缩到面板宽**（实测 812px），"浏览器视口"被悄悄改小——若低过页面自身的响应式断点（如简历的 `@media (max-width:920px)`），布局按断点重排，表现为"全屏正常、窗口化坍塌"。视觉与实测双重确认（截图 + getBoundingClientRect）。

修复状态（2026-08-05，Phase 1）：
- 高度：`ui/index.html` `updatePreviewScale()` 把 iframe 高度固定 900px（对齐 `html2pdf-lib.js:77`）
- 宽度：`.preview-frame` 加 `flex-shrink:0`，保持设定视口宽，面板横向滚动
- 副作用：内容超视口时需在 iframe 内部/面板滚动；终极方案见 ADR 0001（流式投影）

## 所见即所得 (WYSIWYG)
预览与导出一致。本工具的特殊性：导出是单页 `1680×30000`，任何预览界面都装不下整张，因此"所见"被限定为 **固定视口窗口内的真实渲染**，靠滚动浏览。超出该定义范围的"完全一致"不作承诺。

## 投影映射 (projection)
前端不自己渲染页面，而是**显示后台真实渲染引擎（Chrome）的帧流**——预览是引擎输出的"投影"。与"在 webview 里重渲染一份"相对。本项目的具体形态：CDP screencast 流式投影。

## 流式投影 / 可滚动视口
投影映射的形态约束：在**固定视口**（如 1680×900）内，用户通过滚动浏览超出视口的页面内容。滚轮事件转发给真实页面执行原生滚动。

## 交互模式
预览中可点击/填写页面元素，交互后的 **DOM 状态会被捕获进导出的 PDF**。现有 srcdoc 实现靠 `pointerEvents` + `outerHTML` 抓取（`ui/index.html:326-337, 431-437`）；投影方案下交互直接作用于真实 DOM，捕获更干净。

## CDP screencast
Chrome DevTools Protocol 的 `Page.startScreencast`：把页面视口编码为 JPEG 帧流推给客户端。远程浏览器投影（方案 B）的传输机制。

## 常驻 daemon
为预览长期运行的 Node 进程（持有 warm Puppeteer），区别于现有"每次导出 `spawn` 一次 `node html2pdf.js`"的即用即弃模型（`src-tauri/src/lib.rs:234-276`）。

## vh 反馈环（单页导出的固有缺陷）
`page.pdf` 内部渲染时，`vh`/百分比高度**按 PDF 页高解析**（打印布局的 initial containing block = 页框），而不是按设备视口（1680×900）解析。引擎先以视口 900 测量 `scrollHeight`，再把 PDF 高度设为该值——但 PDF 渲染时 `vh` 变成"页高"，内容高度随之变为页高的若干倍（如 `100vh+15vh+60vh=175%`），必然超出单页 → **恒输出 2 页**（实测传高 1575/1655/2000/5000px 均为 2 页）。
- 含义：**"长页面单页导出"对使用 vh 单位的页面失效**。屏幕布局（vh=900）与 PDF 布局（vh=页高）不一致。
- 对投影的影响：B 投影若对准屏幕布局，对 vh 页面仍与 PDF 不一致；需先决策"修引擎"还是"投影对准打印布局"。
- 验证证据：`samples/collapse-test.html`（`100vh+15vh+60vh`）。
