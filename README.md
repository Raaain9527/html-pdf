# HTML → PDF

长页面单页导出为矢量 PDF，文字可选中复制。

## 特性

- **长页面自适应单页** — 自动计算内容高度，不分页截断
- **矢量文字可选中** — Skia/PDF 引擎渲染，中英文可搜索复制
- **高清渲染** — 2x deviceScaleFactor，文字锐利
- **批量导出** — 一次输入多个文件/URL，复用浏览器实例
- **中文水印** — 平铺水印，自动嵌入系统 CJK 字体
- **密码保护** — 输出 PDF 可设置打开密码
- **元数据** — 自定义 PDF 标题/作者/主题/关键词

## 安装

```bash
git clone https://github.com/YOUR_USER/html-pdf.git
cd html-pdf
npm install
```

需要系统已安装 Chrome / Edge / Chromium 浏览器。

## 使用

### CLI

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

# 更多选项
node html2pdf.js --help
```

### Web UI

```bash
npm run ui
# 打开 http://localhost:3456
```

支持拖拽 HTML 文件、粘贴 URL、可调视口宽度/缩放/水印/密码。

## 技术栈

- **Puppeteer** — Chromium 无头浏览器渲染
- **pdf-lib-plus-encrypt** — PDF 后处理（水印/加密/元数据）
- **Express** — Web 服务
- **Commander** — CLI 参数解析

## License

MIT
