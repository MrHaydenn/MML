const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function instanceUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('Enter the public URL of your MMSM instance.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Use an HTTPS MMSM URL without a path or credentials. Localhost may use HTTP.');
  return url.origin;
}
const partitionFor = origin => 'persist:mml-instance-' + createHash('sha256').update(origin).digest('hex').slice(0, 24);

function createAccount({ directory, safeStorage, sessionFor, fetcher = fetch }) {
  const file = path.join(directory, 'mmsm-connection.bin');
  let connection = null;
  let busy = false;
  const publicState = () => connection ? { connected: true, instanceUrl: connection.instanceUrl, user: connection.user, expires: connection.expires } : { connected: false };
  async function request(origin, route, { token, accessToken } = {}) {
    let response;
    try {
      response = await fetcher(origin + '/api/launcher/' + route, { method: route === 'info' ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Accept: 'application/json', Origin: origin, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        ...(route !== 'info' ? { body: JSON.stringify(token ? { token } : {}) } : {}) });
    } catch { throw new Error('Could not reach MMSM. Check its public URL and your connection.'); }
    if (response.status === 404) throw new Error('This MMSM instance needs the launcher integration update. Update MMSM, then try again.');
    if (response.status === 401) { const error = new Error('The connection token has expired, was already used, or was revoked. Generate a new token in MMSM.'); error.status = 401; throw error; }
    if (response.status === 429) throw new Error('Too many connection attempts. Wait a minute and try again.');
    if (!response.ok) throw new Error(`MMSM could not complete the connection (${response.status}).`);
    const text = await response.text();
    if (text.length > 65536) throw new Error('MMSM returned an invalid response.');
    let data; try { data = JSON.parse(text); } catch { throw new Error('This URL did not return an MMSM connection response.'); }
    return { data, cookie: response.headers.get('set-cookie') };
  }
  async function save() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Please restart MML and try again.');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file + '.tmp', safeStorage.encryptString(JSON.stringify(connection)));
    await fs.rename(file + '.tmp', file);
  }
  async function installCookie(origin, raw) {
    const name = origin.startsWith('https:') ? 'mmsm_session' : 'mmsm_session_http';
    const match = new RegExp(`^${name}=([A-Za-z0-9_-]{43});`).exec(raw || '');
    if (!match) throw new Error('MMSM did not return a valid browser session.');
    await sessionFor(partitionFor(origin)).cookies.set({ url: origin + '/', name, value: match[1], path: '/', httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'strict', expirationDate: Date.now() / 1000 + 86400 });
  }
  function validate(data) {
    if (!data.user || typeof data.user.id !== 'string' || typeof data.user.username !== 'string' || !['owner', 'admin', 'operator', 'viewer'].includes(data.user.role) || !Number.isFinite(data.expires) || data.expires <= Date.now() / 1000 || typeof data.instance_id !== 'string') throw new Error('MMSM returned an invalid account response.');
    return { id: data.user.id, username: data.user.username, role: data.user.role };
  }
  async function clear() {
    const previous = connection; connection = null;
    await fs.rm(file, { force: true });
    if (previous) await sessionFor(partitionFor(previous.instanceUrl)).clearStorageData();
  }
  async function refresh() {
    if (!connection) return publicState();
    const current = connection;
    try {
      const { data, cookie } = await request(current.instanceUrl, 'session', { accessToken: current.accessToken });
      const user = validate(data);
      if (data.instance_id !== current.instanceId || user.id !== current.user.id) throw new Error('The MMSM instance identity changed. Disconnect and connect it again.');
      await installCookie(current.instanceUrl, cookie);
      connection = { ...current, user, expires: data.expires }; await save();
      return publicState();
    } catch (error) { if (error.status === 401) await clear(); throw error; }
  }
  async function exclusive(action) {
    if (busy) throw new Error('A connection request is already running.');
    busy = true; try { return await action(); } finally { busy = false; }
  }
  return {
    current: publicState,
    partition: () => connection ? partitionFor(connection.instanceUrl) : null,
    restore: () => exclusive(async () => {
      try {
        const bytes = await fs.readFile(file);
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
        const stored = JSON.parse(safeStorage.decryptString(bytes));
        instanceUrl(stored.instanceUrl);
        if (!/^mml_access_[A-Za-z0-9_-]{43}$/.test(stored.accessToken || '')) throw new Error('Invalid stored connection');
        validate({ ...stored, instance_id: stored.instanceId });
        connection = stored;
      } catch (error) { if (error.code === 'ENOENT') return publicState(); throw new Error('The saved MMSM connection could not be opened. Connect again with a new token.'); }
      return refresh();
    }),
    connect: input => exclusive(async () => {
      if (connection) throw new Error('Disconnect the current MMSM account before connecting another.');
      const origin = instanceUrl(input?.instanceUrl);
      const token = String(input?.token || '').trim();
      if (!/^mml_pair_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Paste a connection token generated from your MMSM profile.');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
      const { data: info } = await request(origin, 'info');
      if (info.product !== 'MMSM' || info.protocol !== 1) throw new Error('This instance does not support MML connections. Update MMSM and try again.');
      const { data, cookie } = await request(origin, 'connect', { token });
      const user = validate(data);
      if (!/^mml_access_[A-Za-z0-9_-]{43}$/.test(data.access_token || '') || data.instance_id !== info.instance_id) throw new Error('MMSM returned an invalid connection.');
      const candidate = { instanceUrl: origin, instanceId: data.instance_id, accessToken: data.access_token, user, expires: data.expires };
      try { await installCookie(origin, cookie); connection = candidate; await save(); }
      catch (error) {
        await request(origin, 'disconnect', { accessToken: candidate.accessToken }).catch(() => {});
        connection = candidate; await clear().catch(() => {}); throw error;
      }
      return publicState();
    }),
    refresh: () => exclusive(refresh),
    disconnect: () => exclusive(async () => {
      if (connection) {
        // Keep the saved credential on network failure so the user can retry revocation.
        try { await request(connection.instanceUrl, 'disconnect', { accessToken: connection.accessToken }); }
        catch (error) { if (error.status !== 401) throw error; }
      }
      await clear(); return publicState();
    })
  };
}
module.exports = { createAccount, instanceUrl, partitionFor };
