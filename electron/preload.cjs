const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mml', {
  search: input => ipcRenderer.invoke('modrinth:search', input),
  project: id => ipcRenderer.invoke('modrinth:project', id),
  versions: id => ipcRenderer.invoke('modrinth:versions', id),
  gameVersions: () => ipcRenderer.invoke('modrinth:gameVersions'),
  library: () => ipcRenderer.invoke('library:list'),
  createProfile: input => ipcRenderer.invoke('library:create', input),
  removeProfile: id => ipcRenderer.invoke('library:remove', id),
  openLibrary: () => ipcRenderer.invoke('library:open'),
  openProject: id => ipcRenderer.invoke('modrinth:open', id),
  openProjectLink: url => ipcRenderer.invoke('project:link', url),
  planInstall: input => ipcRenderer.invoke('content:plan', input),
  installContent: input => ipcRenderer.invoke('content:install', input),
  installedContent: id => ipcRenderer.invoke('content:list', id),
  openInstance: id => ipcRenderer.invoke('content:open', id),
  onContentStatus: callback => { const listener = (_event, status) => callback(status); ipcRenderer.on('content:status', listener); return () => ipcRenderer.removeListener('content:status', listener); },
  minecraftState: () => ipcRenderer.invoke('minecraft:state'),
  configureMinecraft: id => ipcRenderer.invoke('minecraft:configure', id),
  beginMinecraft: () => ipcRenderer.invoke('minecraft:begin'),
  pollMinecraft: () => ipcRenderer.invoke('minecraft:poll'),
  cancelMinecraft: () => ipcRenderer.invoke('minecraft:cancel'),
  activateMinecraft: id => ipcRenderer.invoke('minecraft:activate', id),
  removeMinecraft: id => ipcRenderer.invoke('minecraft:remove', id),
  refreshMinecraft: id => ipcRenderer.invoke('minecraft:refresh', id),
  openMinecraftLogin: () => ipcRenderer.invoke('minecraft:openLogin'),
  onMinecraftStatus: callback => { const listener = (_event, status) => callback(status); ipcRenderer.on('minecraft:status', listener); return () => ipcRenderer.removeListener('minecraft:status', listener); },
  restoreAccount: () => ipcRenderer.invoke('account:restore'),
  accountState: () => ipcRenderer.invoke('account:state'),
  connectAccount: input => ipcRenderer.invoke('account:connect', input),
  disconnectAccount: () => ipcRenderer.invoke('account:disconnect'),
  showHosting: () => ipcRenderer.invoke('hosting:show'),
  reloadHosting: () => ipcRenderer.invoke('hosting:reload'),
  openHosting: () => ipcRenderer.invoke('hosting:openExternal'),
  setHostingLayout: layout => ipcRenderer.send('hosting:layout', layout),
  onHostingStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('hosting:status', listener);
    return () => ipcRenderer.removeListener('hosting:status', listener);
  },
  windowAction: action => ipcRenderer.send('window:action', action),
  updateState: () => ipcRenderer.invoke('updates:state'),
  updateChannel: value => ipcRenderer.invoke('updates:channel', value),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
  platform: 'windows'
});
