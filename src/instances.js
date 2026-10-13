let minecraftPlayers = {accounts:[],active:null}, instanceView = null;
const launchStatuses = new Map(), iconAttempts = new Set();
function minecraftFace(account) {
  const url = account?.skinUrl;
  if (typeof url === 'string' && /^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(url)) return `<span class="skin-face"><img class="skin-base" src="${escapeHTML(url)}" alt=""><img class="skin-hat" src="${escapeHTML(url)}" alt=""></span>`;
  return '<img src="assets/grass-block.svg" alt="" class="grass-avatar">';
}
function instanceIcon(profile) { const url=safeImage(profile.iconUrl);return `<img class="instance-image" src="${url || 'assets/grass-block.svg'}" alt="">`; }
function playButton(id) {
  const s=launchStatuses.get(id), busy=['preparing','stopping'].includes(s?.state);
  return `<button class="primary play-button" ${busy?'disabled':''} ${s?.state==='running'?`data-stop="${escapeHTML(id)}"`:`data-play="${escapeHTML(id)}"`}>${busy?(s.state==='preparing'?'Preparing…':'Stopping…'):s?.state==='running'?'■ Stop':'▶ Play'}</button>`;
}
function renderLibrary() {
  $('#library-count').textContent=state.profiles.length;
  $('#library-list').className='instance-grid';
  $('#library-list').innerHTML=state.profiles.map(p=>`<article class="library-card instance-tile" data-instance-tile="${escapeHTML(p.id)}"><button class="instance-tile-open" data-content="${escapeHTML(p.id)}" aria-label="Manage ${escapeHTML(p.name)}">${instanceIcon(p)}</button><h2><button class="project-title" data-content="${escapeHTML(p.id)}">${escapeHTML(p.name)}</button></h2><p>${escapeHTML(p.loader)} · Minecraft ${escapeHTML(p.gameVersion)}<br>${p.autoUpdate?'Latest release · auto-updated':p.source?(p.packUpdates===false?'Detached from modpack':escapeHTML(p.source.title)):'Your Minecraft instance'}</p><div class="tile-launch-status">${escapeHTML(launchStatuses.get(p.id)?.message || '')}</div><div class="library-actions">${playButton(p.id)}<button class="icon-button" data-content="${escapeHTML(p.id)}" aria-label="Manage instance">⚙</button>${p.autoUpdate?'<span class="status-pill">LATEST VANILLA</span>':`<button class="text-button" data-remove="${escapeHTML(p.id)}">Remove</button>`}</div></article>`).join('') || '<div class="empty-state"><h2>Create your first Minecraft instance</h2><p>The latest Vanilla instance is added when Minecraft’s version service is reachable.</p><button id="empty-create" class="primary">＋ Create an instance</button></div>';
  if($('#empty-create')) $('#empty-create').onclick=()=>openCreate();
  for(const p of state.profiles.filter(p=>p.source&&!p.iconUrl&&!iconAttempts.has(p.id))) {
    iconAttempts.add(p.id);
    api.project(p.source.id).then(async project=>{if(!safeImage(project.icon_url))return; p.iconUrl=project.icon_url;if(window.mml?.updateInstance)state.profiles=await window.mml.updateInstance(p.id,{iconUrl:p.iconUrl});if(state.page==='library')renderLibrary();}).catch(()=>{});
  }
}
async function playInstance(id) {
  if(!window.mml?.playInstance) return toast('Play is available in the Windows launcher.');
  try { launchStatuses.set(id,{state:'preparing',message:'Preparing Minecraft…'});renderLibrary();renderInstance();const s=await window.mml.playInstance(id);launchStatuses.set(id,s); }
  catch(error){launchStatuses.set(id,{state:'error',message:error.message});toast(error.message);}
  renderLibrary();renderInstance();
}
async function stopInstance(id) { try{launchStatuses.set(id,await window.mml.stopInstance(id));renderLibrary();renderInstance();}catch(error){toast(error.message);} }
async function showInstance(id) {
  const profile=state.profiles.find(p=>p.id===id);if(!profile)return;
  instanceView={id,profile,tab:'content',filter:'all',search:'',records:[],updates:null};showPage('instance');
  $('#breadcrumb').textContent=`My library / ${profile.name}`;renderInstance();
  try{
    const records=window.mml?await window.mml.installedContent(id):[];
    if(instanceView?.id!==id)return;instanceView.records=records;renderInstance();
    if(profile.source&&profile.packUpdates!==false&&window.mml?.instanceUpdates){const result=await window.mml.instanceUpdates(id);if(instanceView?.id===id){instanceView.updates=result;renderInstance();}}
  }catch(error){if(instanceView?.id===id)$('#instance-page-error').textContent=error.message;}
}
function renderInstance() {
  if(!instanceView || state.page!=='instance')return;
  const v=instanceView,p=v.profile,s=launchStatuses.get(v.id),pack=v.records.find(r=>r.type==='modpack');
  const rows=v.records.filter(r=>r.type!=='modpack'&&(v.filter==='all'||r.type===v.filter)&&`${r.title} ${r.version}`.toLowerCase().includes(v.search.toLowerCase()));
  const following=p.source&&p.packUpdates!==false;
  const tabs=['content','settings','logs'].map(tab=>`<button class="${v.tab===tab?'active':''}" data-instance-tab="${tab}">${tab[0].toUpperCase()+tab.slice(1)}</button>`).join('');
  let body='';
  if(v.tab==='content') body=`${p.source?`<div class="pack-summary"><div>${instanceIcon(p)}<span><h2>${escapeHTML(p.source.title)}</h2><p>${pack?escapeHTML(pack.version):'Modpack instance'} · ${following?'Following original modpack updates':'Detached · update notifications off'}</p></span></div>${v.updates?.available?`<button class="secondary" data-pack-project="${escapeHTML(p.source.id)}">Update available: ${escapeHTML(v.updates.latest)} ↗</button>`:''}</div>`:''}<div class="instance-content-heading"><h2>Installed content <small>${rows.length}</small></h2><button class="primary" data-instance-browse>Add content</button></div><input id="instance-search" class="instance-search" aria-label="Search installed content" placeholder="Search installed content…" value="${escapeHTML(v.search)}"><div class="instance-filters">${[['all','All'],['mod','Mods'],['resourcepack','Resource packs'],['shader','Shaders']].map(([key,label])=>`<button class="${v.filter===key?'active':''}" data-instance-filter="${key}">${label}</button>`).join('')}</div><div class="instance-table"><div class="instance-table-heading"><span>Project</span><span>Version</span><span>Enabled</span></div>${rows.map(r=>`<div class="instance-content-row ${r.enabled===false?'disabled-content':''}"><div><strong>${escapeHTML(r.title)}</strong><small>${escapeHTML(r.type)}${r.requiredBy?.length?' · Required by '+escapeHTML(r.requiredBy.join(', ')):''}</small></div><div>${escapeHTML(r.version)}<small>${escapeHTML(r.files?.[0] || '')}</small></div>${r.type==='mod'?`<button class="mod-switch ${r.enabled===false?'':'enabled'}" role="switch" aria-checked="${r.enabled!==false}" aria-label="Enable ${escapeHTML(r.title)}" data-toggle-mod="${escapeHTML(r.projectId)}" ${['running','preparing','stopping'].includes(s?.state)?'disabled':''}><span></span></button>`:'<span class="muted">—</span>'}</div>`).join('') || '<div class="empty-state"><p>No matching content. Add mods, resource packs or shaders from Discover.</p></div>'}</div>`;
  else if(v.tab==='settings') body=`<form id="instance-settings-form" class="settings-card instance-settings"><h2>Instance settings</h2><label>Instance name<input id="instance-name" maxlength="60" required value="${escapeHTML(p.name)}"></label><label>Maximum memory (MB)<input id="instance-memory" type="number" min="1024" max="32768" step="256" required value="${p.memoryMb||4096}"></label><label class="checkbox-label"><input id="instance-sync" type="checkbox" ${p.syncSettings?'checked':''}>Sync game settings across opted-in instances</label><p>Shares game options (including resource-pack selections) and saved servers. Settings are applied before play and saved when Minecraft exits. The previous local settings are backed up. Mods, pack files and worlds stay separate.</p>${p.source?`<label class="checkbox-label"><input id="instance-follow" type="checkbox" ${following?'checked':''}>Follow updates from the original modpack</label><p>Turn this off to detach the instance and stop its modpack update notifications. Your installed content is kept.</p>`:''}<button class="primary" type="submit" ${['running','preparing','stopping'].includes(s?.state)?'disabled':''}>Save instance settings</button></form>`;
  else body='<div class="settings-card"><div class="section-heading"><h2>Launch log</h2><button class="secondary" data-refresh-log>Refresh log</button></div><pre id="instance-log">Loading log…</pre></div>';
  $('#instance-page-content').innerHTML=`<button class="text-button" data-instance-back>← My library</button><div class="instance-hero">${instanceIcon(p)}<div><h1>${escapeHTML(p.name)}</h1><p>${escapeHTML(p.loader)}${p.loaderVersion?' '+escapeHTML(p.loaderVersion):''} · Minecraft ${escapeHTML(p.gameVersion)}</p><p class="instance-status">${escapeHTML(s?.message||'Ready to play')}</p></div>${playButton(v.id)}</div><div class="instance-workspace"><div class="instance-main"><div class="instance-tabs">${tabs}<button data-instance-files>Open folder ↗</button></div><p id="instance-page-error" class="error-text" role="alert"></p>${body}</div><aside class="instance-aside"><h3>Playing as</h3><div class="instance-player">${minecraftFace(minecraftPlayers.accounts.find(a=>a.id===minecraftPlayers.active))}<select id="instance-player-select" aria-label="Minecraft account"><option value="">Select Minecraft account</option>${minecraftPlayers.accounts.map(a=>`<option value="${escapeHTML(a.id)}" ${a.id===minecraftPlayers.active?'selected':''}>${escapeHTML(a.name)}</option>`).join('')}</select></div><button class="text-button" data-instance-accounts>Manage Minecraft accounts →</button><div class="instance-aside-note"><h3>Your settings, together</h3><p>Enable settings sync in this instance’s Settings tab to share game options and saved servers.</p></div></aside></div>`;
  $('#instance-player-select').onchange=async event=>{if(!event.target.value)return;try{renderMinecraft(await window.mml.activateMinecraft(event.target.value));renderInstance();}catch(error){$('#instance-page-error').textContent=error.message;}};
  if(v.tab==='settings')$('#instance-settings-form').onsubmit=async event=>{
    event.preventDefault();try{state.profiles=await window.mml.updateInstance(v.id,{name:$('#instance-name').value,memoryMb:Number($('#instance-memory').value),syncSettings:$('#instance-sync').checked,...(p.source?{packUpdates:$('#instance-follow').checked}:{})});v.profile=state.profiles.find(p=>p.id===v.id);v.updates=null;renderLibrary();renderInstance();toast('Instance settings saved.');}catch(error){$('#instance-page-error').textContent=error.message;}
  };
  if(v.tab==='content')$('#instance-search').oninput=event=>{const position=event.target.selectionStart;v.search=event.target.value;renderInstance();$('#instance-search').focus();$('#instance-search').setSelectionRange(position,position);};
  if(v.tab==='logs')loadInstanceLog();
}
async function loadInstanceLog(){const id=instanceView?.id;try{const log=window.mml?await window.mml.instanceLogs(id):'Logs are available in the Windows launcher.';if(instanceView?.id===id&&$('#instance-log'))$('#instance-log').textContent=log;}catch(error){if($('#instance-log'))$('#instance-log').textContent=error.message;}}
function initializeInstances(){
  document.addEventListener('error',event=>{if(event.target.matches?.('.instance-image')&&!event.target.src.endsWith('grass-block.svg'))event.target.src='assets/grass-block.svg';},true);
  $('#instance-page-content').onclick=async event=>{
    const button=event.target.closest('button');if(!button)return;
    const d=button.dataset,v=instanceView;
    if(d.play)return playInstance(d.play);if(d.stop)return stopInstance(d.stop);
    if(d.instanceBack!==undefined)return showPage('library');
    if(d.instanceTab){v.tab=d.instanceTab;return renderInstance();}
    if(d.instanceFilter){v.filter=d.instanceFilter;return renderInstance();}
    if(d.instanceFiles!==undefined)return window.mml?window.mml.openInstance(v.id).catch(error=>toast(error.message)):toast('Instance folders are available in the Windows launcher.');
    if(d.refreshLog!==undefined)return loadInstanceLog();
    if(d.instanceAccounts!==undefined)return showPage('accounts');
    if(d.instanceBrowse!==undefined){localStorage.setItem('mml-install-instance',v.id);return showPage('discover');}
    if(d.packProject)return showDetails(d.packProject,'versions');
    if(d.toggleMod){
      const record=v.records.find(r=>r.projectId===d.toggleMod),enabled=record.enabled===false;
      if(!enabled&&record.requiredBy?.length&&!window.confirm(`${record.title} is required by ${record.requiredBy.join(', ')}. Disabling it may stop this instance from working. Continue?`))return;
      button.disabled=true;
      try{v.records=await window.mml.toggleMod({instanceId:v.id,projectId:record.projectId,enabled});renderInstance();}catch(error){$('#instance-page-error').textContent=error.message;button.disabled=false;}
    }
  };
  window.mml?.onLauncherStatus?.(status=>{launchStatuses.set(status.instanceId,status);renderLibrary();renderInstance();});
  window.mml?.launcherState?.().then(statuses=>{for(const s of statuses)launchStatuses.set(s.instanceId,s);renderLibrary();}).catch(()=>{});
}
