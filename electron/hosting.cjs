const HOST_URL = 'https://mmsm.mrhaydenn.us/';

function isHostUrl(value) {
  try { return new URL(value).origin === new URL(HOST_URL).origin; }
  catch { return false; }
}

function createHosting(window, { WebContentsView, shell }) {
  let view;
  let layout = { visible: false };
  let status = { state: 'idle' };
  let timeout;
  const notify = next => {
    status = next;
    if (!window.isDestroyed()) window.webContents.send('hosting:status', status);
    display();
  };
  function display() {
    if (!view || window.isDestroyed()) return;
    view.setVisible(Boolean(layout.visible && status.state === 'ready'));
    if (!layout.bounds) return;
    const [width, height] = window.getContentSize();
    const x = Math.max(205, Math.min(width, Math.round(layout.bounds.x)));
    const y = Math.max(110, Math.min(height, Math.round(layout.bounds.y)));
    view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(layout.bounds.width))), height: Math.max(0, Math.min(height - y, Math.round(layout.bounds.height))) });
  }
  const external = value => {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' || url.protocol === 'http:') shell.openExternal(url.href).catch(() => {});
    } catch {}
  };
  function ensureView() {
    if (view) return;
    // A top-level browser view supports sites that disallow iframes, without
    // changing their response headers or granting access to the launcher bridge.
    view = new WebContentsView({ webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: 'persist:mml-hosting'
    } });
    view.setBackgroundColor('#111313');
    view.setVisible(false);
    window.contentView.addChildView(view);
    view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    view.webContents.session.setPermissionCheckHandler(() => false);
    view.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    for (const event of ['will-navigate', 'will-redirect']) view.webContents.on(event, (event, url) => {
      if (!isHostUrl(url)) { event.preventDefault(); external(url); }
    });
    view.webContents.on('did-start-loading', () => {
      clearTimeout(timeout);
      notify({ state: 'loading' });
      timeout = setTimeout(() => {
        view.webContents.stop();
        notify({ state: 'error', message: 'MMSM is taking too long to respond. Try again or open it in your browser.' });
      }, 30000);
    });
    view.webContents.on('did-finish-load', () => {
      clearTimeout(timeout);
      if (status.state !== 'error') notify({ state: 'ready' });
    });
    view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      clearTimeout(timeout);
      notify({ state: 'error', message: 'MMSM could not be loaded. Check your connection, try again, or open it in your browser.' });
    });
    view.webContents.on('render-process-gone', () => { clearTimeout(timeout); notify({ state: 'error', message: 'The hosting page closed unexpectedly. Reload it to continue.' }); });
  }
  function load() {
    ensureView();
    view.webContents.loadURL(HOST_URL).catch(() => {}); // did-fail-load supplies the user-facing error.
  }
  window.on('resize', display);
  window.on('closed', () => {
    clearTimeout(timeout);
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
  });
  return {
    status: () => status,
    show: () => { if (status.state === 'idle') load(); return status; },
    reload: () => { load(); return status; },
    openExternal: () => shell.openExternal(HOST_URL),
    setLayout: input => {
      const bounds = input?.bounds;
      if (input?.visible && (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])))) throw new Error('Invalid hosting layout');
      layout = { visible: Boolean(input?.visible), bounds };
      display();
    }
  };
}

module.exports = { HOST_URL, isHostUrl, createHosting };
