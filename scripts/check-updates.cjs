// Exercise the real Windows updater against both published GitHub feeds.
// Only downloads into a temporary directory; never runs an installer.
const { app } = require('electron');
const { NsisUpdater } = require('electron-updater');
const { createUpdater } = require('../electron/updater.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-live-updater-'));
  let code = 0;
  try {
    for (const channel of ['stable', 'experimental']) {
      const engine = new NsisUpdater();
      engine.logger = { info() {}, warn() {}, error() {}, debug() {} };
      engine.forceDevUpdateConfig = true;
      Object.defineProperty(engine.app, 'baseCachePath', { value: directory });
      Object.defineProperty(engine.app, 'userDataPath', { value: directory });
      engine.currentVersion = new engine.currentVersion.constructor('0.0.0');
      const config = path.join(directory, channel + '-config.yml');
      await fs.writeFile(config, JSON.stringify({ updaterCacheDirName: channel }));
      engine.updateConfigPath = config;
      const updater = createUpdater({ engine, directory: path.join(directory, channel + '-prefs'), version: '0.0.0', packaged: true });
      await updater.initialize();
      await updater.channel(channel);
      const found = await updater.check();
      assert.equal(found.status, 'available', JSON.stringify(found));
      assert.equal(found.latest.includes('-experimental.'), channel === 'experimental');
      const downloaded = await updater.download();
      assert.equal(downloaded.status, 'ready', JSON.stringify(downloaded));
      assert((await fs.stat(engine.installerPath)).size > 1000000);
      console.log(`Verified real GitHub ${channel} feed, installer download and SHA-512: ${found.latest}`);
    }
  } catch (error) { console.error(error.message); code = 1; }
  finally { await fs.rm(directory, { recursive: true, force: true }); app.exit(code); }
});
