import { app, BrowserWindow, ipcMain, shell } from 'electron';
import electronUpdater from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
let server;
let mainWindow;
let updateStatus = { state: 'idle', message: 'Обновления не проверялись' };
let runtimeStatus = { state: 'starting', message: 'Проверяем компоненты Windows...', components: [] };

process.env.NODE_ENV = 'production';
process.env.PORT = String(port);
process.env.SCHEDULER_APP_ROOT = appRoot;
process.env.SCHEDULER_DATA_DIR = app.getPath('userData');

async function createWindow() {
  await prepareRuntime();
  const { startServer } = await import('../server/index.js');
  server = startServer();
  await waitForServer(`http://127.0.0.1:${port}/api/health`);
  runtimeStatus = {
    ...runtimeStatus,
    state: 'ready',
    message: 'Все компоненты готовы',
    components: runtimeStatus.components.map((item) => item.id === 'server' ? { ...item, ok: true, value: `127.0.0.1:${port}` } : item)
  };

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: 'Аманат Расписание - разработка школьного расписания',
    icon: path.join(appRoot, 'build', 'icon.png'),
    backgroundColor: '#11131d',
    webPreferences: {
      preload: path.join(appRoot, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  sendRuntimeStatus();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${port}`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function prepareRuntime() {
  const userData = app.getPath('userData');
  const requiredDirs = ['data', 'exports', 'logs', 'updates'].map((name) => path.join(userData, name));
  for (const dir of requiredDirs) fs.mkdirSync(dir, { recursive: true });

  runtimeStatus = {
    state: 'ready',
    message: 'Компоненты установлены внутри приложения',
    dataPath: userData,
    components: [
      { id: 'electron', name: 'Desktop-оболочка Electron', ok: true, value: process.versions.electron },
      { id: 'node', name: 'Встроенный Node.js', ok: true, value: process.versions.node },
      { id: 'chrome', name: 'Встроенный Chromium', ok: true, value: process.versions.chrome },
      { id: 'frontend', name: 'Фронт приложения', ok: fs.existsSync(path.join(appRoot, 'dist', 'index.html')), value: 'dist/index.html' },
      { id: 'server', name: 'Локальный сервер и база SQLite', ok: false, value: 'запускается' },
      { id: 'storage', name: 'Папка данных Windows', ok: requiredDirs.every((dir) => fs.existsSync(dir)), value: userData }
    ]
  };
}

function sendUpdateStatus(status) {
  updateStatus = { ...updateStatus, ...status };
  mainWindow?.webContents.send('update:status', updateStatus);
}

function sendRuntimeStatus() {
  mainWindow?.webContents.send('runtime:status', runtimeStatus);
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking', message: 'Проверяем обновления...' }));
autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', message: `Доступна версия ${info.version}`, info }));
autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'none', message: 'Новых обновлений нет' }));
autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus({ state: 'downloading', message: `Скачивание ${Math.round(progress.percent)}%`, progress });
});
autoUpdater.on('update-downloaded', (info) => {
  sendUpdateStatus({ state: 'downloaded', message: `Обновление ${info.version} скачано. Перезапустите приложение.`, info });
});
autoUpdater.on('error', (error) => {
  sendUpdateStatus({ state: 'error', message: error.message || 'Ошибка обновления' });
});

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) {
    sendUpdateStatus({ state: 'dev', message: 'Проверка обновлений работает в установленной версии' });
    return updateStatus;
  }
  await autoUpdater.checkForUpdates();
  return updateStatus;
});

ipcMain.handle('update:download', async () => {
  if (!app.isPackaged) return updateStatus;
  await autoUpdater.downloadUpdate();
  return updateStatus;
});

ipcMain.handle('update:install', () => {
  if (app.isPackaged) autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('update:status', () => updateStatus);
ipcMain.handle('runtime:status', () => runtimeStatus);

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Desktop server did not start in 15 seconds');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  server?.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  server?.close();
});
