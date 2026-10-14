const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createMinecraftAccounts } = require('../electron/minecraft-accounts.cjs');
const clientId = '11111111-1111-1111-1111-111111111111';
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: value => value.toString().split('').reverse().join('') };
async function fixture(t, failure) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-microsoft-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let time = 1000, player = 1, mode = '';
  const fetcher = async (url, options) => {
    if (failure && url.endsWith(failure.path)) return Response.json(failure.body, { status: failure.status });
    let result;
    if (url.endsWith('/devicecode')) result = { user_code: 'ABC-123', device_code: 'private-device-code', expires_in: 900, interval: 5 };
    else if (url.endsWith('/token')) {
      if (mode) return Response.json({ error: mode }, { status: 400 });
      result = { access_token: 'secret-microsoft-access', refresh_token: 'secret-refresh' };
    } else if (url.includes('/user/authenticate')) { assert(JSON.parse(options.body).Properties.RpsTicket.startsWith('d=')); result = { Token: 'xbox-secret' }; }
    else if (url.includes('/xsts/')) result = { Token: 'xsts-secret', DisplayClaims: { xui: [{ uhs: '123' }] } };
    else if (url.endsWith('/login_with_xbox')) result = { access_token: 'minecraft-secret', expires_in: 3600 };
    else if (url.includes('/entitlements/')) result = { items: [{ name: 'game_minecraft' }] };
    else result = { id: String(player).padStart(32, '0'), name: 'Player' + player, skins:[{state:'ACTIVE',url:'http://textures.minecraft.net/texture/'+'a'.repeat(64)}] };
    return Response.json(result);
  };
  const options = { directory, safeStorage, fetcher, clientId, now: () => time };
  const accounts = createMinecraftAccounts(options); await accounts.initialize();
  return { accounts, options, directory, advance: (ms=10000) => { time += ms; }, player: n => { player = n; }, mode: value => { mode = value; } };
}
test('device-code sign-in verifies Java ownership, encrypts credentials, restores multiple accounts and keeps secrets out of renderer state', async t => {
  const f = await fixture(t);
  const code = await f.accounts.begin(); assert.equal(code.userCode, 'ABC-123'); assert(!JSON.stringify(code).includes('private-device-code'));
  assert.equal((await f.accounts.poll()).pending, true); f.advance();
  const first = await f.accounts.poll(); assert.equal(first.accounts[0].name, 'Player1'); assert(!JSON.stringify(first).includes('secret'));
  assert.match(first.accounts[0].skinUrl,/^https:\/\/textures.minecraft.net/);
  f.player(2); await f.accounts.begin(); f.advance(); const second = await f.accounts.poll(); assert.equal(second.accounts.length, 2);
  const bytes = await fs.readFile(path.join(f.directory, 'minecraft-accounts.bin')); assert(!bytes.toString().includes('secret-refresh'));
  const restored = createMinecraftAccounts(f.options); assert.equal((await restored.initialize()).accounts.length, 2);
  await restored.activate(first.active); assert.equal(restored.state().active, first.active);
  await restored.remove(first.active); assert.equal(restored.state().accounts.length, 1);
});

test('game launch obtains credentials only through the internal session method and refreshes expired sessions',async t=>{
  const f=await fixture(t);await f.accounts.begin();f.advance();await f.accounts.poll();f.advance(4000000);
  const session=await f.accounts.launchSession();assert.equal(session.name,'Player1');assert.equal(session.accessToken,'minecraft-secret');assert(!JSON.stringify(f.accounts.state()).includes('minecraft-secret'));assert(f.accounts.state().accounts[0].expires>4000000);
});

test('Minecraft rejection identifies the exact stage without exposing server response secrets', async t => {
  const f = await fixture(t, {path:'/login_with_xbox',status:403,body:{error:'Invalid app registration',access_token:'DO-NOT-EXPOSE'}});
  await f.accounts.begin();f.advance();
  await assert.rejects(f.accounts.poll(), error => /Minecraft sign-in failed \(HTTP 403\)/.test(error.message) && /approved AppID/.test(error.message) && !error.message.includes('DO-NOT-EXPOSE'));
  assert.equal(f.accounts.state().accounts.length,0);
});

test('Xbox failures identify authorization separately from Minecraft approval', async t => {
  const f = await fixture(t, {path:'/xsts/authorize',status:401,body:{XErr:2148916233}});
  await f.accounts.begin();f.advance();
  await assert.rejects(f.accounts.poll(), /Xbox authorization failed \(HTTP 401, Xbox code 2148916233\).*Xbox profile/);
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

test('launch preparation refreshes expiring sessions without exposing credentials, and missing accounts request sign-in',async t=>{
 const f=await fixture(t);assert.equal((await f.accounts.prepare()).ready,false);
 await f.accounts.begin();f.advance();await f.accounts.poll();f.advance(4000000);
 const result=await f.accounts.prepare();assert.equal(result.ready,true);assert(!JSON.stringify(result).includes('secret'));assert(result.accounts[0].expires>4000000);
});
test('revoked refresh tokens persist a sign-in warning and successful sign-in clears it',async t=>{
 const f=await fixture(t);await f.accounts.begin();f.advance();await f.accounts.poll();f.advance(4000000);f.mode('invalid_grant');
 const result=await f.accounts.prepare();assert.equal(result.ready,false);assert.equal(result.accounts[0].needsSignIn,true);
 const restored=createMinecraftAccounts(f.options);assert.equal((await restored.initialize()).accounts[0].needsSignIn,true);
 f.mode('');await f.accounts.begin();f.advance();const signedIn=await f.accounts.poll();assert.equal(signedIn.accounts[0].needsSignIn,false);assert.equal((await f.accounts.prepare()).ready,true);
});
test('service errors during refresh preserve accounts and do not request a new browser sign-in',async t=>{
 const f=await fixture(t);await f.accounts.begin();f.advance();await f.accounts.poll();f.advance(4000000);f.mode('temporarily_unavailable');
 await assert.rejects(f.accounts.prepare(),/Microsoft authorization failed/);assert.equal(f.accounts.state().accounts[0].needsSignIn,false);assert.equal(f.accounts.state().accounts.length,1);
});
