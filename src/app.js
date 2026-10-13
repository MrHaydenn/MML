const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const compact = number => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number || 0);
const labels = { modpack: 'Modpack', mod: 'Mod', resourcepack: 'Resource pack', shader: 'Shader' };
const state = { type: 'modpack', offset: 0, total: 0, request: 0, details: 0, profiles: [], versions: [], source: null, page: 'discover' };
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
  for (const name of ['discover', 'library', 'hosting', 'settings', 'project', 'accounts']) $(`#${name}-page`).hidden = page !== name;
  $$('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#breadcrumb').textContent = `Workspace / ${page === 'library' ? 'My library' : page === 'hosting' ? 'Servers' : page === 'settings' ? 'Settings & about' : 'Discover'}`;
  if (page === 'library') renderLibrary();
  if (page === 'accounts') loadMinecraftAccounts();
  window.scrollTo({ top: 0 });
  updateHostingLayout();
  if (page === 'hosting') {
    if (window.mml) window.mml.showHosting().then(renderHostingStatus).catch(hostingError);
    else renderHostingStatus({ state: 'preview' });
  }
}

function updateHostingLayout() {
  if (!window.mml) return;
  const rect = $('#hosting-viewport').getBoundingClientRect();
  window.mml.setHostingLayout({ visible: state.page === 'hosting' && !document.body.classList.contains('signing-in') && !document.querySelector('dialog[open]'), bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
}

function renderHostingStatus(status) {
  const titles = { idle: 'Your server workspace', loading: 'Connecting to MMSM…', ready: 'MMSM is ready', error: 'Could not connect to MMSM', preview: 'Connect from the Windows app', disconnected: 'Bring your servers into MML' };
  $('#hosting-status').textContent = { idle: 'Ready to connect', loading: 'Connecting…', ready: 'Connected', error: 'Connection unavailable', preview: 'Browser preview', disconnected: 'Account connection needed' }[status.state] || '';
  $('#hosting-placeholder').hidden = status.state === 'ready';
  $('#hosting-message-title').textContent = titles[status.state] || titles.idle;
  $('#hosting-message').textContent = status.message || (['preview', 'disconnected'].includes(status.state) ? 'Connect your MMSM instance with a token from your profile. The Windows app opens your server manager already signed in.' : 'Your server manager will appear here. You can also open it in your browser.');
  $('#hosting-retry').hidden = status.state !== 'error';
  updateHostingLayout();
}

function reloadHosting() {
  if (!window.mml) return toast('The embedded server manager is available in the Windows launcher.');
  window.mml.reloadHosting().then(renderHostingStatus).catch(hostingError);
}

async function hostingError(error) {
  renderHostingStatus({ state: 'error', message: error.message });
  if (window.mml) renderAccount(await window.mml.accountState());
}

function renderAccount(value) {
  account = value;
  $('#account-name').textContent = value.connected ? value.user.username : 'Local workspace';
  $('#account-avatar').textContent = value.connected ? value.user.username.charAt(0).toUpperCase() : 'M';
  $('#account-instance').textContent = value.connected ? new URL(value.instanceUrl || value.serviceUrl).host : 'Sign in to Haydenn Accounts';
  $('#hosting-origin').textContent = value.instanceUrl ? new URL(value.instanceUrl).host : 'No MMSM instance connected';
  $('#hosting-account').textContent = value.connected ? `Signed in as ${value.user.username} · ${value.user.role}` : 'Your MMSM server workspace';
  $('#hosting-connect').hidden = !!value.instanceUrl;
  $('#hosting-external').disabled = !value.instanceUrl;
  $('#hosting-reload').disabled = !value.instanceUrl;
}

function enterWorkspace() {
  $('#signin-screen').hidden = true; document.body.classList.remove('signing-in'); updateHostingLayout();
}

function showSignin() {
  $('#signin-error').textContent = ''; $('#shared-password').value = '';
  $('#signin-screen').hidden = false; document.body.classList.add('signing-in'); updateHostingLayout(); $('#shared-username').focus();
}

$('#continue-local').onclick = enterWorkspace;
$('#hosting-connect').onclick = showSignin;
$('#account-menu').onclick = () => {
  if (!account.connected) return showSignin();
  $('#signed-in-name').textContent = account.user.username;
  $('#signed-in-instance').textContent = account.instanceUrl || account.serviceUrl;
  $('#account-error').textContent = '';
  $('#account-dialog').showModal();
};
$('#disconnect-account').onclick = async () => {
  $('#disconnect-account').disabled = true; $('#account-error').textContent = '';
  try {
    renderAccount(await window.mml.disconnectAccount()); $('#account-dialog').close();
    if (state.page === 'hosting') renderHostingStatus({ state: 'disconnected' });
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
    enterWorkspace(); showPage(account.instanceUrl ? 'hosting' : 'discover'); toast(`Welcome, ${account.user.username}.`);
  } catch (error) { $('#signin-error').textContent = error.message; }
  finally { $('#signin-submit').disabled = false; }
};

async function restoreAccount() {
  renderAccount(account);
  if (!window.mml) return;
  $('#signin-submit').disabled = true;
  try {
    renderAccount(await window.mml.restoreAccount());
    if (account.connected) enterWorkspace();
  } catch (error) {
    renderAccount(await window.mml.accountState());
    if (account.connected) { enterWorkspace(); toast(error.message); }
    else $('#signin-error').textContent = error.message;
  } finally { $('#signin-submit').disabled = false; }
}

$('#hosting-external').onclick = () => {
  if (window.mml) window.mml.openHosting().catch(error => toast(error.message));
  else if (account.connected) window.open(account.instanceUrl, '_blank', 'noopener,noreferrer');
};
$('#hosting-reload').onclick = reloadHosting;
$('#hosting-retry').onclick = reloadHosting;
if (window.mml) {
  window.mml.onHostingStatus(renderHostingStatus);
  new ResizeObserver(updateHostingLayout).observe($('#hosting-viewport'));
  new MutationObserver(updateHostingLayout).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('resize', updateHostingLayout);
  window.addEventListener('scroll', updateHostingLayout, { passive: true });
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

$$('[data-page]').forEach(button => button.onclick = () => showPage(button.dataset.page));
$$('[data-window]').forEach(button => { button.onclick = () => window.mml?.windowAction(button.dataset.window); if (!window.mml) button.disabled = true; });
$$('[data-type]').forEach(button => button.onclick = () => {
  state.type = button.dataset.type; state.offset = 0;
  $$('[data-type]').forEach(tab => { tab.classList.toggle('selected', tab === button); tab.setAttribute('aria-selected', String(tab === button)); });
  $('#search').placeholder = `Find your next ${labels[state.type].toLowerCase()}…`; search();
});
$('#search').oninput = () => { state.offset = 0; ++state.request; clearTimeout(searchTimer); searchTimer = setTimeout(search, 350); };
for (const selector of ['#loader-filter', '#version-filter', '#sort']) $(selector).onchange = () => { clearTimeout(searchTimer); state.offset = 0; search(); };
$('#reset-filters').onclick = () => { clearTimeout(searchTimer); $('#search').value = ''; $('#loader-filter').value = ''; $('#version-filter').value = ''; $('#sort').value = 'downloads'; state.offset = 0; search(); };
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
$('#library-list').onclick = async event => {
  const content = event.target.closest('[data-content]'); if (content) return showInstance(content.dataset.content);
  const button = event.target.closest('[data-remove]'); if (!button) return;
  if (button.dataset.confirm !== 'true') { button.dataset.confirm = 'true'; button.textContent = 'Confirm removal'; setTimeout(() => { button.dataset.confirm = ''; button.textContent = 'Remove'; }, 4000); return; }
  button.disabled = true;
  try { state.profiles = await api.removeProfile(button.dataset.remove); renderLibrary(); toast('Profile removed.'); }
  catch (error) { toast(error.message); button.disabled = false; }
};
$('#open-library').onclick = () => api.openLibrary().catch(error => toast(error.message));
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); showPage('discover'); $('#search').focus(); } });
api.library().then(profiles => { state.profiles = profiles; renderLibrary(); }).catch(error => toast(error.message));
loadVersions(); search();
restoreAccount();

