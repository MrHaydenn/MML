const fs = require('node:fs/promises');
const path = require('node:path');
const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/';
const SCOPE = 'XboxLive.signin offline_access';
function profileSkin(profile) {
  const skin = profile.skins?.find(s => s.state === 'ACTIVE') || profile.skins?.[0];
  return /^https?:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(skin?.url || '') ? skin.url.replace(/^http:/i,'https:') : null;
}

function createMinecraftAccounts({ directory, safeStorage, fetcher = fetch, clientId: bundledId = process.env.MML_MICROSOFT_CLIENT_ID || '', now = Date.now, notify = () => {} }) {
  const file = path.join(directory, 'minecraft-accounts.bin'), configFile = path.join(directory, 'minecraft-auth.json');
  let data = { accounts: [], active: null }, clientId = bundledId, pending = null, busy = false, generation = 0;
  const state = () => ({ configured: Boolean(clientId), clientId, active: data.active, accounts: data.accounts.map(({ id, name, expires, skinUrl, needsSignIn }) => ({ id, name, expires, skinUrl, needsSignIn:Boolean(needsSignIn) })) });
  async function save() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file + '.tmp', safeStorage.encryptString(JSON.stringify(data)));
    await fs.rename(file + '.tmp', file);
  }
  async function request(url, body, bearer) {
    const stage = url.endsWith('/devicecode') ? 'Microsoft sign-in code' : url.endsWith('/token') ? 'Microsoft authorization' : url.includes('user.auth.xboxlive.com') ? 'Xbox profile authentication' : url.includes('xsts.auth.xboxlive.com') ? 'Xbox authorization' : url.endsWith('/login_with_xbox') ? 'Minecraft sign-in' : url.includes('/entitlements/') ? 'Minecraft Java ownership' : 'Minecraft player profile';
    notify({stage});
    const form = body instanceof URLSearchParams;
    let response;
    try { response = await fetcher(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', ...(body ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body ? { body: form ? body.toString() : JSON.stringify(body) } : {}) }); }
    catch { throw new Error(`${stage}: could not reach the service. Check your connection and try again.`); }
    const result = await response.json().catch(() => { throw new Error(`${stage}: service returned an invalid response (HTTP ${response.status}).`); });
    if (!response.ok) {
      const error = new Error(result.XErr === 2148916233 ? 'This Microsoft account needs an Xbox profile. Create one on xbox.com, then try again.' : result.XErr === 2148916238 ? 'This child account needs family approval to use Xbox services.' : response.status === 404 && url.endsWith('/minecraft/profile') ? 'This account has no Minecraft Java profile. Check its Java Edition ownership or subscription.' : result.error === 'invalid_client' || result.error === 'unauthorized_client' ? 'Microsoft rejected MML’s application registration. Check the approved client ID and public-client/device-flow settings.' : 'Microsoft or Minecraft rejected sign-in. Check account permissions, Java ownership, and the approved application registration.');
      if (url.endsWith('/login_with_xbox') && /invalid app registration/i.test(String(result.error || '') + ' ' + String(result.errorMessage || ''))) error.message = 'Minecraft rejected this application registration. Confirm the configured client ID matches the approved AppID; approval may still be propagating.';
      error.message = `${stage} failed (HTTP ${response.status}${Number.isInteger(result.XErr) ? `, Xbox code ${result.XErr}` : ''}): ${error.message}`;
      error.code = result.error; throw error;
    }
    return result;
  }
  async function exchange(tokens) {
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('Microsoft did not return the required credentials.');
    const xbox = await request('https://user.auth.xboxlive.com/user/authenticate', { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + tokens.access_token }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' });
    const xsts = await request('https://xsts.auth.xboxlive.com/xsts/authorize', { Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' });
    const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
    if (!uhs || !xsts.Token) throw new Error('Xbox did not return a valid identity.');
    const minecraft = await request('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
    if (!minecraft.access_token || !Number.isFinite(minecraft.expires_in)) throw new Error('Minecraft did not return a valid session.');
    const entitlements = await request('https://api.minecraftservices.com/entitlements/mcstore', null, minecraft.access_token);
    if (!Array.isArray(entitlements.items) || !entitlements.items.length) throw new Error('Minecraft Java Edition ownership or an active subscription could not be verified for this account.');
    const profile = await request('https://api.minecraftservices.com/minecraft/profile', null, minecraft.access_token);
    if (!/^[a-f0-9]{32}$/i.test(profile.id || '') || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name || '')) throw new Error('Minecraft did not return a valid player profile.');
    const skinUrl = profileSkin(profile);
    return { id: profile.id, name: profile.name, skinUrl, refreshToken: tokens.refresh_token, accessToken: minecraft.access_token, expires: now() + minecraft.expires_in * 1000, clientId };
  }
  async function exclusive(fn) { if (busy) throw new Error('An account operation is already running.'); busy = true; try { return await fn(); } finally { busy = false; } }
  function signInRequired(){const error=new Error('Your Minecraft session needs a new Microsoft sign-in.');error.code='MML_SIGN_IN_REQUIRED';return error;}
  async function refreshAccount(account){
    if(account.needsSignIn)throw signInRequired();
    let refreshed;
    try{
      const tokens=await request(OAUTH+'token',new URLSearchParams({client_id:account.clientId,grant_type:'refresh_token',refresh_token:account.refreshToken,scope:SCOPE}));
      refreshed=await exchange(tokens);
      if(refreshed.id!==account.id){account.needsSignIn=true;await save();throw signInRequired();}
    }catch(error){
      if(['invalid_grant','interaction_required','login_required','consent_required'].includes(error.code)){account.needsSignIn=true;await save();throw signInRequired();}
      throw error;
    }
    const previous=data;data={...data,accounts:data.accounts.map(a=>a.id===refreshed.id?{...refreshed,clientId:account.clientId}:a)};
    try{await save();}catch(error){data=previous;throw error;}return data.accounts.find(a=>a.id===refreshed.id);
  }
  const launchSession=()=>exclusive(async()=>{
    let account=data.accounts.find(a=>a.id===data.active);
    if(!account||account.needsSignIn)throw signInRequired();
    if(account.expires<now()+300000)account=await refreshAccount(account);
    return{id:account.id,name:account.name,accessToken:account.accessToken};
  });
  return {
    state,
    cacheProfile: profile=>exclusive(async()=>{const account=data.accounts.find(a=>a.id===profile.id);if(!account)throw new Error('Minecraft account changed.');const before=account.skinUrl;account.skinUrl=profileSkin(profile);try{await save();}catch(error){account.skinUrl=before;throw error;}return state();}),
    launchSession,
    prepare:async()=>{try{await launchSession();return {ready:true,...state()};}catch(error){if(error.code==='MML_SIGN_IN_REQUIRED')return {ready:false,needsSignIn:true,...state()};throw error;}},
    initialize: () => exclusive(async () => {
      try { const saved = JSON.parse(await fs.readFile(configFile, 'utf8')); if (!bundledId && /^[a-f0-9-]{36}$/i.test(saved.clientId || '')) clientId = saved.clientId; } catch (error) { if (error.code !== 'ENOENT') throw new Error('Minecraft sign-in settings could not be read.'); }
      try { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption unavailable'); data = JSON.parse(safeStorage.decryptString(await fs.readFile(file))); if (!Array.isArray(data.accounts)) throw new Error('Invalid accounts'); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('Saved Minecraft accounts could not be opened. Existing credentials were preserved.'); }
      let updatedSkin = false;
      for (const account of data.accounts.filter(a => !a.skinUrl && a.expires > now())) {
        try { const profile = await request('https://api.minecraftservices.com/minecraft/profile',null,account.accessToken); const skinUrl=profileSkin(profile); if (profile.id===account.id && skinUrl) { account.skinUrl=skinUrl;updatedSkin=true; } } catch { /* Keep cached accounts usable while offline. */ }
      }
      if(updatedSkin) await save();
      return state();
    }),
    configure: value => exclusive(async () => {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '')) throw new Error('Enter MML’s approved Microsoft Application/client ID.');
      if (pending) throw new Error('Cancel the current sign-in before changing its client ID.');
      await fs.mkdir(directory, { recursive: true }); await fs.writeFile(configFile, JSON.stringify({ clientId: value })); clientId = value; return state();
    }),
    begin: () => exclusive(async () => {
      if (!clientId) throw new Error('MML needs its approved Microsoft Application/client ID before sign-in.');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
      const result = await request(OAUTH + 'devicecode', new URLSearchParams({ client_id: clientId, scope: SCOPE }));
      if (!result.device_code || !result.user_code || !Number.isFinite(result.expires_in)) throw new Error('Microsoft did not return a valid sign-in code.');
      pending = { code: result.device_code, interval: Math.max(5, result.interval || 5) * 1000, expires: now() + result.expires_in * 1000, next: now() + Math.max(5, result.interval || 5) * 1000 };
      generation++;
      return { userCode: result.user_code, verificationUrl: 'https://www.microsoft.com/link', expires: pending.expires, interval: pending.interval };
    }),
    poll: () => exclusive(async () => {
      if (!pending || now() >= pending.expires) { pending = null; throw new Error('Microsoft sign-in expired. Start again.'); }
      if (now() < pending.next) return { pending: true, interval: pending.interval };
      pending.next = now() + pending.interval;
      const attempt = pending, attemptGeneration = generation;
      let tokens;
      try { tokens = await request(OAUTH + 'token', new URLSearchParams({ client_id: clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: pending.code })); }
      catch (error) {
        if (generation !== attemptGeneration) throw new Error('Microsoft sign-in was cancelled.');
        if (error.code === 'authorization_pending') return { pending: true, interval: pending.interval };
        if (error.code === 'slow_down') { pending.interval += 5000; pending.next = now() + pending.interval; return { pending: true, interval: pending.interval }; }
        pending = null; throw error;
      }
      if (generation !== attemptGeneration || pending !== attempt) throw new Error('Microsoft sign-in was cancelled.');
      pending = null;
      const account = await exchange(tokens);
      if (generation !== attemptGeneration) throw new Error('Microsoft sign-in was cancelled.');
      const previous = data; data = { accounts: data.accounts.filter(a => a.id !== account.id).concat(account), active: account.id };
      try { await save(); } catch (error) { data = previous; throw error; }
      return { pending: false, ...state() };
    }),
    cancel: () => { pending = null; generation++; return state(); },
    activate: id => exclusive(async () => {
      if (!data.accounts.some(a => a.id === id)) throw new Error('Account not found.');
      const previous = data.active; data.active = id; try { await save(); } catch (error) { data.active = previous; throw error; } return state();
    }),
    remove: id => exclusive(async () => {
      const previous = data; const accounts = data.accounts.filter(a => a.id !== id); data = { accounts, active: data.active === id ? accounts[0]?.id || null : data.active };
      try { await save(); } catch (error) { data = previous; throw error; } return state();
    }),
    refresh:id=>exclusive(async()=>{const account=data.accounts.find(a=>a.id===id);if(!account)throw new Error('Account not found.');await refreshAccount(account);return state();})
  };
}
module.exports = { createMinecraftAccounts };
