const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const compact = number => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number || 0);
const labels = { modpack: 'Modpack', mod: 'Mod', resourcepack: 'Resource pack', shader: 'Shader' };
const state = { type: 'modpack', offset: 0, total: 0, request: 0, details: 0, profiles: [], versions: [], source: null, page: 'discover' };
let toastTimer, searchTimer;
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
  for (const name of ['discover', 'library', 'settings']) $(`#${name}-page`).hidden = page !== name;
  $$('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#breadcrumb').textContent = `Workspace / ${page === 'library' ? 'My library' : page === 'settings' ? 'Settings & about' : 'Discover'}`;
  if (page === 'library') renderLibrary();
  window.scrollTo({ top: 0 });
}

async function search() {
  const request = ++state.request;
  $('#results').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" aria-hidden="true"></div>').join('');
  $('#results-label').textContent = 'Searching the Modrinth community…';
  $('#previous').disabled = true; $('#next').disabled = true;
  try {
    const data = await api.search({ type: state.type, query: $('#search').value, loader: $('#loader-filter').value, version: $('#version-filter').value, sort: $('#sort').value, offset: state.offset });
    if (request !== state.request) return;
    state.total = data.total_hits;
    $('#connection').textContent = 'Modrinth connected'; $('#connection').classList.remove('offline');
    $('#results-label').textContent = `${data.total_hits.toLocaleString()} ${labels[state.type].toLowerCase()}${data.total_hits === 1 ? '' : 's'} to explore`;
    $('#results').innerHTML = data.hits.length ? data.hits.map(project => {
      const cover = safeImage(project.featured_gallery || project.gallery?.[0]);
      const tags = (project.display_categories || project.categories || []).filter(tag => !['minecraft'].includes(tag)).slice(0, 2).join(' · ');
      return `<button class="project-card" data-project="${escapeHTML(project.project_id)}" aria-label="View ${escapeHTML(project.title)}"><div class="card-cover">${cover ? `<img src="${cover}" loading="lazy" alt="">` : `<div class="cover-placeholder">${escapeHTML(project.title.slice(0, 2).toUpperCase())}</div>`}<span class="type-badge">${labels[state.type]}</span></div><div class="card-body"><div class="card-title">${icon(project)}<div><h3>${escapeHTML(project.title)}</h3><span class="card-author">by ${escapeHTML(project.author)}</span></div></div><p class="card-description">${escapeHTML(project.description)}</p><div class="card-meta"><span>↓ <b>${compact(project.downloads)}</b></span><span class="tags">${escapeHTML(tags)}</span><span>↗</span></div></div></button>`;
    }).join('') : '<div class="empty-state"><span class="empty-symbol">⌕</span><h2>No worlds found. Yet.</h2><p>Try another search or clear a filter to find something new.</p></div>';
    $('#previous').disabled = state.offset === 0; $('#next').disabled = state.offset + 12 >= state.total;
    $('#page-label').textContent = `Page ${Math.floor(state.offset / 12) + 1}`;
  } catch (error) {
    if (request !== state.request) return;
    $('#connection').textContent = 'Modrinth unavailable'; $('#connection').classList.add('offline');
    $('#results-label').textContent = 'Could not load projects';
    $('#results').innerHTML = `<div class="empty-state"><span class="empty-symbol">↻</span><h2>A small detour.</h2><p>${escapeHTML(error.message)}</p><button class="secondary" id="retry-search">Try again</button></div>`;
    $('#retry-search').onclick = search;
  }
}

