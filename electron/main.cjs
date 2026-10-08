const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { createClient } = require('./modrinth.cjs');
const { createLibrary } = require('./library.cjs');
const { createHosting } = require('./hosting.cjs');
const page = path.join(__dirname, '../src/index.html');
let window;

app.whenReady().then(() => {
  const api = createClient();
  const library = createLibrary(path.join(app.getPath('userData'), 'library'));
  const trusted = event => event.senderFrame?.url === pathToFileURL(page).href;
  const handle = (channel, fn) => ipcMain.handle(channel, (event, value) => {
    if (!trusted(event)) throw new Error('Untrusted request');
    return fn(value);
  });
  for (const method of ['search', 'project', 'versions', 'gameVersions']) handle(`modrinth:${method}`, input => api[method](input));
  handle('library:list', () => library.list());
  handle('library:create', input => library.create(input));
  handle('library:remove', id => library.remove(id));
  handle('library:open', async () => { await fs.mkdir(library.directory, { recursive: true }); const error = await shell.openPath(library.directory); if (error) throw new Error(error); });
  handle('modrinth:open', id => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid project ID');
    return shell.openExternal(`https://modrinth.com/project/${id}`);
  });
  ipcMain.on('window:action', (event, action) => {
    if (!trusted(event)) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1060, minHeight: 720,
    title: "MrHaydenn's Minecraft Launcher", backgroundColor: '#111313', frame: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const hosting = createHosting(window, { WebContentsView, shell });
  handle('hosting:show', () => hosting.show());
  handle('hosting:reload', () => hosting.reload());
  handle('hosting:openExternal', () => hosting.openExternal());
  ipcMain.on('hosting:layout', (event, input) => {
    if (!trusted(event)) return;
    try { hosting.setLayout(input); } catch { /* Ignore malformed layout messages. */ }
  });
  window.loadFile(page);
});
app.on('window-all-closed', () => app.quit());
