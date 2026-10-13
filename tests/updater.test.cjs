const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createUpdater, feeds } = require('../electron/updater.cjs');

async function fixture(t, version = '0.3.0', packaged = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-updater-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const engine = new EventEmitter();
  engine.setFeedURL = value => { engine.feed = value; };
  engine.checkForUpdates = async () => { engine.emit('checking-for-update'); engine.emit('update-available', { version: '0.4.0' }); };
  engine.downloadUpdate = async () => { engine.emit('download-progress', { percent: 50 }); engine.emit('update-downloaded', { version: '0.4.0' }); };
  engine.quitAndInstall = (...args) => { engine.installed = args; };
  const updater = createUpdater({ engine, directory, version, packaged });
  await updater.initialize();
  return { engine, updater, directory };
}
test('stable is default, downloads require a check and install requires a verified download', async t => {
  const { engine, updater } = await fixture(t);
  assert.equal(engine.feed.url, feeds.stable);
  assert.equal(engine.allowPrerelease, false);
  assert.equal(engine.autoDownload, true);
  assert.equal(engine.autoInstallOnAppQuit, true);
  assert.throws(() => updater.install(), /Download/);
  assert.equal((await updater.check()).status, 'available');
  assert.throws(() => updater.install(), /Download/);
  assert.equal((await updater.download()).status, 'ready');
  await assert.rejects(updater.channel('experimental'), /Finish/);
  updater.install();
  assert.deepEqual(engine.installed, [true, true]);
});
test('experimental selection persists and returning to stable permits leaving a prerelease', async t => {
  const { engine, updater, directory } = await fixture(t, '0.3.1-experimental.10');
  await updater.channel('experimental');
  assert.equal(engine.feed.url, feeds.experimental);
  assert.equal(engine.channel, 'experimental');
  assert.equal(engine.allowPrerelease, true);
  assert.equal(engine.allowDowngrade, false);
  const restored = createUpdater({ engine, directory, version: '0.3.1-experimental.10', packaged: true });
  assert.equal((await restored.initialize()).channel, 'experimental');
  await restored.channel('stable');
  assert.equal(engine.feed.url, feeds.stable);
  assert.equal(engine.allowPrerelease, false);
  assert.equal(engine.allowDowngrade, true);
  await assert.rejects(restored.channel('other'), /Invalid/);
});
test('network failure preserves the installation and concurrent channel changes are blocked', async t => {
  const { engine, updater } = await fixture(t);
  let reject;
  engine.checkForUpdates = () => new Promise((_resolve, fail) => { reject = fail; });
  const pending = updater.check();
  await assert.rejects(updater.channel('experimental'), /Finish/);
  reject(new Error('offline'));
  assert.equal((await pending).status, 'error');
  assert.equal(engine.installed, undefined);
  await updater.channel('experimental');
  assert.equal(updater.state().channel, 'experimental');
});
test('development runs cannot download or install updates', async t => {
  const { engine, updater } = await fixture(t, '0.3.0', false);
  engine.checkForUpdates = () => { throw new Error('must not run'); };
  assert.equal((await updater.check()).status, 'development');
  assert.equal((await updater.download()).status, 'development');
  assert.throws(() => updater.install(), /Download/);
});
