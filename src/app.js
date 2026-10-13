const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const compact = number => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number || 0);
const labels = { modpack: 'Modpack', mod: 'Mod', resourcepack: 'Resource pack', shader: 'Shader' };
const state = { type: 'modpack', offset: 0, total: 0, request: 0, details: 0, profiles: [], versions: [], source: null, page: 'library' };
let toastTimer, searchTimer;
let account = { connected: false };
// The browser preview uses the same backend modules through a loopback development server.
const api = window.mml || Object.fromEntries(['search', 'project', 'versions', 'gameVersions', 'library', 'createProfile', 'removeProfile', 'openLibrary', 'openProject'].map(method => [method, async value => {
  const response = await fetch(`/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}]));

function safeImage(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'cdn.modrinth.com' ? escapeHTML(parsed.href) : ''; } catch { return ''; }
}
function icon(project) {
  const url = safeImage(project.icon_url);
  return url ? `<img class="project-icon" src="${url}" alt="" loading="lazy">` : `<span class="project-icon icon-fallback">${escapeHTML(project.title?.charAt(0) || 'M')}</span>`;
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500);
}
function showPage(page) {
  state.page = page;
  for (const name of ['discover', 'library', 'settings', 'project', 'accounts', 'instance', 'skins']) $(`#${name}-page`).hidden = page !== name;
  $$('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#breadcrumb').textContent = `Workspace / ${page === 'library' ? 'My library' : page === 'settings' ? 'Settings & about' : page==='skins'?'Skin editor':'Discover'}`;
  if(typeof renderInstanceShortcuts==='function')renderInstanceShortcuts();
  if (page === 'library') renderLibrary();
  if(page==='skins')openSkins();else if(typeof disposeSkinPreview==='function')disposeSkinPreview();
  if (page === 'accounts') loadMinecraftAccounts();
  window.scrollTo({ top: 0 });
 
}

function renderAccount(value) {
  account = value;$('#account-menu').title=value.connected?`Haydenn account: ${value.user.username}`:'Sign in to Haydenn Accounts';$('#account-menu').setAttribute('aria-label',$('#account-menu').title);
  $('#account-name').textContent = value.connected ? value.user.username : 'Local workspace';
  $('#account-avatar').textContent = value.connected ? value.user.username.charAt(0).toUpperCase() : 'M';
  $('#account-instance').textContent = value.connected ? new URL(value.serviceUrl).host : 'Sign in to Haydenn Accounts';
}

function enterWorkspace() {
  $('#signin-screen').hidden = true; document.body.classList.remove('signing-in');showPage('library');
}

function showSignin() {
  $('#signin-error').textContent = ''; $('#shared-password').value = '';
  $('#signin-screen').hidden = false; document.body.classList.add('signing-in'); $('#shared-username').focus();
}

$('#continue-local').onclick = enterWorkspace;
$('#account-menu').onclick = () => {
  if (!account.connected) return showSignin();
  $('#signed-in-name').textContent = account.user.username;
  $('#signed-in-instance').textContent = account.serviceUrl;
  $('#account-error').textContent = '';
  $('#account-dialog').showModal();
};
$('#disconnect-account').onclick = async () => {
  $('#disconnect-account').disabled = true; $('#account-error').textContent = '';
  try {
    renderAccount(await window.mml.disconnectAccount()); $('#account-dialog').close();
    toast('MML disconnected. Your local library is still here.');
  } catch (error) { $('#account-error').textContent = error.message; }
  finally { $('#disconnect-account').disabled = false; }
};
$('#signin-form').onsubmit = async event => {
  event.preventDefault(); $('#signin-error').textContent = '';
  if (!window.mml) { $('#shared-password').value = ''; $('#signin-error').textContent = 'Account connections are available in the Windows app. This preview does not send or save tokens.'; return; }
  $('#signin-submit').disabled = true;
  const password = $('#shared-password').value; $('#shared-password').value = '';
  try {
    renderAccount(await window.mml.connectAccount({ username: $('#shared-username').value.trim(), password }));
    enterWorkspace(); showPage('library'); toast(`Welcome, ${account.user.username}.`);
  } catch (error) { $('#signin-error').textContent = error.message; }
  finally { $('#signin-submit').disabled = false; }
};

async function restoreAccount() {
  renderAccount(account);
  if (!window.mml) return;
  $('#signin-submit').disabled = true;
  try {
    renderAccount(await window.mml.restoreAccount());

  } catch (error) {
    renderAccount(await window.mml.accountState());
    if (account.connected) { toast(error.message); }
    else $('#signin-error').textContent = error.message;
  } finally { $('#signin-submit').disabled = false; }
}

function openCreate(project = null, version = null) {
  state.source = project ? { id: project.id, title: project.title } : null;
  $('#create-form').reset(); $('#form-error').textContent = '';
  $('#profile-name').value = project?.title?.slice(0, 60) || '';
  $('#profile-source').textContent = project ? `Inspired by ${project.title}. Install the pack from its project page to download its content.` : '';
  const gameVersion = version?.game_versions?.at(-1);
  if (gameVersion) {
    if (![...$('#profile-version').options].some(o => o.value === gameVersion)) $('#profile-version').add(new Option(gameVersion, gameVersion));
    $('#profile-version').value = gameVersion;
  }
  const loader = version?.loaders?.find(l => ['fabric', 'forge', 'neoforge', 'quilt'].includes(l));
  if (loader) $('#profile-loader').value = loader;
  $('#create-dialog').showModal(); $('#profile-name').focus();
}

async function loadVersions() {
  try {
    state.versions = await api.gameVersions();
    // Profile schema currently supports stable numeric Minecraft releases.
    const versions = state.versions.filter(version => /^\d+\.\d+(\.\d+)?$/.test(version));
    const options = versions.map(version => `<option value="${escapeHTML(version)}">${escapeHTML(version)}</option>`).join('');
    $('#version-filter').innerHTML = '<option value="">All versions</option>' + options;
    $('#profile-version').innerHTML = options;
  } catch {
    $('#profile-version').innerHTML = '<option value="1.21.1">1.21.1 (offline fallback)</option><option value="1.20.1">1.20.1 (offline fallback)</option>';
    toast('Version list unavailable. A limited offline list is available for profiles.');
  }
}

$$('[data-page]').forEach(button => button.onclick = () => button.dataset.page==='discover'?openGlobalDiscovery():showPage(button.dataset.page));
$$('[data-window]').forEach(button => { button.onclick = () => window.mml?.windowAction(button.dataset.window); if (!window.mml) button.disabled = true; });
$$('[data-type]').forEach(button => button.onclick = () => {
  state.type = button.dataset.type; state.offset = 0;
  $$('[data-type]').forEach(tab => { tab.classList.toggle('selected', tab === button); tab.setAttribute('aria-selected', String(tab === button)); });
  $('#search').placeholder = `Find your next ${labels[state.type].toLowerCase()}…`; search();
});
$('#search').oninput = () => { state.offset = 0; ++state.request; clearTimeout(searchTimer); searchTimer = setTimeout(search, 350); };
for (const selector of ['#loader-filter', '#version-filter', '#sort']) $(selector).onchange = () => { clearTimeout(searchTimer); state.offset = 0; search(); };
$('#reset-filters').onclick = () => { clearTimeout(searchTimer); $('#search').value = ''; $('#loader-filter').value = ''; $('#version-filter').value = ''; $('#sort').value = 'downloads'; state.offset = 0;renderDiscoveryContext();search(); };
$('#previous').onclick = () => { state.offset = Math.max(0, state.offset - 12); search(); };
$('#next').onclick = () => { state.offset += 12; search(); };
$('#results').onclick = discoveryClick;
for (const selector of ['#sidebar-create', '#library-create']) $(selector).onclick = () => openCreate();
$$('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
$('#create-form').onsubmit = async event => {
  event.preventDefault(); $('#save-profile').disabled = true; $('#form-error').textContent = '';
  try {
    state.profiles = await api.createProfile({ name: $('#profile-name').value, gameVersion: $('#profile-version').value, loader: $('#profile-loader').value, source: state.source });
    $('#create-dialog').close(); showPage('library'); toast('Minecraft instance created.');
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { $('#save-profile').disabled = false; }
};
$('#library-page').onclick = async event => {
  const archive=event.target.closest('[data-archive]');if(archive){try{const p=state.profiles.find(p=>p.id===archive.dataset.archive);state.profiles=await window.mml.updateInstance(p.id,{archived:!p.archived});renderLibrary();}catch(error){toast(error.message);}return;}
  const play=event.target.closest('[data-play]');if(play)return playInstance(play.dataset.play);
  const stop=event.target.closest('[data-stop]');if(stop)return stopInstance(stop.dataset.stop);
  const content = event.target.closest('[data-content]'); if (content) return showInstance(content.dataset.content);
  const button = event.target.closest('[data-remove]'); if (!button) { const tile=event.target.closest('[data-instance-tile]');if(tile)return showInstance(tile.dataset.instanceTile);return; }
  if (button.dataset.confirm !== 'true') { button.dataset.confirm = 'true'; button.textContent = 'Confirm removal'; setTimeout(() => { button.dataset.confirm = ''; button.textContent = 'Remove'; }, 4000); return; }
  button.disabled = true;
  try { state.profiles = await api.removeProfile(button.dataset.remove); renderLibrary(); toast('Profile removed.'); }
  catch (error) { toast(error.message); button.disabled = false; }
};
$('#open-library').onclick = () => api.openLibrary().catch(error => toast(error.message));
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); showPage('discover'); $('#search').focus(); } });
api.library().then(profiles => { state.profiles = profiles; renderLibrary(); }).catch(error => toast(error.message));
loadVersions(); search();
enterWorkspace();
restoreAccount();

function renderUpdate(status) {
  $('#app-version').textContent = status.current || '0.8.0';
  $('.sidebar-version [data-page="settings"]').title=`Settings & about · MML ${status.current||'0.8.0'}`;
  $('#update-current').textContent = `Installed: MML ${status.current || '0.8.0'}`;
  $('#update-channel').value = status.channel;
  $('#update-status').textContent = status.message;
  const working = ['checking', 'downloading'].includes(status.status);
  $('#update-channel').disabled = working || status.status === 'ready' || !window.mml;
  $('#update-check').disabled = working || status.status === 'ready' || !window.mml;
  $('#update-download').hidden = status.status !== 'available';
  $('#update-install').hidden = status.status !== 'ready';
  $('#restart-update').hidden=status.status!=='ready';
  $('#update-progress').hidden = status.status !== 'downloading';
  $('#update-progress').value = status.progress || 0;
}
async function updateAction(action) {
  try { const status = await action(); if (status) renderUpdate(status); }
  catch (error) { $('#update-status').textContent = error.message;toast(error.message); }
}
$('#update-channel').onchange = () => updateAction(async () => { await window.mml.updateChannel($('#update-channel').value); return window.mml.checkUpdates(); });
$('#update-check').onclick = () => updateAction(() => window.mml.checkUpdates());
$('#update-download').onclick = () => updateAction(() => window.mml.downloadUpdate());
$('#restart-update').onclick=()=>updateAction(()=>window.mml.installUpdate());
$('#update-install').onclick = () => updateAction(() => window.mml.installUpdate());
if (window.mml) {
  window.mml.onUpdateStatus(status => {
    renderUpdate(status);
    if (status.status === 'available') toast(`MML ${status.latest} is available. Downloading in the background.`);
  });
  updateAction(() => window.mml.updateState());
} else renderUpdate({ channel: 'stable', current: '0.8.0', status: 'development', message: 'Install the Windows application to check for and install updates.' });

initializeInstances();
initializeDiscovery();
initializeSkins();
