const { app, BrowserWindow, ipcMain, shell, safeStorage, clipboard, nativeImage, ClipboardItem } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { createClient } = require('./modrinth.cjs');
const { createLibrary } = require('./library.cjs');
const { createAccount } = require('./account.cjs');
const { createUpdater } = require('./updater.cjs');
const { autoUpdater } = require('electron-updater');
const { createContent } = require('./content.cjs');
const { createMinecraftAccounts } = require('./minecraft-accounts.cjs');
const {createScreenshots}=require('./screenshots.cjs');
const { createSkins } = require('./skins.cjs');
const { createLauncher } = require('./launcher.cjs');
const page = path.join(__dirname, '../src/index.html');
let window;

app.whenReady().then(() => {
  let launcher;
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
  const screenshots=createScreenshots({library,nativeImage,writeImage:bytes=>clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})])});
  for(const method of ['list','image','copy'])handle('screenshots:'+method,async input=>{await libraryReady;return screenshots[method](input);});
  handle('library:list', async () => { await libraryReady; return library.list(); });
  handle('library:create', async input => { await libraryReady; return library.create(input); });
  handle('library:remove', async id => { await libraryReady; launcher.guard(id); if (id === 'default-vanilla') throw new Error('The latest Vanilla instance is managed automatically.'); return library.remove(id); });
  handle('library:update', async ({id,settings}) => { await libraryReady; launcher.guard(id); return library.update(id,settings); });
  handle('content:plan', async input => { await libraryReady; if(launcher.anyActive())throw new Error('Stop Minecraft before installing content.');return content.plan(input); });
  handle('content:install', input => { if (launcher.anyActive()) throw new Error('Stop Minecraft before installing content.'); return content.install(input); });
  handle('content:list', id => content.read(id));
  handle('content:toggle', input => { launcher.guard(input.instanceId); return content.toggle(input); });
  handle('instance:syncPack', async id=>{launcher.guard(id);return content.syncPack(id);});
  handle('instance:updates',id=>content.checkUpdates(id));
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
    title: "MrHaydenn's Minecraft Launcher", backgroundColor: '#16171b', frame: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const minecraft = createMinecraftAccounts({ directory: app.getPath('userData'), safeStorage, clientId: require('../package.json').microsoftClientId || undefined,
    notify: status => { if (!window.isDestroyed()) window.webContents.send('minecraft:status', status); } });
  const minecraftReady = minecraft.initialize();
  // Preserve initialization errors for the Accounts screen without an unhandled rejection.
  minecraftReady.catch(() => {});
  for (const action of ['state', 'configure', 'poll', 'cancel', 'activate', 'remove', 'refresh']) handle(`minecraft:${action}`, async input => { await minecraftReady; return minecraft[action](input); });
  handle('minecraft:begin', async () => { await minecraftReady; const result=await minecraft.begin(); await clipboard.writeText(result.userCode); return result; });
  const skins=createSkins({directory:path.join(app.getPath('userData'),'skins'),accounts:minecraft});
  for(const method of ['list','save','remove','profile','texture','apply','cape'])handle('skins:'+method,async input=>{await minecraftReady;return skins[method](input);});
  launcher=createLauncher({directory:app.getPath('userData'),library,content,accounts:minecraft,notify:status=>{if(!window.isDestroyed())window.webContents.send('launcher:status',status);}});
  handle('launcher:play',async id=>{await libraryReady;await minecraftReady;return launcher.play(id);});
  handle('launcher:stop',id=>launcher.stop(id));
  handle('launcher:state',()=>launcher.state());
  handle('launcher:logs',id=>launcher.logs(id));
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
  handle('updates:install', () => {if(launcher.anyActive())throw new Error('Stop Minecraft before restarting MML to update.');return updater.install();});
  window.webContents.once('did-finish-load', () => {
    updateReady.then(() => updater.check()).catch(() => {});
  });
  const account = createAccount({directory:app.getPath('userData'),safeStorage});
  handle('account:restore',()=>account.restore());
  handle('account:state',()=>account.current());
  handle('account:connect',input=>account.connect(input));
  handle('account:disconnect',()=>account.disconnect());
  window.loadFile(page);
});
app.on('window-all-closed', () => app.quit());
