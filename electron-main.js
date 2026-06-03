const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exportPage, getBrowser, closeBrowser } = require('./html2pdf-lib');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 780,
    resizable: true,
    title: 'HTML → PDF',
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: undefined,
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

const menuTemplate = [
  {
    label: '文件',
    submenu: [
      { label: '打开 HTML 文件...', accelerator: 'CmdOrCtrl+O', click: () => handleOpenFile() },
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ],
  },
  {
    label: '帮助',
    submenu: [
      { label: '关于', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'HTML → PDF', message: 'HTML → PDF v1.0\n长页面单页导出 · 矢量文字可选中', detail: '基于 Chromium + pdf-lib' }) },
    ],
  },
];

async function handleOpenFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 HTML 文件',
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow.webContents.send('file-selected', result.filePaths[0]);
  }
}

async function handleExportFile(event, inputPath, options) {
  try {
    const result2 = await dialog.showSaveDialog(mainWindow, {
      title: '保存 PDF',
      defaultPath: path.basename(inputPath).replace(/\.html?$/i, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result2.canceled) return { cancel: true };

    // Determine input: file path or URL
    let input = inputPath;
    if (!/^https?:\/\//i.test(input) && !fs.existsSync(input)) {
      return { ok: false, error: '文件不存在' };
    }

    const result3 = await exportPage(null, input, result2.filePath, options);
    if (result3.ok) {
      shell.showItemInFolder(result2.filePath);
    }
    return result3;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleExportUrl(event, url, options) {
  try {
    const urlObj = new URL(url);
    const result2 = await dialog.showSaveDialog(mainWindow, {
      title: '保存 PDF',
      defaultPath: urlObj.hostname + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result2.canceled) return { cancel: true };

    const result3 = await exportPage(null, url, result2.filePath, options);
    if (result3.ok) {
      shell.showItemInFolder(result2.filePath);
    }
    return result3;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createWindow();

  ipcMain.handle('open-file', handleOpenFile);
  ipcMain.handle('export-file', handleExportFile);
  ipcMain.handle('export-url', handleExportUrl);

  // Drag & drop from OS
  ipcMain.handle('get-dropped-file', (event) => {
    // The file path is sent via IPC from preload/renderer
    return true;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await closeBrowser();
  app.quit();
});

app.on('before-quit', async () => {
  await closeBrowser();
});
