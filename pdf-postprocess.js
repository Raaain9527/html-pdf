const fs = require('fs');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib-plus-encrypt');
const fontkit = require('@pdf-lib/fontkit');

// Common Chinese font paths per platform
function getDefaultCJKFont() {
  const paths = {
    win32: ['C:\\Windows\\Fonts\\simhei.ttf', 'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf'],
    darwin: ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc'],
    linux: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf'],
  };
  for (const p of (paths[process.platform] || [])) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Post-process a PDF: watermark, password, metadata.
 * All steps are optional — only applied when options are provided.
 */
async function postProcess(inputPath, outputPath, options = {}) {
  const pdfBytes = fs.readFileSync(inputPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);

  if (options.watermark) {
    await applyWatermark(pdfDoc, options.watermark);
  }

  if (options.metadata) {
    applyMetadata(pdfDoc, options.metadata);
  }

  if (options.password) {
    applyPassword(pdfDoc, options.password);
  }

  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outBytes);
}

async function applyWatermark(pdfDoc, opts) {
  const {
    text,
    opacity = 0.08,
    fontSize = 60,
    rotation = -30,
    color = { r: 0.5, g: 0.5, b: 0.5 },
    gapX = 280,
    gapY = 280,
  } = opts;

  // Detect if text contains non-Latin chars; if so, embed a CJK font
  const hasCJK = /[一-鿿぀-ゟ゠-ヿ가-힯]/.test(text);
  let font;
  if (hasCJK) {
    const fontPath = opts.fontPath || getDefaultCJKFont();
    if (!fontPath) throw new Error('水印包含中文但找不到中文字体。请通过 fontPath 选项指定字体文件路径。');
    const fontBytes = fs.readFileSync(fontPath);
    font = await pdfDoc.embedFont(fontBytes);
  } else {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    for (let y = -gapY; y < height + gapY; y += gapY) {
      for (let x = -gapX; x < width + textWidth + gapX; x += gapX) {
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font,
          opacity,
          color: rgb(color.r, color.g, color.b),
          rotate: degrees(rotation),
        });
      }
    }
  }
}

function applyMetadata(pdfDoc, meta) {
  if (meta.title) pdfDoc.setTitle(meta.title);
  if (meta.author) pdfDoc.setAuthor(meta.author);
  if (meta.subject) pdfDoc.setSubject(meta.subject);
  if (meta.keywords) pdfDoc.setKeywords(meta.keywords);
  if (meta.creator) pdfDoc.setCreator(meta.creator);
}

function applyPassword(pdfDoc, opts) {
  pdfDoc.encrypt({
    userPassword: opts.userPassword || '',
    ownerPassword: opts.ownerPassword || opts.userPassword || 'owner',
    permissions: {
      printing: opts.allowPrinting !== false ? 'highResolution' : 'none',
      modifying: opts.allowModifying !== false,
      copying: opts.allowCopying !== false,
      annotating: opts.allowAnnotating !== false,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: false,
    },
  });
}

module.exports = { postProcess };