async function showDetails(id) {
  const request = ++state.details;
  const dialog = $('#detail-dialog');
  $('#detail-content').innerHTML = '<div class="dialog-heading"><h2>Loading project…</h2><button class="icon-button" id="close-detail" aria-label="Close">×</button></div><div class="skeleton"></div>';
  $('#close-detail').onclick = () => dialog.close(); dialog.showModal();
  try {
    const [project, versions] = await Promise.all([api.project(id), api.versions(id)]);
    if (request !== state.details || !dialog.open) return;
    $('#detail-content').innerHTML = `<div class="dialog-heading"><span class="eyebrow muted">FROM THE MODRINTH COMMUNITY</span><button class="icon-button" id="close-detail" aria-label="Close">×</button></div><div class="detail-header">${icon(project)}<div><h2>${escapeHTML(project.title)}</h2><span class="card-author">${escapeHTML(labels[project.project_type] || project.project_type)} · ${escapeHTML(project.license?.id || 'See project license')}</span></div></div><p class="detail-description">${escapeHTML(project.description)}</p><div class="detail-stats"><span>↓ ${compact(project.downloads)} downloads</span><span>♡ ${compact(project.followers)} followers</span><span>${versions.length} versions</span></div><h2>Recent releases</h2><div class="version-list">${versions.slice(0, 5).map(version => `<div class="version-row"><div>${escapeHTML(version.name)}<small>${escapeHTML(version.game_versions.join(', '))} · ${escapeHTML(version.loaders.join(', '))}</small></div><span>${escapeHTML(version.version_type)}</span></div>`).join('') || '<p class="detail-notice">No published versions are available.</p>'}</div><p class="detail-notice">Create a local profile to plan this pack. Content installation and game launch are part of the next milestone.</p><div class="dialog-actions"><button id="open-project" class="secondary">View on Modrinth ↗</button>${project.project_type === 'modpack' ? '<button id="plan-project" class="primary">＋ Plan a profile</button>' : ''}</div>`;
    $('#close-detail').onclick = () => dialog.close();
    $('#open-project').onclick = () => api.openProject(project.id).catch(error => toast(error.message));
    if ($('#plan-project')) $('#plan-project').onclick = () => { dialog.close(); openCreate(project, versions[0]); };
  } catch (error) {
    if (request !== state.details || !dialog.open) return;
    $('#detail-content').innerHTML = `<div class="dialog-heading"><h2>Could not load project</h2><button class="icon-button" id="close-detail" aria-label="Close">×</button></div><p class="detail-description">${escapeHTML(error.message)}</p><button id="retry-detail" class="secondary">Try again</button>`;
    $('#close-detail').onclick = () => dialog.close(); $('#retry-detail').onclick = () => { dialog.close(); showDetails(id); };
  }
}

function renderLibrary() {
  $('#library-count').textContent = state.profiles.length;
  $('#library-list').innerHTML = state.profiles.length ? state.profiles.map(profile => `<article class="library-card"><div class="profile-monogram">${escapeHTML(profile.name.charAt(0).toUpperCase())}</div><h2>${escapeHTML(profile.name)}</h2><p>Minecraft ${escapeHTML(profile.gameVersion)} · ${escapeHTML(profile.loader)}<br>${profile.source ? `Inspired by ${escapeHTML(profile.source.title)}` : 'A fresh start, made by you.'}</p><div class="library-actions"><span class="status-pill">PLANNED PROFILE</span><button class="text-button" data-remove="${escapeHTML(profile.id)}">Remove</button></div></article>`).join('') : '<div class="empty-state"><span class="empty-symbol">▦</span><h2>Every great world starts somewhere.</h2><p>Create your first profile, or discover a community modpack to make your own.</p><button id="empty-create" class="primary">＋ Create a profile</button></div>';
  if ($('#empty-create')) $('#empty-create').onclick = () => openCreate();
}

function openCreate(project = null, version = null) {
  state.source = project ? { id: project.id, title: project.title } : null;
  $('#create-form').reset(); $('#form-error').textContent = '';
  $('#profile-name').value = project?.title?.slice(0, 60) || '';
  $('#profile-source').textContent = project ? `Inspired by ${project.title}. This creates a profile record; it does not download the pack.` : '';
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
$('#results').onclick = event => { const card = event.target.closest('[data-project]'); if (card) showDetails(card.dataset.project); };
for (const selector of ['#sidebar-create', '#hero-create', '#library-create']) $(selector).onclick = () => openCreate();
$$('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
$('#create-form').onsubmit = async event => {
  event.preventDefault(); $('#save-profile').disabled = true; $('#form-error').textContent = '';
  try {
    state.profiles = await api.createProfile({ name: $('#profile-name').value, gameVersion: $('#profile-version').value, loader: $('#profile-loader').value, source: state.source });
    $('#create-dialog').close(); showPage('library'); toast('Profile created. Your next adventure has a home.');
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { $('#save-profile').disabled = false; }
};
$('#library-list').onclick = async event => {
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
