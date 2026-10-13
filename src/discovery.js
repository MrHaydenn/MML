let discoverProjects = new Map();
let currentProject = null;
let currentProjectVersions = [];
let installSequence = 0;
let minecraftPollTimer;

async function search() {
  const request = ++state.request;
  const grid = state.type === 'modpack';
  $('#results').className = grid ? 'project-grid' : 'project-list';
  $('.discovery-note').textContent = grid ? 'Popular modpacks · ranked by total downloads on Modrinth' : `${labels[state.type]}s for your Minecraft instances`;
  $('#results').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" aria-hidden="true"></div>').join('');
  $('#results-label').textContent = 'Searching Modrinth…';
  $('#previous').disabled = true; $('#next').disabled = true;
  try {
    const data = await api.search({ type: state.type, query: $('#search').value, loader: $('#loader-filter').value, version: $('#version-filter').value, sort: $('#sort').value, offset: state.offset });
    if (request !== state.request) return;
    discoverProjects = new Map(data.hits.map(project => [project.project_id, project]));
    state.total = data.total_hits;
    $('#connection').textContent = 'Modrinth connected'; $('#connection').classList.remove('offline');
    $('#results-label').textContent = `${data.total_hits.toLocaleString()} ${labels[state.type].toLowerCase()}${data.total_hits === 1 ? '' : 's'} to explore`;
    $('#results').innerHTML = data.hits.map(project => {
      const id = escapeHTML(project.project_id), title = escapeHTML(project.title);
      const cover = safeImage(project.featured_gallery || project.gallery?.[0]);
      const tags = (project.display_categories || project.categories || []).slice(0, 3).map(escapeHTML).join(' · ');
      const details = `<div class="card-title">${icon(project)}<div><button class="project-title" data-project="${id}">${title}</button><span class="card-author">by ${escapeHTML(project.author)}</span></div></div><p class="card-description">${escapeHTML(project.description)}</p><div class="card-meta"><span>↓ <b>${compact(project.downloads)}</b></span><span class="tags">${tags}</span></div>`;
      const actions = `<div class="content-actions"><button class="secondary" data-versions="${id}">Versions</button><button class="primary" data-install="${id}">Install ↓</button></div>`;
      return grid ? `<article class="project-card"><button class="card-cover cover-button" data-project="${id}" aria-label="View ${title}">${cover ? `<img src="${cover}" loading="lazy" alt="">` : `<div class="cover-placeholder">${escapeHTML(project.title.slice(0, 2).toUpperCase())}</div>`}<span class="type-badge">Modpack</span></button><div class="card-body">${details}${actions}</div></article>` : `<article class="project-row"><div class="row-body">${details}</div>${actions}</article>`;
    }).join('') || '<div class="empty-state"><h2>No projects found</h2><p>Try another search or clear a filter.</p></div>';
    $('#previous').disabled = state.offset === 0; $('#next').disabled = state.offset + 12 >= state.total;
    $('#page-label').textContent = `Page ${Math.floor(state.offset / 12) + 1}`;
  } catch (error) {
    if (request !== state.request) return;
    $('#connection').textContent = 'Modrinth unavailable'; $('#connection').classList.add('offline');
    $('#results-label').textContent = 'Could not load projects';
    $('#results').innerHTML = `<div class="empty-state"><h2>Could not load Modrinth</h2><p>${escapeHTML(error.message)}</p><button class="secondary" id="retry-search">Try again</button></div>`;
    $('#retry-search').onclick = search;
  }
}
function discoveryClick(event) {
  const install = event.target.closest('[data-install]');
  if (install) return openInstall(install.dataset.install);
  const versions = event.target.closest('[data-versions]');
  if (versions) return showDetails(versions.dataset.versions, 'versions');
  const project = event.target.closest('[data-project]');
  if (project) showDetails(project.dataset.project);
}
async function showDetails(id, tab = 'overview') {
  const request = ++state.details;
  showPage('project');
  $('#project-content').innerHTML = '<div class="skeleton"></div><p>Loading project…</p>';
  try {
    const [project, versions] = await Promise.all([api.project(id), api.versions(id)]);
    if (request !== state.details || state.page !== 'project') return;
    currentProject = project; currentProjectVersions = versions;
    $('#breadcrumb').textContent = `Discover / ${project.title}`;
    renderProject(tab);
  } catch (error) {
    if (request !== state.details || state.page !== 'project') return;
    $('#project-content').innerHTML = `<div class="empty-state"><h2>Project unavailable</h2><p>${escapeHTML(error.message)}</p><button id="project-retry" class="secondary">Try again</button></div>`;
    $('#project-retry').onclick = () => showDetails(id, tab);
  }
}
function renderProject(tab) {
  const p = currentProject, versions = currentProjectVersions;
  const markdown = DOMPurify.sanitize(marked.parse(String(p.body || p.description).slice(0, 500000)), { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'video', 'audio'], FORBID_ATTR: ['style', 'id', 'name'] });
  $('#project-content').innerHTML = `<div class="project-home-header">${icon(p)}<div><div class="eyebrow muted">${escapeHTML(labels[p.project_type])}</div><h1>${escapeHTML(p.title)}</h1><p>${escapeHTML(p.description)}</p><span class="card-author">↓ ${compact(p.downloads)} downloads · ${compact(p.followers)} followers</span></div><button class="primary" data-project-install>Install ↓</button></div><div class="project-home-tabs"><button class="${tab === 'overview' ? 'selected' : ''}" data-project-tab="overview">Overview</button><button class="${tab === 'versions' ? 'selected' : ''}" data-project-tab="versions">Versions (${versions.length})</button><button class="text-button" id="project-external">View on Modrinth ↗</button></div>${tab === 'overview' ? `<div class="project-markdown">${markdown}</div>` : `<div class="project-version-filters"><label>Minecraft version<select id="project-game-filter"><option value="">All Minecraft versions</option>${[...new Set(versions.flatMap(v => v.game_versions))].map(v => `<option>${escapeHTML(v)}</option>`).join('')}</select></label><label>Loader<select id="project-loader-filter"><option value="">All loaders</option>${[...new Set(versions.flatMap(v => v.loaders))].map(v => `<option>${escapeHTML(v)}</option>`).join('')}</select></label></div><div id="project-versions"></div>`}`;
  $('#project-content').querySelectorAll('img').forEach(img => { if (!safeImage(img.getAttribute('src'))) img.remove(); else { img.loading = 'lazy'; img.removeAttribute('srcset'); } });
  $('#project-external').onclick = () => api.openProject(p.id).catch(error => toast(error.message));
  if (tab === 'versions') {
    const render = () => {
      const filtered = versions.filter(v => (!$('#project-game-filter').value || v.game_versions.includes($('#project-game-filter').value)) && (!$('#project-loader-filter').value || v.loaders.includes($('#project-loader-filter').value)));
      $('#project-versions').innerHTML = filtered.slice(0, 200).map(v => `<div class="version-row"><div><strong>${escapeHTML(v.name)}</strong><small>${escapeHTML(v.game_versions.join(', '))} · ${escapeHTML(v.loaders.join(', '))} · ${escapeHTML(v.version_type)} · ${new Date(v.date_published).toLocaleDateString()}</small></div><button class="primary" data-version-install="${escapeHTML(v.id)}">Install</button></div>`).join('') || '<p>No versions match these filters.</p>';
    };
    $('#project-game-filter').onchange = render; $('#project-loader-filter').onchange = render; render();
  }
}
async function openInstall(projectId, versionId = '') {
  const sequence = ++installSequence, dialog = $('#install-dialog');
  $('#install-content').innerHTML = '<h2>Preparing installation…</h2><p>Loading versions and Minecraft instances.</p>';
  if (!dialog.open) dialog.showModal();
  try {
    const [project, versions, profiles] = await Promise.all([api.project(projectId), api.versions(projectId), api.library()]);
    if (sequence !== installSequence || !dialog.open) return;
    state.profiles = profiles;
    const pack = project.project_type === 'modpack';
    $('#install-content').innerHTML = `<div class="dialog-heading"><h2>Install ${escapeHTML(project.title)}</h2><button class="icon-button" id="install-close" aria-label="Close">×</button></div><p class="dialog-intro">${pack ? 'This pack will create a separate Minecraft instance with its declared game and loader version.' : 'Choose an instance. Automatic selection uses the newest version that declares compatibility with its Minecraft version and loader.'}</p><form id="install-form">${pack ? '' : `<label>Minecraft instance<select id="install-instance" required><option value="">Choose an instance…</option>${profiles.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · ${escapeHTML(p.gameVersion)} / ${escapeHTML(p.loader)}</option>`).join('')}</select></label>${profiles.length ? '' : '<p>Create an instance in My library before installing content.</p>'}`}<label>Project version<select id="install-version"><option value="">${pack ? 'Latest pack release' : 'Automatic · newest compatible version'}</option>${versions.map(v => `<option value="${escapeHTML(v.id)}">${escapeHTML(v.name)} · ${escapeHTML(v.game_versions.join(', '))} / ${escapeHTML(v.loaders.join(', '))}</option>`).join('')}</select></label><p id="install-hint" class="dialog-intro"></p><p id="install-error" class="error-text" role="alert"></p><button class="primary" id="install-preview" type="submit">Review installation →</button></form><div id="install-review"></div>`;
    $('#install-close').onclick = () => dialog.close();
    $('#install-version').value = versionId;
    if (!pack) {
      const previous = localStorage.getItem('mml-install-instance');
      if (profiles.some(p => p.id === previous)) $('#install-instance').value = previous;
      else if (profiles.length === 1) $('#install-instance').value = profiles[0].id;
    }
    const hint = () => {
      if (pack) { $('#install-hint').textContent = 'Required client files and pack overrides are downloaded and checked against their hashes. Optional client files are skipped.'; return; }
      const profile = profiles.find(p => p.id === $('#install-instance').value);
      const selected = versions.find(v => v.id === $('#install-version').value);
      const works = v => v.game_versions.includes(profile.gameVersion) && (project.project_type !== 'mod' || v.loaders.includes(profile.loader));
      $('#install-hint').textContent = !profile ? 'Select an instance to check compatibility.' : selected ? works(selected) ? 'The selected version declares compatibility with this instance.' : 'This version is incompatible. Review the warning before choosing whether to force installation.' : versions.some(works) ? 'A compatible version will be selected automatically.' : 'No compatible version is available. You will need to explicitly confirm the risk of breaking this instance.';
    };
    if (!pack) $('#install-instance').onchange = hint;
    $('#install-version').onchange = hint; hint();
    $('#install-form').onsubmit = async event => {
      event.preventDefault(); $('#install-error').textContent = '';
      if (!window.mml) { $('#install-error').textContent = 'Install content from the Windows application. The browser preview does not write game files.'; return; }
      const instanceId = pack ? undefined : $('#install-instance').value;
      if (instanceId) localStorage.setItem('mml-install-instance', instanceId);
      $('#install-preview').disabled = true;
      try {
        const plan = await window.mml.planInstall({ projectId, instanceId, versionId: $('#install-version').value || undefined });
        if (sequence !== installSequence || !dialog.open) return;
        $('#install-form').hidden = true;
        $('#install-review').innerHTML = `<h3>${escapeHTML(plan.version)} → ${escapeHTML(plan.instance.name)}</h3><p class="dialog-intro">Minecraft ${escapeHTML(plan.instance.gameVersion)} / ${escapeHTML(plan.instance.loader)} · ${plan.files} files</p><div class="dependency-preview">${plan.contents.map(r => `<div><strong>${escapeHTML(r.title)}</strong><small>${escapeHTML(r.version)}${r.explicit ? ' · Selected project' : ' · Required dependency / pack content'}${r.requiredBy.length ? ` · Used by ${escapeHTML(r.requiredBy.join(', '))}` : ''}</small></div>`).join('')}</div>${plan.warnings.length ? `<div class="compatibility-warning"><h3>Compatibility warning</h3>${plan.warnings.map(w => `<p>${escapeHTML(w)}</p>`).join('')}<label><input type="checkbox" id="install-confirm-risk"> I understand this may break the instance and want to install anyway.</label></div>` : '<p>Required dependencies will be installed and tracked.</p>'}<p id="install-progress" role="status"></p><button id="install-commit" class="primary" ${plan.warnings.length ? 'disabled' : ''}>${plan.warnings.length ? 'Install anyway' : 'Install now'} ↓</button>`;
        if ($('#install-confirm-risk')) $('#install-confirm-risk').onchange = () => { $('#install-commit').disabled = !$('#install-confirm-risk').checked; };
        $('#install-commit').onclick = async () => {
          $('#install-commit').disabled = true; $('#install-close').disabled = true;
          dialog.dataset.installing = 'true';
          try {
            const result = await window.mml.installContent({ planId: plan.planId, confirmWarnings: Boolean($('#install-confirm-risk')?.checked) });
            state.profiles = result.profiles; renderLibrary(); dialog.close(); showPage('library'); toast(`${project.title} installed into ${result.instance.name}.`);
          } catch (error) { $('#install-progress').textContent = error.message; $('#install-commit').disabled = false; }
          finally { delete dialog.dataset.installing; if ($('#install-close')) $('#install-close').disabled = false; }
        };
      } catch (error) { if (sequence === installSequence && dialog.open) $('#install-error').textContent = error.message; }
      finally { if ($('#install-preview')) $('#install-preview').disabled = false; }
    };
  } catch (error) {
    if (sequence !== installSequence || !dialog.open) return;
    $('#install-content').innerHTML = `<h2>Could not prepare installation</h2><p>${escapeHTML(error.message)}</p><button id="install-close" class="secondary">Close</button>`;
    $('#install-close').onclick = () => dialog.close();
  }
}
function renderMinecraft(value) {
  const active = value.accounts.find(a => a.id === value.active);
  $('#minecraft-sidebar-name').textContent = active ? active.name : 'Sign into Minecraft';
  $('#minecraft-sidebar-avatar').innerHTML = minecraftFace(active);
  minecraftPlayers = value;
  $('#minecraft-client-id').value = value.clientId || '';
  $('#minecraft-config').open = !value.configured;
  $('#minecraft-add').disabled = !window.mml || !value.configured;
  $('#minecraft-save-config').disabled = !window.mml;
  $('#minecraft-accounts').innerHTML = value.accounts.map(a => `<div class="minecraft-account"><div class="avatar">${escapeHTML(a.name[0])}</div><div><h2>${escapeHTML(a.name)}</h2><p>${a.id === value.active ? 'Active Minecraft account' : 'Connected account'} · ${a.expires > Date.now() ? 'Session ready' : 'Session needs refreshing'}</p></div><div class="content-actions">${a.id !== value.active ? `<button class="secondary" data-mc-active="${escapeHTML(a.id)}">Use account</button>` : ''}<button class="secondary" data-mc-refresh="${escapeHTML(a.id)}">Refresh</button><button class="text-button" data-mc-remove="${escapeHTML(a.id)}">Sign out</button></div></div>`).join('') || '<div class="notice">No Minecraft account connected. Sign in below to add your Java Edition player.</div>';
}
async function loadMinecraftAccounts() {
  if (!window.mml) { renderMinecraft({ accounts: [], active: null, configured: false }); $('#minecraft-error').textContent = 'Microsoft sign-in is available in the Windows application.'; return; }
  try { renderMinecraft(await window.mml.minecraftState()); } catch (error) { $('#minecraft-error').textContent = error.message; }
}
function initializeDiscovery() {
  $('#project-back').onclick = () => showPage('discover');
  $('#project-content').onclick = event => {
    const tab = event.target.closest('[data-project-tab]'); if (tab) return renderProject(tab.dataset.projectTab);
    const install = event.target.closest('[data-project-install]'); if (install) return openInstall(currentProject.id);
    const version = event.target.closest('[data-version-install]'); if (version) return openInstall(currentProject.id, version.dataset.versionInstall);
    const link = event.target.closest('.project-markdown a');
    if (link) { event.preventDefault(); try { const url = new URL(link.getAttribute('href')); if (url.protocol !== 'https:') return; if (window.mml) window.mml.openProjectLink(url.href).catch(error => toast(error.message)); else window.open(url.href, '_blank', 'noopener,noreferrer'); } catch {} }
  };
  $('#install-dialog').addEventListener('cancel', event => { if ($('#install-dialog').dataset.installing) event.preventDefault(); });
  $('#minecraft-menu').onclick = () => showPage('accounts');
  window.mml?.onMinecraftStatus?.(status => { $('#minecraft-wait').textContent = `${status.stage}…`; });
  $('#minecraft-open').onclick = () => window.mml.openMinecraftLogin().catch(error => { $('#minecraft-error').textContent = error.message; });
  $('#minecraft-save-config').onclick = async () => { try { renderMinecraft(await window.mml.configureMinecraft($('#minecraft-client-id').value.trim())); $('#minecraft-error').textContent = ''; } catch (error) { $('#minecraft-error').textContent = error.message; } };
  const poll = async () => {
    try {
      const result = await window.mml.pollMinecraft();
      if (result.pending) { $('#minecraft-wait').textContent = 'Waiting for you to finish sign-in on Microsoft’s website…'; minecraftPollTimer = setTimeout(poll, result.interval); }
      else { $('#minecraft-device').hidden = true; $('#minecraft-add').disabled = false; renderMinecraft(result); toast('Minecraft account connected.'); }
    } catch (error) { $('#minecraft-error').textContent = error.message; $('#minecraft-device').hidden = true; $('#minecraft-add').disabled = false; }
  };
  $('#minecraft-add').onclick = async () => {
    clearTimeout(minecraftPollTimer); $('#minecraft-add').disabled = true; $('#minecraft-error').textContent = '';
    try { const result = await window.mml.beginMinecraft(); $('#minecraft-device').hidden = false; $('#minecraft-code').textContent = result.userCode; $('#minecraft-wait').textContent = 'Code copied to clipboard. Paste it on Microsoft’s sign-in page.'; minecraftPollTimer = setTimeout(poll, result.interval); await window.mml.openMinecraftLogin(); }
    catch (error) { $('#minecraft-error').textContent = error.message; $('#minecraft-add').disabled = false; }
  };
  $('#minecraft-cancel').onclick = async () => { clearTimeout(minecraftPollTimer); await window.mml.cancelMinecraft(); $('#minecraft-device').hidden = true; $('#minecraft-add').disabled = false; };
  $('#minecraft-accounts').onclick = async event => {
    const active = event.target.closest('[data-mc-active]'), remove = event.target.closest('[data-mc-remove]'), refresh = event.target.closest('[data-mc-refresh]');
    const button = active || remove || refresh; if (!button) return;
    button.disabled = true;
    try { renderMinecraft(await (active ? window.mml.activateMinecraft(active.dataset.mcActive) : remove ? window.mml.removeMinecraft(remove.dataset.mcRemove) : window.mml.refreshMinecraft(refresh.dataset.mcRefresh))); $('#minecraft-error').textContent = ''; }
    catch (error) { $('#minecraft-error').textContent = error.message; button.disabled = false; }
  };
  if (window.mml) window.mml.onContentStatus(status => { if ($('#install-progress')) $('#install-progress').textContent = status.state === 'error' ? status.message : status.state === 'complete' ? 'Installation complete.' : `Downloading ${status.completed + 1}/${status.total}: ${status.file}`; });
  loadMinecraftAccounts();
}
