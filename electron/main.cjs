const { app, BrowserWindow, WebContentsView, ipcMain, shell, safeStorage, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { createClient } = require('./modrinth.cjs');
const { createLibrary } = require('./library.cjs');
const { createHosting } = require('./hosting.cjs');
const { createAccount } = require('./account.cjs');
const { createUpdater } = require('./updater.cjs');
const { autoUpdater } = require('electron-updater');
const { createContent } = require('./content.cjs');
const { createMinecraftAccounts } = require('./minecraft-accounts.cjs');
const page = path.join(__dirname, '../src/index.html');
let window;

app.whenReady().then(() => {
  const api = createClient();
  const library = createLibrary(path.join(app.getPath('userData'), 'library'));
  const content = createContent({ directory: path.join(library.directory, 'instances'), library, api,
    notify: status => { if (window && !window.isDestroyed()) window.webContents.send('content:status', status); } });
  const libraryReady = (async () => {
    for (const profile of await library.list()) await content.recover(profile.id);
    try {
      const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Minecraft version service unavailable');
      await library.ensureDefault((await response.json()).latest.release);
    } catch { /* Keep the existing default version offline; retry at next startup. */ }
  })();
  libraryReady.catch(() => {});
  const trusted = event => event.senderFrame?.url === pathToFileURL(page).href;
  const handle = (channel, fn) => ipcMain.handle(channel, (event, value) => {
    if (!trusted(event)) throw new Error('Untrusted request');
    return fn(value);
  });
  for (const method of ['search', 'project', 'versions', 'gameVersions']) handle(`modrinth:${method}`, input => api[method](input));
  handle('library:list', async () => { await libraryReady; return library.list(); });
  handle('library:create', async input => { await libraryReady; return library.create(input); });
  handle('library:remove', async id => { await libraryReady; if (id === 'default-vanilla') throw new Error('The latest Vanilla instance is managed automatically.'); return library.remove(id); });
  handle('content:plan', async input => { await libraryReady; return content.plan(input); });
  handle('content:install', input => content.install(input));
  handle('content:list', id => content.read(id));
  handle('content:open', async id => {
    if (!(await library.list()).some(p => p.id === id)) throw new Error('Instance not found.');
    const folder = path.join(content.instancePath(id), 'game'); await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder); if (error) throw new Error(error);
  });
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
  const minecraft = createMinecraftAccounts({ directory: app.getPath('userData'), safeStorage, clientId: require('../package.json').microsoftClientId || undefined });
  const minecraftReady = minecraft.initialize();
  // Preserve initialization errors for the Accounts screen without an unhandled rejection.
  minecraftReady.catch(() => {});
  for (const action of ['state', 'configure', 'begin', 'poll', 'cancel', 'activate', 'remove', 'refresh']) handle(`minecraft:${action}`, async input => { await minecraftReady; return minecraft[action](input); });
  handle('minecraft:openLogin', () => shell.openExternal('https://www.microsoft.com/link'));
  handle('project:link', value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS project links can be opened.');
    return shell.openExternal(url.href);
  });
  const updater = createUpdater({ engine: autoUpdater, directory: app.getPath('userData'), version: app.getVersion(), packaged: app.isPackaged,
    notify: status => { if (!window.isDestroyed()) window.webContents.send('updates:status', status); } });
  const updateReady = updater.initialize();
  handle('updates:state', async () => { await updateReady; return updater.state(); });
  handle('updates:channel', async value => { await updateReady; return updater.channel(value); });
  handle('updates:check', async () => { await updateReady; return updater.check(); });
  handle('updates:download', () => updater.download());
  handle('updates:install', () => updater.install());
  window.webContents.once('did-finish-load', () => {
    updateReady.then(() => updater.check()).catch(() => {});
  });
  const hosting = createHosting(window, { WebContentsView, shell });
  const account = createAccount({ directory: app.getPath('userData'), safeStorage, sessionFor: partition => session.fromPartition(partition) });
  const configureHosting = () => {
    const current = account.current();
    if (current.connected && current.instanceUrl) hosting.configure(current.instanceUrl, account.partition());
    else hosting.reset();
    return current;
  };
  handle('account:restore', async () => { await account.restore(); return configureHosting(); });
  handle('account:state', () => account.current());
  handle('account:connect', async input => { await account.connect(input); return configureHosting(); });
  handle('account:disconnect', async () => { hosting.reset(); await account.disconnect(); return configureHosting(); });
  const showHosting = async () => {
    if (!account.current().instanceUrl) return { state: 'disconnected' };
    hosting.reset();
    try { await account.refresh(); }
    finally { configureHosting(); }
    return hosting.show();
  };
  handle('hosting:show', showHosting);
  handle('hosting:reload', showHosting);
  handle('hosting:openExternal', () => hosting.openExternal());
  ipcMain.on('hosting:layout', (event, input) => {
    if (!trusted(event)) return;
    try { hosting.setLayout(input); } catch { /* Ignore malformed layout messages. */ }
  });
  window.loadFile(page);
});
app.on('window-all-closed', () => app.quit());
