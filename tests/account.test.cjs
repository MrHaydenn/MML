const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAccount, instanceUrl, partitionFor } = require('../electron/account.cjs');

test('Haydenn Accounts sign-in uses the fixed service, persists encrypted sessions and revokes sign-out', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-central-'));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  const token = 'abc' + 'z'.repeat(40), calls = [];
  const payload = {user:{id:'shared1',username:'MixedCase'},expires:Date.now()/1000+86400};
  const options = {directory,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s.split('').reverse().join('')),decryptString:b=>b.toString().split('').reverse().join('')},fetcher:async(url,request)=>{
    calls.push(url); assert(url.startsWith('https://accounts.mrhaydenn.us/api/'));
    if(url.endsWith('/login')) { assert.deepEqual(JSON.parse(request.body),{username:'MixedCase',password:'test password',audience:'mml'});return new Response(JSON.stringify({...payload,token})); }
    assert.equal(request.headers.Authorization,'Bearer '+token);
    return new Response(JSON.stringify(url.endsWith('/me')?payload:{}));
  }};
  const account=createAccount(options);
  const state=await account.connect({username:'MixedCase',password:'test password',serviceUrl:'https://untrusted.example'});
  assert.equal(state.serviceUrl,'https://accounts.mrhaydenn.us');assert.equal(state.user.username,'MixedCase');assert.equal(state.accessToken,undefined);
  assert(!String(await fs.readFile(path.join(directory,'mmsm-connection.bin'))).includes(token));
  assert.equal((await createAccount(options).restore()).user.id,'shared1');
  await account.disconnect();assert.equal(account.current().connected,false);assert(calls.some(url=>url.endsWith('/logout')));
});

test('Haydenn Accounts reports invalid credentials clearly', async () => {
  const account=createAccount({directory:'.',safeStorage:{isEncryptionAvailable:()=>true},fetcher:async()=>new Response('{}',{status:401})});
  await assert.rejects(account.connect({username:'user',password:'wrong'}),/Invalid username or password/);
});

test('instance URLs require HTTPS or explicit localhost and reject credential-bearing URLs', () => {
  assert.equal(instanceUrl('https://manager.example.com/'), 'https://manager.example.com');
  assert.equal(instanceUrl('http://127.0.0.1:11015'), 'http://127.0.0.1:11015');
  for (const url of ['http://example.com', 'file:///secret', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=secret', 'https://example.com/#token']) assert.throws(() => instanceUrl(url));
  assert.notEqual(partitionFor('https://one.example'),partitionFor('https://two.example'));
});

test('pairing stores an encrypted credential, shares only a session cookie, restores identity and revokes on disconnect', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mml-account-'));
  const cookies=[];let revoked=false;let cleared=false;
  const accessToken='mml_access_'+'a'.repeat(43);
  const payload={user:{id:'user1',username:'MixedCase',role:'viewer'},instance_id:'instance1',expires:Date.now()/1000+86400};
  const options={directory,safeStorage:{isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text.split('').reverse().join('')),decryptString:bytes=>bytes.toString().split('').reverse().join('')},sessionFor:()=>({cookies:{set:async cookie=>cookies.push(cookie)},clearStorageData:async()=>{cleared=true;}}),fetcher:async(url,request)=>{
    assert.equal(request.redirect,'error');
    if(url.endsWith('/info')) return new Response(JSON.stringify({product:'MMSM',protocol:1,instance_id:'instance1'}));
    if(url.endsWith('/disconnect')){revoked=true;return new Response('{}');}
    return new Response(JSON.stringify({...payload,...(url.endsWith('/connect')?{access_token:accessToken}:{})}),{headers:{'set-cookie':'mmsm_session='+'b'.repeat(43)+'; HttpOnly; Secure; Path=/'}});
  }};
  try {
    const account=createAccount(options);
    const current=await account.connect({instanceUrl:'https://manager.example.com',token:'mml_pair_'+'c'.repeat(43)});
    assert.equal(current.user.username,'MixedCase');assert.equal(current.accessToken,undefined);
    assert.equal(cookies[0].httpOnly,true);assert.equal(cookies[0].sameSite,'strict');
    assert(!String(await fs.readFile(path.join(directory,'mmsm-connection.bin'))).includes(accessToken));
    const restored=createAccount(options);assert.equal((await restored.restore()).user.id,'user1');
    await restored.disconnect();assert(revoked);assert(cleared);assert.equal(restored.current().connected,false);
    await assert.rejects(fs.readFile(path.join(directory,'mmsm-connection.bin')), {code:'ENOENT'});
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('pairing is blocked when OS encryption is unavailable and never sends a token', async () => {
  const account=createAccount({directory:'.',safeStorage:{isEncryptionAvailable:()=>false},fetcher:()=>assert.fail('Token must not be sent')});
  await assert.rejects(account.connect({instanceUrl:'https://manager.example.com',token:'mml_pair_'+'c'.repeat(43)}),/encryption/);
});
