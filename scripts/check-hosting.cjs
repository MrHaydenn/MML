// Integration check: real Electron view, real MMSM load, no user interaction.
const { app, BrowserWindow, WebContentsView } = require('electron');
const assert = require('node:assert/strict');
const { createHosting, isHostUrl } = require('../electron/hosting.cjs');

app.whenReady().then(async () => {
  let window, hosting, view;
  try {
    window = new BrowserWindow({ show: false, width: 1440, height: 940, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await window.loadURL('data:text/html,<h1>MML hosting integration check</h1>');
    hosting = createHosting(window, { WebContentsView: function (options) { view = new WebContentsView(options); return view; }, shell: { openExternal: async () => {} } });
    hosting.setLayout({ visible: true, bounds: { x: 268, y: 280, width: 1136, height: 600 } });
    hosting.show();
    const deadline = Date.now() + 35000;
    while (['idle', 'loading'].includes(hosting.status().state) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(hosting.status().state, 'ready', hosting.status().message || 'MMSM did not load');
    assert(isHostUrl(view.webContents.getURL()));
    assert.equal(await view.webContents.executeJavaScript('typeof window.mml'), 'undefined');
    assert.equal(await view.webContents.executeJavaScript('typeof require'), 'undefined');
    assert.equal(view.getVisible(), true);
    hosting.setLayout({ visible: false }); assert.equal(view.getVisible(), false);
    console.log(`Hosting integration passed: ${view.webContents.getTitle()}; bridge isolated; tab hiding works.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { if (window) window.destroy(); app.exit(process.exitCode || 0); }
});
