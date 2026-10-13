const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const yauzl = require('yauzl');

const MAX_FILE = 512 * 1024 * 1024;
const folders = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' };
function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || /[<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Content contains an unsafe Windows file path.');
  return value;
}
function compatible(version, profile, type) {
  return version.game_versions.includes(profile.gameVersion) && (type !== 'mod' || version.loaders.includes(profile.loader));
}
function newest(versions) { return [...versions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published)); }
function graph(records) {
  return records.map(record => ({ ...record, requiredBy: records.filter(other => other.dependencies?.includes(record.projectId)).map(other => other.title) }));
}
function packMembers(records) {
  const root = records.find(r => r.type === 'modpack');
  return new Set([...(root?.dependencies || []), ...records.filter(r=>r.packManaged).map(r=>r.projectId)]);
}
async function matchesFile(file, hashes) {
  try { const bytes=await fs.readFile(file), entries=Object.entries(hashes||{}).filter(([algorithm])=>['sha1','sha256','sha512'].includes(algorithm));return entries.length>0&&entries.every(([algorithm,hash])=>createHash(algorithm).update(bytes).digest('hex')===hash); }
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function allowedDownload(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || !['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'resources.download.minecraft.net'].includes(u.hostname)) throw new Error('This pack uses an unsupported download host.');
  return u.href;
}
async function download(file, destination, fetcher = fetch) {
  if (!file.hashes || (!/^[a-f0-9]{128}$/i.test(file.hashes.sha512 || '') && !/^[a-f0-9]{40}$/i.test(file.hashes.sha1 || ''))) throw new Error('Content is missing a valid download checksum.');
  let url = allowedDownload(file.url || file.downloads?.[0]);
  let response;
  for (let i = 0; i < 6; i++) {
    response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel(); url = allowedDownload(new URL(response.headers.get('location'), url).href);
  }
  if (!response.ok || !response.body) throw new Error('Content download failed. Nothing was installed.');
  const hash512 = createHash('sha512'), hash1 = createHash('sha1');
  let length = 0;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const handle = await fs.open(destination, 'wx');
  try {
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_FILE || (Number.isFinite(file.size) && length > file.size)) throw new Error('Download exceeded its declared size.');
      hash512.update(chunk); hash1.update(chunk); await handle.writeFile(chunk);
    }
    if (Number.isFinite(file.size) && length !== file.size) throw new Error('Download size does not match.');
    const a = hash512.digest('hex'), b = hash1.digest('hex');
    if ((file.hashes.sha512 && file.hashes.sha512.toLowerCase() !== a) || (file.hashes.sha1 && file.hashes.sha1.toLowerCase() !== b)) throw new Error('Download checksum does not match. Nothing was installed.');
  } finally { await handle.close(); }
}
async function unzip(file, directory) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
  let total = 0, count = 0;
  const paths = new Set();
  await new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', resolve);
    zip.on('entry', async entry => {
      try {
        if (++count > 10000 || (total += entry.uncompressedSize) > MAX_FILE || entry.uncompressedSize > MAX_FILE) throw new Error('Pack archive is too large.');
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('Pack archives cannot contain symbolic links.');
        const name = entry.fileName.endsWith('/') ? entry.fileName.slice(0, -1) : entry.fileName;
        safePath(name);
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        if (paths.has(name.toLowerCase())) throw new Error('Pack archive contains duplicate paths.');
        paths.add(name.toLowerCase());
        const stream = await new Promise((yes, no) => zip.openReadStream(entry, (error, value) => error ? no(error) : yes(value)));
        const target = path.join(directory, name); await fs.mkdir(path.dirname(target), { recursive: true });
        const handle = await fs.open(target, 'wx'); let bytes = 0;
        try { for await (const chunk of stream) { if ((bytes += chunk.length) > entry.uncompressedSize) throw new Error('Invalid archive size.'); await handle.writeFile(chunk); } }
        finally { await handle.close(); }
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}
async function assertNoLinks(directory) {
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Instances containing symbolic links cannot be modified.');
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Instances containing symbolic links cannot be modified.');
    if (entry.isDirectory()) await assertNoLinks(path.join(directory, entry.name));
  }
}

function createContent({ directory, library, api, fetcher = fetch, notify = () => {} }) {
  const plans = new Map(); let busy = false;
  const instancePath = id => { if (!/^(default-vanilla|[a-f0-9-]{36})$/.test(id || '')) throw new Error('Invalid instance.'); return path.join(directory, id); };
  async function read(id) {
    try { return graph(JSON.parse(await fs.readFile(path.join(instancePath(id), 'mml-content.json'), 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error('Installed content metadata could not be read; existing files were preserved.'); }
  }
  async function recover(id) {
    const target = instancePath(id), backup = target + '.backup';
    try { await fs.access(backup); } catch { return; }
    try { await fs.access(target); await fs.rm(backup, { recursive: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await fs.rename(backup, target); }
  }
  async function plan(input) {
    for (const [key, value] of plans) if (value.expires < Date.now()) { await fs.rm(value.work, { recursive: true, force: true }); plans.delete(key); }
    if (plans.size >= 10) throw new Error('Close old installation previews before starting another.');
    const project = await api.project(input.projectId);
    const profile = project.project_type === 'modpack' && !input.syncPack ? { id: randomUUID(), name: project.title.slice(0, 60), gameVersion: '1.21.1', loader: 'vanilla', iconUrl: project.icon_url || null, packUpdates: true, source: { id: project.id, title: project.title }, createdAt: new Date().toISOString() } : (await library.list()).find(p => p.id === input.instanceId);
    if (!profile) throw new Error('Choose a Minecraft instance first.');
    await recover(profile.id);
    const before = await read(profile.id);
    const members=packMembers(before), oldPack=before.find(r=>r.type==='modpack');
    if(input.syncPack && (project.project_type!=='modpack'||profile.packUpdates===false||profile.source?.id!==project.id)) throw new Error('This instance is not linked to that modpack.');
    if(!input.syncPack && profile.source && profile.packUpdates!==false && members.has(project.id)) throw new Error('This content is managed by the linked modpack. Unlink the instance before changing its required versions.');
    const versions = newest(await api.versions(project.id));
    const current=versions.find(v=>v.id===oldPack?.versionId);
    const selected = input.syncPack ? (input.versionId?versions.find(v=>v.id===input.versionId):current) || versions.find(v=>v.version_type==='release' && v.game_versions.includes(profile.gameVersion) && v.loaders.includes(profile.loader) && (!current || new Date(v.date_published)>=new Date(current.date_published))) || current : input.versionId ? versions.find(v => v.id === input.versionId) : versions.find(v => project.project_type === 'modpack' || compatible(v, profile, project.project_type)) || versions[0];
    if(input.versionId&&!versions.some(v=>v.id===input.versionId))throw new Error('The selected version is no longer available.');
    if (!selected) throw new Error('This project has no downloadable versions.');
    const id = randomUUID(), work = path.join(directory, '.plan-' + id);
    const value = { id, work, profile:{...profile}, before: JSON.stringify(before), beforeRecords:before, members, syncPack:Boolean(input.syncPack), originalProfile:{...profile}, project, selected, warnings: [], records: [], files: [], expires: Date.now() + 600000, isPack: project.project_type === 'modpack' };
    await fs.mkdir(work, { recursive: true });
    try {
      if (value.isPack) await preparePack(value);
      else await resolve(value, project, selected, new Set());
      if (project.project_type === 'shader' && ![...before, ...value.records].some(r => /iris|oculus|optifine/i.test(r.title))) value.warnings.push('Shader packs need a compatible shader loader such as Iris or OptiFine; MML will not add one unless the project declares it as a required dependency.');
      if (!value.isPack) {
        for (const record of value.records) {
          const old = before.find(r => r.projectId === record.projectId);
          if (old && old.versionId !== record.versionId && old.requiredBy.length) value.warnings.push(`Replacing ${old.title} may affect: ${old.requiredBy.join(', ')}.`);
          for (const dependency of record.incompatible || []) if (before.some(r => dependency.project_id === r.projectId || dependency.version_id === r.versionId)) value.warnings.push(`${record.title} declares an incompatibility with installed content.`);
        }
      }
      if (value.files.length > 2000) throw new Error('This installation contains too many files.');
      if (value.files.reduce((sum, f) => sum + (f.size || 0), 0) > 4 * 1024 * 1024 * 1024) throw new Error('This installation exceeds the 4 GB content limit.');
      if(value.syncPack&&oldPack?.versionId!==selected.id&&before.some(r=>r.type!=='modpack'&&!members.has(r.projectId)))value.warnings.push('Additional content will be kept unchanged. Verify that your added mods, resource packs and shaders are compatible with the updated pack before playing.');
      plans.set(id, value);
      return { planId: id, instance: value.profile, project: project.title, version: selected.name, warnings: [...new Set(value.warnings)], contents: graph(value.records), files: value.files.length, newInstance: value.isPack&&!value.syncPack };
    } catch (error) { await fs.rm(work, { recursive: true, force: true }); throw error; }
  }
  async function resolve(value, project, version, visiting) {
    const pinned=value.beforeRecords.find(r=>r.projectId===project.id);
    if(value.profile.source && value.profile.packUpdates!==false && value.members.has(project.id) && pinned) {
      if(pinned.versionId!==version.id) throw new Error(`${project.title} requires a different version than the linked modpack. Unlink the pack or choose a compatible additional mod.`);
      return;
    }
    const existing = value.records.find(r => r.projectId === project.id);
    if (existing) { if (existing.versionId !== version.id) throw new Error(`Required dependencies request conflicting versions of ${project.title}.`); return; }
    if (visiting.size > 150) throw new Error('Dependency graph is too large.');
    visiting.add(project.id);
    if (!compatible(version, value.profile, project.project_type)) value.warnings.push(`${project.title} ${version.name} does not declare compatibility with Minecraft ${value.profile.gameVersion} / ${value.profile.loader}. Installing it may break this instance.`);
    const primary = version.files.find(f => f.primary) || version.files[0];
    if (!primary || !folders[project.project_type]) throw new Error(`No installable client file for ${project.title}.`);
    const filePath = safePath(folders[project.project_type] + '/' + safePath(primary.filename));
    const record = { projectId: project.id, title: project.title, type: project.project_type, versionId: version.id, version: version.name, files: [filePath], dependencies: [], explicit: project.id === value.project.id, incompatible: version.dependencies.filter(d => d.dependency_type === 'incompatible') };
    value.records.push(record); value.files.push({ ...primary, path: filePath, owner: project.id });
    for (const dep of version.dependencies.filter(d => d.dependency_type === 'required')) {
      let depVersion, depProject;
      if (dep.version_id) { depVersion = await api.version(dep.version_id); depProject = await api.project(depVersion.project_id); }
      else if (dep.project_id) {
        depProject = await api.project(dep.project_id);
        const pinned=value.profile.source&&value.profile.packUpdates!==false&&value.members.has(dep.project_id)&&value.beforeRecords.find(r=>r.projectId===dep.project_id);
        depVersion = pinned ? await api.version(pinned.versionId) : newest(await api.versions(dep.project_id)).find(v => compatible(v, value.profile, depProject.project_type));
      } else throw new Error(`${project.title} has an unresolved required dependency.`);
      if (!depVersion) throw new Error(`No compatible required dependency for ${depProject.title}. Installation stopped.`);
      record.dependencies.push(depProject.id);
      await resolve(value, depProject, depVersion, visiting);
    }
  }
  async function preparePack(value) {
    const primary = value.selected.files.find(f => f.primary && f.filename.endsWith('.mrpack')) || value.selected.files.find(f => f.filename.endsWith('.mrpack'));
    if (!primary) throw new Error('Only Modrinth .mrpack packs can be installed.');
    const archive = path.join(value.work, 'pack.mrpack'), extracted = path.join(value.work, 'archive');
    await download(primary, archive, fetcher); await unzip(archive, extracted);
    const indexPath = path.join(extracted, 'modrinth.index.json');
    if ((await fs.stat(indexPath)).size > 8 * 1024 * 1024) throw new Error('Pack manifest is too large.');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    if (index.formatVersion !== 1 || index.game !== 'minecraft' || !Array.isArray(index.files) || !index.dependencies || !/^\d+\.\d+(\.\d+)?$/.test(index.dependencies.minecraft)) throw new Error('Invalid or unsupported Modrinth pack manifest.');
    const loaders = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };
    if (Object.keys(index.dependencies).some(k => k !== 'minecraft' && !loaders[k])) throw new Error('This pack requires an unsupported game component.');
    const loader = Object.keys(loaders).filter(k => index.dependencies[k]);
    if (loader.length > 1) throw new Error('This pack declares multiple incompatible loaders.');
    if(value.syncPack && (index.dependencies.minecraft!==value.profile.gameVersion || (loaders[loader[0]]||'vanilla')!==value.profile.loader)) value.warnings.push('This version changes Minecraft or its loader. Additional content may be incompatible and must be verified before playing.');
    value.profile.gameVersion = index.dependencies.minecraft; value.profile.loader = loaders[loader[0]] || 'vanilla'; value.profile.loaderVersion = index.dependencies[loader[0]] || null;
    for (const file of index.files) {
      safePath(file.path);
      if (['unsupported', 'optional'].includes(file.env?.client)) continue;
      value.files.push({ ...file, size: file.fileSize, url: file.downloads?.[0], path: file.path });
    }
    const hashes = value.files.map(f => f.hashes.sha1).filter(Boolean);
    const found = {};
    for (let i = 0; i < hashes.length; i += 100) Object.assign(found, await api.versionFiles(hashes.slice(i, i + 100)));
    const included = new Set(Object.values(found).map(v => v.project_id));
    for (const version of Object.values(found)) {
      if (value.records.some(r => r.projectId === version.project_id)) continue;
      const files=value.files.filter(f => found[f.hashes.sha1]?.project_id === version.project_id).map(f=>f.path);
      const type=files[0]?.startsWith('resourcepacks/')?'resourcepack':files[0]?.startsWith('shaderpacks/')?'shader':'mod';
      value.records.push({ projectId: version.project_id, title: version.name, versionId: version.id, version: version.name, type, packManaged:true, files, dependencies: version.dependencies.filter(d => d.dependency_type === 'required').map(d => d.project_id || Object.values(found).find(v => v.id === d.version_id)?.project_id).filter(id => included.has(id)), explicit: false });
    }
    const owned = new Set(value.records.flatMap(r => r.files));
    const extra = value.files.filter(f => !owned.has(f.path)).map(f => f.path);
    async function overrideFiles(folder, prefix = '') {
      let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) { const name = prefix + entry.name; if (entry.isDirectory()) await overrideFiles(path.join(folder, entry.name), name + '/'); else extra.push(safePath(name)); }
    }
    await overrideFiles(path.join(extracted, 'overrides')); await overrideFiles(path.join(extracted, 'client-overrides'));
    value.records.unshift({ projectId: value.project.id, title: value.project.title, versionId: value.selected.id, version: value.selected.name, type: 'modpack', files: [...new Set(extra)], dependencies: [...included], explicit: true });
    value.extracted = extracted;
    value.packManifest={versionId:value.selected.id,files:value.files.map(f=>({path:f.path,hashes:f.hashes}))};
    for(const name of extra){for(const folder of ['client-overrides','overrides']){try{const bytes=await fs.readFile(path.join(extracted,folder,name));value.packManifest.files=value.packManifest.files.filter(f=>f.path!==name);value.packManifest.files.push({path:name,hashes:{sha256:createHash('sha256').update(bytes).digest('hex')}});break;}catch(error){if(error.code!=='ENOENT')throw error;}}}
    // Keep bundled JARs editable even when Modrinth cannot identify their hashes.
    const root=value.records.find(r=>r.type==='modpack');
    for(const file of value.packManifest.files.filter(f=>/^mods\/.+\.jar$/i.test(f.path)&&!value.records.some(r=>r.type!=='modpack'&&r.files.includes(f.path)))){
      const projectId='pack-file-'+createHash('sha1').update(file.path).digest('hex').slice(0,16);
      value.records.push({projectId,title:path.posix.basename(file.path),type:'mod',versionId:file.hashes.sha512||file.hashes.sha256||file.hashes.sha1,version:'Bundled file',files:[file.path],dependencies:[],explicit:false,packManaged:true,localFile:true});
      root.files=root.files.filter(name=>name!==file.path);root.dependencies.push(projectId);
    }
  }
  async function install(input) {
    if (busy) throw new Error('An installation is already running.');
    const value = plans.get(input.planId);
    if (!value || value.expires < Date.now()) throw new Error('Installation preview expired. Preview it again.');
    if (value.warnings.length && input.confirmWarnings !== true) throw new Error('Confirm the compatibility warnings before installing.');
    busy = true;
    const target = instancePath(value.profile.id), backup = target + '.backup', stage = path.join(value.work, 'instance');
    let moved = false, committed = false;
    try {
      await recover(value.profile.id);
      if (JSON.stringify(await read(value.profile.id)) !== value.before) throw new Error('Instance content changed. Preview the installation again.');
      const profile = (await library.list()).find(p => p.id === value.profile.id);
      if ((!value.isPack||value.syncPack) && (!profile || profile.gameVersion !== value.originalProfile.gameVersion || profile.loader !== value.originalProfile.loader || (value.syncPack&&profile.packUpdates===false))) throw new Error('Instance changed. Preview the installation again.');
      await fs.rm(stage, { recursive: true, force: true });
      try { await fs.access(target); await assertNoLinks(target); await fs.cp(target, stage, { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(stage, { recursive: true }); }
      let records = await read(value.profile.id);
      let oldManifest={files:[]};try{oldManifest=JSON.parse(await fs.readFile(path.join(target,'mml-pack.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      const preserve=new Set();
      if(value.syncPack){
        const additional=records.filter(r=>r.type!=='modpack'&&!value.members.has(r.projectId));
        for(const record of additional){
          if(value.records.some(r=>r.projectId===record.projectId))throw new Error(`${record.title} is additional content that the new pack also includes. It was kept unchanged; unlink the pack or resolve this overlap before updating.`);
          if(record.versionId){const version=await api.version(record.versionId);for(const dep of version.dependencies.filter(d=>d.dependency_type==='required')){
            const exact=dep.version_id?await api.version(dep.version_id):null,id=dep.project_id||exact?.project_id,newRequired=value.records.find(r=>r.projectId===id);
            if(exact&&newRequired&&newRequired.versionId!==exact.id)throw new Error(`${record.title} conflicts with the linked pack update. Unlink the pack or remove the conflicting additional content first.`);
            if(value.members.has(id)&&!newRequired)preserve.add(id);
          }}
        }
        // Preserve a removed pack dependency when additional content still requires it.
        let added=true;while(added){added=false;for(const record of records.filter(r=>preserve.has(r.projectId)))for(const dep of record.dependencies||[])if(value.members.has(dep)&&!value.records.some(r=>r.projectId===dep)&&!preserve.has(dep)){preserve.add(dep);added=true;}}
        const oldManaged=records.filter(r=>(r.type==='modpack'||value.members.has(r.projectId))&&!preserve.has(r.projectId));
        for(const record of oldManaged)for(const name of record.files){
          const file=path.join(stage,'game',safePath(name)), required=/^(mods|resourcepacks|shaderpacks)\//.test(name), hash=oldManifest.files.find(f=>f.path===name)?.hashes;
          if(required || (hash&&await matchesFile(file,hash))) {await fs.rm(file,{force:true});await fs.rm(file+'.disabled',{force:true});}
        }
        records=records.filter(r=>!oldManaged.includes(r)).map(r=>preserve.has(r.projectId)?{...r,packManaged:false}:r);
        for(const r of value.records)if(r.type!=='modpack'){const old=value.beforeRecords.find(v=>v.projectId===r.projectId);r.enabled=old?.versionId===r.versionId?old.enabled!==false:true;}
      }
      for (const record of value.records) {
        const old = records.find(r => r.projectId === record.projectId);
        if (old) { if(!value.syncPack)record.enabled = old.enabled !== false; for (const file of old.files) await fs.rm(path.join(stage, 'game', safePath(file) + (old.enabled === false ? '.disabled' : '')), { force: true }); }
      }
      const destinations = new Map();
      if(value.syncPack)for(const entry of value.packManifest.files){const key=entry.path.toLowerCase();const collision=records.find(r=>!value.records.some(v=>v.projectId===r.projectId)&&r.files.some(f=>f.toLowerCase()===key));if(collision)throw new Error(`File conflicts with ${collision.title}; existing files were preserved.`);}
      for (let i = 0; i < value.files.length; i++) {
        const file = value.files[i], name = safePath(file.path), key = name.toLowerCase();
        if (destinations.has(key)) throw new Error('Projects contain conflicting filenames.');
        destinations.set(key, true);
        const collision = records.find(r => !value.records.some(v => v.projectId === r.projectId) && r.files.some(f => f.toLowerCase() === key));
        if (collision) throw new Error(`File conflicts with ${collision.title}; existing files were preserved.`);
        const owner = value.records.find(r => r.files.includes(name));
        const dest = path.join(stage, 'game', name + (owner?.enabled === false ? '.disabled' : ''));
        try { await fs.access(dest); if(value.syncPack&&!/^(mods|resourcepacks|shaderpacks)\//.test(name))continue;throw new Error(`Refusing to overwrite an untracked file: ${name}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        notify({ state: 'downloading', completed: i, total: value.files.length, file: name });
        await download(file, dest, fetcher);
      }
      if (value.isPack) {
        for (const folder of ['overrides', 'client-overrides']) {
          const source = path.join(value.extracted, folder);
          try { await fs.access(source); if(!value.syncPack)await fs.cp(source, path.join(stage, 'game'), { recursive: true, force: true });else for(const entry of value.packManifest.files.filter(f=>f.hashes.sha256)){const from=path.join(source,entry.path),owner=value.records.find(r=>r.files.includes(entry.path)),to=path.join(stage,'game',entry.path+(owner?.enabled===false?'.disabled':''));try{await fs.access(from);if(!await matchesFile(from,entry.hashes))continue;await fs.mkdir(path.dirname(to),{recursive:true});if(!/^(mods|resourcepacks|shaderpacks)\//.test(entry.path)){try{await fs.access(to);continue;}catch(error){if(error.code!=='ENOENT')throw error;}}if(/^(mods|resourcepacks|shaderpacks)\//.test(entry.path)&&!value.files.some(f=>f.path===entry.path)){try{await fs.access(to);throw new Error(`Refusing to overwrite an untracked file: ${entry.path}`);}catch(error){if(error.code!=='ENOENT')throw error;}}await fs.copyFile(from,to);}catch(error){if(error.code!=='ENOENT')throw error;}} } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      for (const record of value.records) if (records.some(old => old.projectId === record.projectId && old.explicit)) record.explicit = true;
      records = records.filter(r => !value.records.some(v => v.projectId === r.projectId)).concat(value.records);
      await fs.writeFile(path.join(stage, 'mml-content.json'), JSON.stringify(records, null, 2));
      await fs.writeFile(path.join(stage, 'instance.json'), JSON.stringify(value.profile, null, 2));
      if(value.packManifest)await fs.writeFile(path.join(stage,'mml-pack.json'),JSON.stringify(value.packManifest,null,2));
      try { await fs.rename(target, backup); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(stage, target); committed = true;
      if (value.isPack&&!value.syncPack) await library.add(value.profile);
      if(value.syncPack)await library.update(value.profile.id,{loaderVersion:value.profile.loaderVersion,gameVersion:value.profile.gameVersion,loader:value.profile.loader});
      if (moved) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
      plans.delete(value.id); await fs.rm(value.work, { recursive: true, force: true }).catch(() => {});
      notify({ state: 'complete', completed: value.files.length, total: value.files.length });
      return { instance: value.profile, contents: graph(records), profiles: await library.list() };
    } catch (error) {
      if (committed) await fs.rm(target, { recursive: true, force: true });
      if (moved) await fs.rename(backup, target);
      notify({ state: 'error', message: error.message }); throw error;
    } finally { busy = false; }
  }
  async function toggle({ instanceId, projectId, enabled }) {
    if (busy) throw new Error('Wait for content installation to finish.');
    if (typeof enabled !== 'boolean') throw new Error('Invalid mod state.');
    busy = true; const moved = [];
    try {
      await recover(instanceId);
      const records = await read(instanceId), record = records.find(r => r.projectId === projectId);
      const profile=(await library.list()).find(p=>p.id===instanceId);
      if(!profile)throw new Error('Instance not found.');
      if (!record || record.type !== 'mod') throw new Error('Only installed mods can be toggled.');
      if ((record.enabled !== false) === enabled) return records;
      await assertNoLinks(instancePath(instanceId));
      for (const name of record.files) {
        const original = path.join(instancePath(instanceId), 'game', safePath(name));
        const from = enabled ? original + '.disabled' : original, to = enabled ? original : original + '.disabled';
        try { await fs.access(to); throw new Error('A mod file with this state already exists. Existing files were preserved.'); } catch(error) { if (error.code !== 'ENOENT') throw error; }
        await fs.rename(from, to); moved.push([from,to]);
      }
      record.enabled = enabled;
      const file = path.join(instancePath(instanceId), 'mml-content.json'); await fs.writeFile(file + '.tmp', JSON.stringify(records,null,2)); await fs.rename(file + '.tmp',file);
      return graph(records);
    } catch(error) { for(const [from,to] of moved.reverse()) await fs.rename(to,from); throw error; }
    finally { busy = false; }
  }
  const updateCache=new Map();
  async function checkUpdates(id){
    const profile=(await library.list()).find(p=>p.id===id);if(!profile)throw new Error('Instance not found.');
    const records=await read(id),key=JSON.stringify([profile.gameVersion,profile.loader,profile.packUpdates,records.map(r=>r.versionId)]),cached=updateCache.get(id);
    if(cached&&cached.key===key&&Date.now()-cached.at<300000)return cached.value;
    const members=packMembers(records),following=Boolean(profile.source&&profile.packUpdates!==false),items=records.filter(r=>!r.localFile&&r.type!=='modpack'&&(!following||!members.has(r.projectId)));
    const value={following,available:false,additional:[],versions:[],checkedAt:Date.now(),errors:[]};
    if(following){try{const versions=newest(await api.versions(profile.source.id)),root=records.find(r=>r.type==='modpack'),current=versions.find(v=>v.id===root?.versionId);value.versions=versions.map(v=>({id:v.id,name:v.name,date:v.date_published,type:v.version_type,gameVersions:v.game_versions,loaders:v.loaders}));const latest=versions.find(v=>v.version_type==='release'&&(!current||new Date(v.date_published)>new Date(current.date_published)));value.available=Boolean(latest&&latest.id!==root?.versionId);value.latest=latest?.name;value.latestId=latest?.id;}catch(error){value.errors.push('Pack updates: '+error.message);}}
    let cursor=0;await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];try{const versions=newest(await api.versions(item.projectId)),current=versions.find(v=>v.id===item.versionId),latest=versions.find(v=>v.version_type==='release'&&compatible(v,profile,item.type)&&(!current||new Date(v.date_published)>new Date(current.date_published)));if(latest&&latest.id!==item.versionId)value.additional.push({projectId:item.projectId,versionId:latest.id,version:latest.name,title:item.title});}catch(error){value.errors.push(item.title+': '+error.message);}}}));
    updateCache.set(id,{key,at:Date.now(),value});return value;
  }
  const lockedPlan=async input=>{if(busy)throw new Error('Wait for the current installation preview or download to finish.');busy=true;try{return await plan(input);}finally{busy=false;}};
  async function syncPack(id,options={}){
    const profile=(await library.list()).find(p=>p.id===id);if(!profile)throw new Error('Instance not found.');if(!profile.source||profile.packUpdates===false)return {linked:false,profiles:await library.list(),contents:await read(id)};
    const records=await read(id),root=records.find(r=>r.type==='modpack');if(!root)throw new Error('Linked modpack metadata is missing. Unlink this instance or reinstall its pack.');
    const versions=newest(await api.versions(profile.source.id)),current=versions.find(v=>v.id===root.versionId);
    const latest=options.versionId?versions.find(v=>v.id===options.versionId):current;
    if(!latest)throw new Error('The linked pack has no compatible version available.');
    if(latest.id===root.versionId){try{const manifest=JSON.parse(await fs.readFile(path.join(instancePath(id),'mml-pack.json'),'utf8'));let valid=manifest.versionId===root.versionId;
      for(const file of manifest.files.filter(f=>/^(mods|resourcepacks|shaderpacks)\//.test(f.path)))if(!await matchesFile(path.join(instancePath(id),'game',safePath(file.path)+(records.find(r=>r.files?.includes(file.path))?.enabled===false?'.disabled':'')),file.hashes)){valid=false;break;}
      if(valid)return {linked:true,changed:false,profiles:await library.list(),contents:records};
    }catch(error){if(error.code!=='ENOENT')throw error;}}
    const preview=await lockedPlan({projectId:profile.source.id,instanceId:id,syncPack:true,versionId:latest.id});const result=await install({planId:preview.planId,confirmWarnings:options.confirmWarnings===true});return {...result,linked:true,changed:true};
  }
  return { plan:lockedPlan, install, syncPack, checkUpdates, read, toggle, isBusy: () => busy, instancePath, recover, directory };
}
module.exports = { createContent, compatible, graph, packMembers, safePath, allowedDownload, download, unzip };