function renderUpdate(status) {
  $('#app-version').textContent = status.current || '0.4.0';
  $('#update-current').textContent = `Installed: MML ${status.current || '0.4.0'}`;
  $('#update-channel').value = status.channel;
  $('#update-status').textContent = status.message;
  const working = ['checking', 'downloading'].includes(status.status);
  $('#update-channel').disabled = working || status.status === 'ready' || !window.mml;
  $('#update-check').disabled = working || status.status === 'ready' || !window.mml;
  $('#update-download').hidden = status.status !== 'available';
  $('#update-install').hidden = status.status !== 'ready';
  $('#update-progress').hidden = status.status !== 'downloading';
  $('#update-progress').value = status.progress || 0;
}
async function updateAction(action) {
  try { const status = await action(); if (status) renderUpdate(status); }
  catch (error) { $('#update-status').textContent = error.message; }
}
$('#update-channel').onchange = () => updateAction(async () => { await window.mml.updateChannel($('#update-channel').value); return window.mml.checkUpdates(); });
$('#update-check').onclick = () => updateAction(() => window.mml.checkUpdates());
$('#update-download').onclick = () => updateAction(() => window.mml.downloadUpdate());
$('#update-install').onclick = () => updateAction(() => window.mml.installUpdate());
if (window.mml) {
  window.mml.onUpdateStatus(status => {
    renderUpdate(status);
    if (status.status === 'available') toast(`MML ${status.latest} is available. Open Settings to update.`);
  });
  updateAction(() => window.mml.updateState());
} else renderUpdate({ channel: 'stable', current: '0.4.0', status: 'development', message: 'Install the Windows application to check for and install updates.' });

initializeDiscovery();
