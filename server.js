const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exportPage, getBrowser, closeBrowser } = require('./html2pdf-lib');

const app = express();
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'ui')));

function parseOptions(body) {
  const opts = {
    viewportWidth: parseInt(body.viewportWidth) || 1280,
    scale: parseFloat(body.scale) || 1,
    width: body.width || null,
    height: body.height || null,
    marginTop: body.marginTop || '0px',
    marginRight: body.marginRight || '0px',
    marginBottom: body.marginBottom || '0px',
    marginLeft: body.marginLeft || '0px',
  };
  if (body.watermarkText) {
    opts.watermark = {
      text: body.watermarkText,
      opacity: parseFloat(body.watermarkOpacity) || 0.08,
      rotation: parseFloat(body.watermarkRotation) || -30,
      fontSize: parseInt(body.watermarkSize) || 60,
    };
    if (body.watermarkColor) {
      const hex = body.watermarkColor.replace('#', '');
      opts.watermark.color = {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
      };
    }
  }
  if (body.password) {
    opts.password = {
      userPassword: body.password,
      ownerPassword: body.ownerPassword || body.password,
    };
  }
  if (body.metaTitle || body.metaAuthor || body.metaSubject || body.metaKeywords) {
    opts.metadata = {};
    if (body.metaTitle) opts.metadata.title = body.metaTitle;
    if (body.metaAuthor) opts.metadata.author = body.metaAuthor;
    if (body.metaSubject) opts.metadata.subject = body.metaSubject;
    if (body.metaKeywords) opts.metadata.keywords = body.metaKeywords;
  }
  return opts;
}

app.post('/api/export/file', upload.single('html'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;
    const outputPath = filePath + '.pdf';

    const result = await exportPage(null, filePath, outputPath, parseOptions(req.body));
    if (!result.ok) throw new Error(result.error);

    const downloadName = `${path.parse(req.file.originalname).name}.pdf`;
    res.download(outputPath, downloadName, () => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      try { fs.unlinkSync(outputPath); } catch (_) {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/export/url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const outputPath = path.join(__dirname, 'uploads', `url-${Date.now()}.pdf`);
    const result = await exportPage(null, url, outputPath, parseOptions(req.body));
    if (!result.ok) throw new Error(result.error);

    const urlObj = new URL(url);
    res.download(outputPath, `${urlObj.hostname}.pdf`, () => {
      try { fs.unlinkSync(outputPath); } catch (_) {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => { await closeBrowser(); process.exit(); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(); });

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`HTML→PDF Web UI: http://localhost:${PORT}`);
});
