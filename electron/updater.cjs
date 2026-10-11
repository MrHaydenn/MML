const fs = require('node:fs/promises');
const path = require('node:path');

const feeds = {
  stable: 'https://github.com/MrHaydenn/MML/releases/latest/download',
  experimental: 'https://github.com/MrHaydenn/MML/releases/download/experimental'
};

function createUpdater({ engine, directory, version, packaged, notify = () => {} }) {
  const file = path.join(directory, 'updates.json');
  let state = { channel: 'stable', current: version, status: packaged ? 'idle' : 'development', message: packaged ? 'Updates are checked automatically on startup.' : 'Updates are available in the installed Windows application.', progress: 0 };
  let busy = false;
  const snapshot = () => ({ ...state });
  const update = values => { state = { ...state, ...values }; notify(snapshot()); };
  function configure() {
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = false;
    engine.disableWebInstaller = true;
    engine.allowPrerelease = state.channel === 'experimental';
    engine.channel = state.channel === 'stable' ? 'latest' : 'experimental';
    // Returning to Stable deliberately permits replacing a newer experimental build.
    engine.allowDowngrade = state.channel === 'stable' && version.includes('-');
    engine.setFeedURL({ provider: 'generic', url: feeds[state.channel], channel: engine.channel });
  }
  engine.on('checking-for-update', () => update({ status: 'checking', message: 'Checking GitHub…', progress: 0 }));
  engine.on('update-available', info => update({ status: 'available', latest: info.version, message: `MML ${info.version} is available.` }));
  engine.on('update-not-available', () => update({ status: 'current', latest: null, message: 'You are up to date on this channel.' }));
  engine.on('download-progress', info => update({ status: 'downloading', progress: Math.max(0, Math.min(100, info.percent)), message: 'Downloading and verifying the update…' }));
  engine.on('update-downloaded', info => update({ status: 'ready', latest: info.version, progress: 100, message: 'Update verified. Restart MML to install it.' }));
  const failed = () => update({ status: 'error', message: 'The update could not be completed. Check your connection and try again. Your current installation is unchanged.' });
  engine.on('error', failed);
  async function run(action) {
    if (!packaged) return snapshot();
    if (busy) throw new Error('An update operation is already running.');
    busy = true;
    try { await action(); return snapshot(); }
    catch { failed(); return snapshot(); }
    finally { busy = false; }
  }
  return {
    state: snapshot,
    async initialize() {
      try { const saved = JSON.parse(await fs.readFile(file, 'utf8')); if (saved.channel === 'experimental') state.channel = 'experimental'; } catch (error) { if (error.code !== 'ENOENT') update({ message: 'Update preferences could not be read; using Stable.' }); }
      configure(); return snapshot();
    },
    async channel(value) {
      if (!['stable', 'experimental'].includes(value)) throw new Error('Invalid update channel.');
      if (busy || state.status === 'ready') throw new Error('Finish the current update before switching channels.');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(file + '.tmp', JSON.stringify({ channel: value }));
      await fs.rename(file + '.tmp', file);
      update({ channel: value, status: packaged ? 'idle' : 'development', latest: null, progress: 0, message: value === 'stable' ? 'Stable uses published GitHub releases only.' : 'Experimental uses the latest successfully built push to main.' });
      configure(); return snapshot();
    },
    check: () => run(async () => { if (state.status === 'ready') return; await engine.checkForUpdates(); }),
    download: () => run(async () => {
      if (state.status !== 'available') throw new Error('Check for an update first.');
      update({ status: 'downloading', progress: 0, message: 'Starting download…' });
      await engine.downloadUpdate();
    }),
    install() {
      if (!packaged || busy || state.status !== 'ready') throw new Error('Download and verify an update first.');
      engine.quitAndInstall(false, true);
    }
  };
}
module.exports = { createUpdater, feeds };
