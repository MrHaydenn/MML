// Real MMSM + Electron pairing, shared cookie, encryption, restart restore and revoke.
const { app, BrowserWindow, WebContentsView, safeStorage, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { createAccount } = require('../electron/account.cjs');
const { createHosting } = require('../electron/hosting.cjs');

app.whenReady().then(async () => {
  let child, directory, window, view;
  try {
    const source = process.env.MMSM_SOURCE || path.join(__dirname, '../.integrations/MMSM');
    child = spawn(process.env.MML_PYTHON || 'python', [path.join(__dirname, '../tests/fixtures/mmsm_account_fixture.py'), source], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const fixture = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('MMSM fixture did not start')), 20000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`MMSM fixture exited (${code})`)); });
      child.stdout.on('data', chunk => { buffer += chunk; if (buffer.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(buffer.split('\n')[0])); } });
      child.stderr.on('data', () => {});
    });
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-electron-account-'));
    const options = { directory, safeStorage, sessionFor: key => session.fromPartition(key) };
    const account = createAccount(options);
    assert.equal((await account.connect(fixture)).user.username, 'LauncherDemo');
    const encrypted = await fs.readFile(path.join(directory, 'mmsm-connection.bin'));
    assert(!encrypted.toString().includes('mml_access_'));
    window = new BrowserWindow({ show: false, width: 1440, height: 940, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    await window.loadURL('data:text/html,<h1>MML account check</h1>');
    const hosting = createHosting(window, { WebContentsView: function (options) { view = new WebContentsView(options); return view; }, shell: { openExternal: async () => {} } });
    hosting.configure(account.current().instanceUrl, account.partition());
    hosting.setLayout({ visible: true, bounds: { x: 268, y: 280, width: 1136, height: 600 } });
    hosting.show();
    const deadline = Date.now() + 15000;
    while (hosting.status().state !== 'ready' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(hosting.status().state, 'ready');
    const me = await view.webContents.executeJavaScript("fetch('/api/me').then(r=>r.json()).then(data=>({username:data.user?.username,role:data.user?.role}))");
    assert.equal(me.username, 'LauncherDemo');
    assert.equal(await view.webContents.executeJavaScript('typeof window.mml'), 'undefined');
    hosting.reset();
    const restored = createAccount(options);
    assert.equal((await restored.restore()).user.username, 'LauncherDemo');
    const replay = createAccount({ ...options, directory: directory + '-unused' });
    await assert.rejects(replay.connect(fixture), /already used/);
    await restored.disconnect();
    await assert.rejects(account.refresh(), /revoked/);
    assert.equal(account.current().connected, false);
    console.log('Real MMSM + Electron check passed: one-use pairing, shared signed-in account, Windows encryption, restore, revocation, and isolated embedded view.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally {
    if (window && !window.isDestroyed()) window.destroy();
    if (child) { child.stdin.end('\n'); await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(); }, 4000).unref(); }); }
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
