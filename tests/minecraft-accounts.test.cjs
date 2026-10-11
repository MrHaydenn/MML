const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createMinecraftAccounts } = require('../electron/minecraft-accounts.cjs');
const clientId = '11111111-1111-1111-1111-111111111111';
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: value => value.toString().split('').reverse().join('') };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-microsoft-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let time = 1000, player = 1, mode = '';
  const fetcher = async (url, options) => {
    let result;
    if (url.endsWith('/devicecode')) result = { user_code: 'ABC-123', device_code: 'private-device-code', expires_in: 900, interval: 5 };
    else if (url.endsWith('/token')) {
      if (mode) return Response.json({ error: mode }, { status: 400 });
      result = { access_token: 'secret-microsoft-access', refresh_token: 'secret-refresh' };
    } else if (url.includes('/user/authenticate')) { assert(JSON.parse(options.body).Properties.RpsTicket.startsWith('d=')); result = { Token: 'xbox-secret' }; }
    else if (url.includes('/xsts/')) result = { Token: 'xsts-secret', DisplayClaims: { xui: [{ uhs: '123' }] } };
    else if (url.endsWith('/login_with_xbox')) result = { access_token: 'minecraft-secret', expires_in: 3600 };
    else if (url.includes('/entitlements/')) result = { items: [{ name: 'game_minecraft' }] };
    else result = { id: String(player).padStart(32, '0'), name: 'Player' + player };
    return Response.json(result);
  };
  const options = { directory, safeStorage, fetcher, clientId, now: () => time };
  const accounts = createMinecraftAccounts(options); await accounts.initialize();
  return { accounts, options, directory, advance: () => { time += 10000; }, player: n => { player = n; }, mode: value => { mode = value; } };
}
test('device-code sign-in verifies Java ownership, encrypts credentials, restores multiple accounts and keeps secrets out of renderer state', async t => {
  const f = await fixture(t);
  const code = await f.accounts.begin(); assert.equal(code.userCode, 'ABC-123'); assert(!JSON.stringify(code).includes('private-device-code'));
  assert.equal((await f.accounts.poll()).pending, true); f.advance();
  const first = await f.accounts.poll(); assert.equal(first.accounts[0].name, 'Player1'); assert(!JSON.stringify(first).includes('secret'));
  f.player(2); await f.accounts.begin(); f.advance(); const second = await f.accounts.poll(); assert.equal(second.accounts.length, 2);
  const bytes = await fs.readFile(path.join(f.directory, 'minecraft-accounts.bin')); assert(!bytes.toString().includes('secret-refresh'));
  const restored = createMinecraftAccounts(f.options); assert.equal((await restored.initialize()).accounts.length, 2);
  await restored.activate(first.active); assert.equal(restored.state().active, first.active);
  await restored.remove(first.active); assert.equal(restored.state().accounts.length, 1);
});
test('pending and slow-down responses respect polling intervals and cancellation prevents completion', async t => {
  const f = await fixture(t); await f.accounts.begin(); f.advance(); f.mode('authorization_pending'); assert.equal((await f.accounts.poll()).pending, true);
  f.mode('slow_down'); f.advance(); assert.equal((await f.accounts.poll()).interval, 10000);
  f.accounts.cancel(); await assert.rejects(f.accounts.poll(), /expired/); assert.equal(f.accounts.state().accounts.length, 0);
});
test('missing application registration or unavailable encryption blocks sign-in before sending credentials', async t => {
  const f = await fixture(t);
  const unconfigured = createMinecraftAccounts({ ...f.options, clientId: '' }); await unconfigured.initialize(); await assert.rejects(unconfigured.begin(), /client ID/);
  const unavailable = createMinecraftAccounts({ ...f.options, safeStorage: { isEncryptionAvailable: () => false } }); await assert.rejects(unavailable.begin(), /encryption/);
});
