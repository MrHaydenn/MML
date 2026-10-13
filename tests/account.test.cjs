const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAccount } = require('../electron/account.cjs');

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

