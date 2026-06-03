#!/usr/bin/env node
const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { findBrowser, outputName, exportPage, getBrowser, closeBrowser } = require('./html2pdf-lib');

function buildExportOptions(opts) {
  const exportOpts = {
    viewportWidth: opts.viewportWidth,
    scale: opts.scale,
    width: opts.width,
    height: opts.height,
    marginTop: opts.marginTop,
    marginRight: opts.marginRight,
    marginBottom: opts.marginBottom,
    marginLeft: opts.marginLeft,
  };
  // Watermark
  if (opts.watermark) {
    exportOpts.watermark = {
      text: opts.watermark,
      opacity: parseFloat(opts.watermarkOpacity) || 0.08,
      rotation: parseFloat(opts.watermarkRotation) || -30,
      fontSize: parseInt(opts.watermarkSize) || 60,
      fontPath: opts.watermarkFont || undefined,
    };
    if (opts.watermarkColor) {
      const hex = opts.watermarkColor.replace('#', '');
      exportOpts.watermark.color = {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
      };
    }
  }
  // Password
  if (opts.password) {
    exportOpts.password = {
      userPassword: opts.password,
      ownerPassword: opts.ownerPassword || opts.password,
    };
  }
  // Metadata
  if (opts.title || opts.author || opts.subject || opts.keywords) {
    exportOpts.metadata = {};
    if (opts.title) exportOpts.metadata.title = opts.title;
    if (opts.author) exportOpts.metadata.author = opts.author;
    if (opts.subject) exportOpts.metadata.subject = opts.subject;
    if (opts.keywords) exportOpts.metadata.keywords = opts.keywords;
  }
  return exportOpts;
}

async function htmlToPdf(inputs, options) {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error('未找到 Chromium 浏览器。请设置 CHROME_PATH 环境变量指向 Chrome/Edge 可执行文件。');
    process.exit(1);
  }
  console.log(`浏览器: ${browserPath}`);
  console.log(`视口: ${options.viewportWidth || 1280}px, deviceScaleFactor: 2\n`);

  const browser = await getBrowser();
  const exportOpts = buildExportOptions(options);

  try {
    const isBatch = inputs.length > 1 || options.batch;

    if (isBatch) {
      const outDir = path.resolve(options.output || 'pdf-output');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      let ok = 0, fail = 0;
      for (const input of inputs) {
        const outFile = outputName(input, outDir);
        console.log(`导出: ${input}`);
        const result = await exportPage(browser, input, outFile, exportOpts);
        if (result.ok) {
          console.log(`  → ${path.resolve(outFile)}  (${result.width}×${result.height}px)`);
          ok++;
        } else {
          console.error(`  失败: ${result.error}`);
          fail++;
        }
      }
      console.log(`\n完成: ${ok} 成功, ${fail} 失败`);
    } else {
      const input = inputs[0];
      const outFile = options.output || 'output.pdf';
      console.log(`导出: ${input}`);
      const result = await exportPage(browser, input, outFile, exportOpts);
      if (result.ok) {
        console.log(`  → ${path.resolve(outFile)}  (${result.width}×${result.height}px)`);
      } else {
        console.error(`失败: ${result.error}`);
        process.exit(1);
      }
    }
  } finally {
    await closeBrowser();
  }
}

program
  .name('html2pdf')
  .description('将 HTML 文件或 URL 导出为单页矢量 PDF')
  .argument('<inputs...>', 'HTML 文件路径或 URL（多个文件 = 批量模式）')
  .option('-o, --output <path>', '输出路径: 单文件为 PDF 名 (默认 output.pdf), 批量时为输出目录 (默认 pdf-output/)')
  .option('-w, --width <width>', 'PDF 页面宽度 (如 210mm, 800px)')
  .option('-H, --height <height>', 'PDF 页面高度 (如 297mm, 1200px)')
  .option('--margin-top <margin>', '上边距', '0px')
  .option('--margin-right <margin>', '右边距', '0px')
  .option('--margin-bottom <margin>', '下边距', '0px')
  .option('--margin-left <margin>', '左边距', '0px')
  .option('-s, --scale <scale>', '缩放比例', parseFloat, 1)
  .option('--viewport-width <px>', '浏览器视口宽度 (默认 1280)')
  .option('-b, --batch', '强制批量模式: output 作为输出目录')
  .option('--watermark <text>', '水印文字')
  .option('--watermark-opacity <n>', '水印透明度', '0.08')
  .option('--watermark-rotation <deg>', '水印旋转角度', '-30')
  .option('--watermark-color <hex>', '水印颜色 (#rrggbb)', '#808080')
  .option('--watermark-size <n>', '水印字号', '60')
  .option('--watermark-font <path>', '水印字体文件路径 (中文自动检测)')
  .option('--password <pw>', 'PDF 打开密码')
  .option('--owner-password <pw>', 'PDF 所有者密码')
  .option('--title <title>', 'PDF 标题 (元数据)')
  .option('--author <author>', 'PDF 作者 (元数据)')
  .option('--subject <subject>', 'PDF 主题 (元数据)')
  .option('--keywords <kw>', 'PDF 关键词 (元数据)')
  .action(async (inputs, options) => {
    try {
      await htmlToPdf(inputs, options);
    } catch (err) {
      console.error('导出失败:', err.message);
      process.exit(1);
    }
  });

program.parse();
