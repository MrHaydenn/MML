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
  platform: 'windows'
});
