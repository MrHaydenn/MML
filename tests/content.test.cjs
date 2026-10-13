const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { crc32 } = require('node:zlib');
const { createLibrary } = require('../electron/library.cjs');
const { createContent, safePath, allowedDownload } = require('../electron/content.cjs');

const hash = data => ({ sha1: createHash('sha1').update(data).digest('hex'), sha512: createHash('sha512').update(data).digest('hex') });
function version(project, dependencies = [], game = '1.21.1', loader = 'fabric') {
  const bytes = Buffer.from(project);
  return { id: project + '-v1', project_id: project, name: project + ' 1.0', game_versions: [game], loaders: [loader], date_published: '2026-01-01', dependencies, files: [{ primary: true, filename: project + '.jar', url: 'https://cdn.modrinth.com/' + project, hashes: hash(bytes), size: bytes.length }] };
}
async function setup(t, versions, projects = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-content-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const library = createLibrary(path.join(directory, 'library'));
  const [profile] = await library.create({ name: 'Fabric test', gameVersion: '1.21.1', loader: 'fabric' });
  const api = { project: async id => ({ id, title: id, project_type: 'mod', ...projects[id] }), versions: async id => Object.values(versions).filter(v => v.project_id === id), version: async id => versions[id], versionFiles: async () => ({}) };
  const fetcher = async url => new Response(Buffer.from(new URL(url).pathname.slice(1)));
  const content = createContent({ directory: path.join(directory, 'instances'), library, api, fetcher });
  return { content, profile, library, directory, api };
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(value), crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, filename); offset += header.length + filename.length + data.length;
  }
  const table = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, table, end]);
}
test('required dependencies are installed once, cycles resolve, and reverse dependencies persist', async t => {
  const root = version('root', [{ project_id: 'dep', dependency_type: 'required' }, { project_id: 'optional', dependency_type: 'optional' }]);
  const dep = version('dep', [{ project_id: 'root', dependency_type: 'required' }]);
  const { content, profile } = await setup(t, { [root.id]: root, [dep.id]: dep });
  const plan = await content.plan({ projectId: 'root', instanceId: profile.id });
  assert.equal(plan.files, 2); assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.contents.find(r => r.projectId === 'dep').requiredBy, ['root']);
  const result = await content.install({ planId: plan.planId });
  assert.equal(await fs.readFile(path.join(content.instancePath(profile.id), 'game/mods/dep.jar'), 'utf8'), 'dep');
  assert.equal(result.contents.length, 2);
  assert.deepEqual((await content.read(profile.id)).find(r => r.projectId === 'dep').requiredBy, ['root']);
});
test('automatic selection prefers compatible versions and incompatibility requires explicit confirmation', async t => {
  const older = version('root'); older.date_published = '2025-01-01';
  const newer = { ...version('root', [], '1.20.1', 'forge'), id: 'newer', date_published: '2026-01-01' };
  const { content, profile } = await setup(t, { [older.id]: older, newer });
  assert.equal((await content.plan({ projectId: 'root', instanceId: profile.id })).version, older.name);
  const plan = await content.plan({ projectId: 'root', instanceId: profile.id, versionId: 'newer' });
  assert(plan.warnings.some(w => /break/.test(w)));
  await assert.rejects(content.install({ planId: plan.planId }), /Confirm/);
  await content.install({ planId: plan.planId, confirmWarnings: true });
});
test('checksum failure leaves the existing instance intact', async t => {
  const root = version('root'), bad = version('bad'); bad.files[0].hashes = hash('incorrect');
  const { content, profile } = await setup(t, { [root.id]: root, [bad.id]: bad });
  const first = await content.plan({ projectId: 'root', instanceId: profile.id }); await content.install({ planId: first.planId });
  const second = await content.plan({ projectId: 'bad', instanceId: profile.id });
  await assert.rejects(content.install({ planId: second.planId }), /checksum/);
  assert.equal((await content.read(profile.id)).length, 1);
  assert.equal(await fs.readFile(path.join(content.instancePath(profile.id), 'game/mods/root.jar'), 'utf8'), 'root');
});
test('path traversal and nonpublic download origins are rejected', () => {
  for (const value of ['../x', '/x', 'a\\x', 'C:/x', 'mods/CON.jar', 'mods/x.', 'a//b']) assert.throws(() => safePath(value), /unsafe/);
  for (const url of ['http://cdn.modrinth.com/x', 'https://127.0.0.1/x', 'https://cdn.modrinth.com.evil.com/x']) assert.throws(() => allowedDownload(url), /unsupported/);
});

test('resource packs and shaders use their own folders and game compatibility', async t => {
  for (const [type, folder] of [['resourcepack', 'resourcepacks'], ['shader', 'shaderpacks']]) {
    const item = version(type, [], '1.21.1', type);
    const { content, profile } = await setup(t, { [item.id]: item }, { [type]: { project_type: type } });
    const plan = await content.plan({ projectId: type, instanceId: profile.id });
    assert(!plan.warnings.some(w => /does not declare/.test(w)));
    await content.install({ planId: plan.planId, confirmWarnings: true });
    assert.equal(await fs.readFile(path.join(content.instancePath(profile.id), 'game', folder, type + '.jar'), 'utf8'), type);
  }
});

test('untracked user files are preserved when an installation would overwrite them', async t => {
  const root = version('root');
  const { content, profile } = await setup(t, { [root.id]: root });
  const folder = path.join(content.instancePath(profile.id), 'game/mods');
  await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, 'root.jar'), 'user file');
  const plan = await content.plan({ projectId: 'root', instanceId: profile.id });
  await assert.rejects(content.install({ planId: plan.planId }), /untracked/);
  assert.equal(await fs.readFile(path.join(folder, 'root.jar'), 'utf8'), 'user file');
});
test('a Modrinth pack creates a separate instance, applies client overrides and excludes unsupported client files', async t => {
  const mod = Buffer.from('root');
  const manifest = { formatVersion: 1, game: 'minecraft', versionId: '1', name: 'Pack', dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.0' }, files: [{ path: 'mods/root.jar', hashes: hash(mod), fileSize: mod.length, downloads: ['https://cdn.modrinth.com/root'] }, { path: 'mods/server.jar', hashes: hash('server'), downloads: ['https://cdn.modrinth.com/server'], env: { client: 'unsupported' } }] };
  const archive = zip({ 'modrinth.index.json': JSON.stringify(manifest), 'overrides/config/options.txt': 'common', 'client-overrides/config/options.txt': 'client' });
  const pack = { ...version('pack'), files: [{ filename: 'pack.mrpack', primary: true, hashes: hash(archive), size: archive.length, url: 'https://cdn.modrinth.com/pack' }] };
  const { library, directory, api, profile } = await setup(t, { [pack.id]: pack }, { pack: { project_type: 'modpack' } });
  api.versionFiles = async () => ({ [hash(mod).sha1]: version('root') });
  const content = createContent({ directory: path.join(directory, 'packs'), library, api, fetcher: async url => new Response(url.endsWith('/pack') ? archive : mod) });
  const plan = await content.plan({ projectId: 'pack' }); assert.notEqual(plan.instance.id, profile.id); assert.equal(plan.instance.loader, 'fabric');
  await content.install({ planId: plan.planId });
  assert.equal((await library.list()).length, 2);
  assert.equal(await fs.readFile(path.join(content.instancePath(plan.instance.id), 'game/config/options.txt'), 'utf8'), 'client');
  await assert.rejects(fs.access(path.join(content.instancePath(plan.instance.id), 'game/mods/server.jar')));
  assert.deepEqual((await content.read(plan.instance.id)).find(r => r.projectId === 'root').requiredBy, ['pack']);
});
test('an interrupted directory swap recovers the previous instance', async t => {
  const { content, profile } = await setup(t, {});
  const backup = content.instancePath(profile.id) + '.backup'; await fs.mkdir(backup, { recursive: true }); await fs.writeFile(path.join(backup, 'preserved.txt'), 'saved');
  await content.recover(profile.id);
  assert.equal(await fs.readFile(path.join(content.instancePath(profile.id), 'preserved.txt'), 'utf8'), 'saved');
});
test('default Vanilla profile is unique and tracks the latest version without replacing custom instances', async t => {
  const { library } = await setup(t, {});
  await library.ensureDefault('1.21.1'); await library.ensureDefault('26.1.2');
  const profiles = await library.list(); assert.equal(profiles.length, 2); assert.equal(profiles.find(p => p.autoUpdate).gameVersion, '26.1.2');
});

test('mod toggles rename files safely, retain dependencies and preserve disabled state across reinstall', async t => {
  const root=version('root'),{content,profile}=await setup(t,{[root.id]:root});
  const plan=await content.plan({projectId:'root',instanceId:profile.id});await content.install({planId:plan.planId});
  let records=await content.toggle({instanceId:profile.id,projectId:'root',enabled:false});assert.equal(records[0].enabled,false);
  const filename=path.join(content.instancePath(profile.id),'game/mods/root.jar');await assert.rejects(fs.access(filename));assert.equal(await fs.readFile(filename+'.disabled','utf8'),'root');
  const reinstall=await content.plan({projectId:'root',instanceId:profile.id});await content.install({planId:reinstall.planId});assert.equal((await content.read(profile.id))[0].enabled,false);
  records=await content.toggle({instanceId:profile.id,projectId:'root',enabled:true});assert.equal(records[0].enabled,true);assert.equal(await fs.readFile(filename,'utf8'),'root');
});

test('instance settings detach update tracking while preserving pack identity and validate memory limits',async t=>{
  const {library,profile}=await setup(t,{});let profiles=await library.update(profile.id,{packUpdates:false,syncSettings:true,memoryMb:6144});const updated=profiles.find(p=>p.id===profile.id);assert.equal(updated.packUpdates,false);assert.equal(updated.syncSettings,true);assert.equal(updated.memoryMb,6144);assert.equal(updated.gameVersion,'1.21.1');
  await assert.rejects(library.update(profile.id,{memoryMb:0}),/Memory/);assert.equal((await library.list()).find(p=>p.id===profile.id).memoryMb,6144);
});

async function linkedFixture(t) {
  const root=version('root'), extra=version('extra',[{project_id:'root',dependency_type:'required'}]);
  const versions={[root.id]:root,[extra.id]:extra};
  const {library,directory,api}=await setup(t,versions,{pack:{project_type:'modpack'}});
  const archives={};
  function addPack(id,date,mods,config='default',overrides={},gameVersion='1.21.1'){
    const manifest={formatVersion:1,game:'minecraft',dependencies:{minecraft:gameVersion,'fabric-loader':'0.16.0'},files:mods.map(mod=>({path:'mods/'+mod+'.jar',hashes:hash(mod),downloads:['https://cdn.modrinth.com/'+mod]}))};
    const archive=zip({'modrinth.index.json':JSON.stringify(manifest),'overrides/config/test.txt':config,...overrides});
    archives[id]=archive;versions[id]={...version('pack'),id,name:id,date_published:date,version_type:'release',files:[{filename:'pack.mrpack',hashes:hash(archive),url:'https://cdn.modrinth.com/'+id}]};
  }
  api.versionFiles=async hashes=>Object.fromEntries(Object.values(versions).filter(v=>hashes.includes(v.files[0].hashes.sha1)).map(v=>[v.files[0].hashes.sha1,v]));
  const content=createContent({directory:path.join(directory,'linked'),library,api,fetcher:async url=>{const name=new URL(url).pathname.slice(1);return new Response(archives[name]||Buffer.from(name));}});
  addPack('pack-v1','2026-01-01',['root']);const plan=await content.plan({projectId:'pack'});await content.install({planId:plan.planId});
  return {content,library,versions,addPack,id:plan.instance.id,game:path.join(content.instancePath(plan.instance.id),'game')};
}
test('linked pack pins dependencies, repairs tampering, and unlocks when detached',async t=>{
  const {content,library,versions,id,game}=await linkedFixture(t);
  await content.toggle({instanceId:id,projectId:'root',enabled:false});assert.equal((await content.syncPack(id)).changed,false);await content.toggle({instanceId:id,projectId:'root',enabled:true});
  await assert.rejects(content.plan({projectId:'root',instanceId:id}),/managed/);
  const extra=await content.plan({projectId:'extra',instanceId:id});assert.equal(extra.files,1);await content.install({planId:extra.planId});
  assert.equal((await content.read(id)).find(r=>r.projectId==='root').packManaged,true);
  const wrong={...version('root'),id:'root-v2'};versions[wrong.id]=wrong;versions[extra.contents[0].versionId].dependencies=[{version_id:wrong.id,dependency_type:'required'}];
  await assert.rejects(content.plan({projectId:'extra',instanceId:id}),/different version/);
  versions[extra.contents[0].versionId].dependencies=[{project_id:'root',dependency_type:'required'}];
  assert.equal((await content.syncPack(id)).changed,false);
  await fs.writeFile(path.join(game,'mods/root.jar'),'changed');assert.equal((await content.syncPack(id)).changed,true);assert.equal(await fs.readFile(path.join(game,'mods/root.jar'),'utf8'),'root');
  await library.update(id,{packUpdates:false});await content.toggle({instanceId:id,projectId:'root',enabled:false});assert.equal((await content.syncPack(id)).linked,false);
});
test('pack updates remove old managed mods and retain additional content, required dependencies, worlds and edited config',async t=>{
  const {content,versions,addPack,id,game}=await linkedFixture(t);
  const extra=await content.plan({projectId:'extra',instanceId:id});await content.install({planId:extra.planId});
  await fs.mkdir(path.join(game,'saves/world'),{recursive:true});await fs.writeFile(path.join(game,'saves/world/data'),'world');await fs.writeFile(path.join(game,'config/test.txt'),'custom');
  const next=version('newmod');versions[next.id]=next;addPack('pack-v2','2026-02-01',['newmod'],'new-default');
  assert.equal((await content.syncPack(id)).changed,false);assert.equal((await content.checkUpdates(id)).latestId,'pack-v2');await assert.rejects(content.syncPack(id,{versionId:'pack-v2'}),/Confirm/);const result=await content.syncPack(id,{versionId:'pack-v2',confirmWarnings:true});assert.equal(result.changed,true);assert.equal(result.contents.find(r=>r.type==='modpack').versionId,'pack-v2');
  assert.equal(result.contents.find(r=>r.projectId==='root').packManaged,false);assert.equal(await fs.readFile(path.join(game,'mods/extra.jar'),'utf8'),'extra');assert.equal(await fs.readFile(path.join(game,'mods/root.jar'),'utf8'),'root');
  assert.equal(await fs.readFile(path.join(game,'config/test.txt'),'utf8'),'custom');assert.equal(await fs.readFile(path.join(game,'saves/world/data'),'utf8'),'world');
  addPack('pack-v3','2026-03-01',[]);await content.syncPack(id,{versionId:'pack-v3',confirmWarnings:true});await assert.rejects(fs.access(path.join(game,'mods/newmod.jar')));
});
test('pack update file collisions roll back without replacing additional mods',async t=>{
  const {content,addPack,id,game}=await linkedFixture(t);
  const extra=await content.plan({projectId:'extra',instanceId:id});await content.install({planId:extra.planId});
  addPack('pack-v2','2026-02-01',['root'],'default',{'overrides/mods/extra.jar':'conflict'});
  await assert.rejects(content.syncPack(id,{versionId:'pack-v2',confirmWarnings:true}),/conflicts/);assert.equal(await fs.readFile(path.join(game,'mods/extra.jar'),'utf8'),'extra');assert.equal((await content.read(id)).find(r=>r.type==='modpack').versionId,'pack-v1');
});

test('pack updates preserve disabled mods at the same version and enable replacements while keeping added files unchanged',async t=>{
 const {content,versions,addPack,id,game}=await linkedFixture(t);await content.toggle({instanceId:id,projectId:'root',enabled:false});
 addPack('pack-v2','2026-02-01',['root']);await content.syncPack(id,{versionId:'pack-v2'});assert.equal((await content.read(id)).find(r=>r.projectId==='root').enabled,false);assert.equal(await fs.readFile(path.join(game,'mods/root.jar.disabled'),'utf8'),'root');
 const replacement={...version('root'),id:'root-v2',files:[{filename:'root-new.jar',hashes:hash('root-new'),url:'https://cdn.modrinth.com/root-new'}]};versions[replacement.id]=replacement;
 addPack('pack-v3','2026-03-01',['root-new']);await content.syncPack(id,{versionId:'pack-v3'});assert.equal((await content.read(id)).find(r=>r.projectId==='root').enabled,true);await assert.rejects(fs.access(path.join(game,'mods/root.jar.disabled')));assert.equal(await fs.readFile(path.join(game,'mods/root-new.jar'),'utf8'),'root-new');
});
test('additional update checks select compatible releases, exclude pack members, and do not change files',async t=>{
 const {content,versions,id,game}=await linkedFixture(t);const plan=await content.plan({projectId:'extra',instanceId:id});await content.install({planId:plan.planId});
 versions['extra-v2']={...version('extra'),id:'extra-v2',version_type:'release',date_published:'2026-02-01'};versions['extra-wrong']={...version('extra',[],'26.3'),id:'extra-wrong',version_type:'release',date_published:'2026-03-01'};
 const result=await content.checkUpdates(id);assert.equal(result.additional.length,1);assert.equal(result.additional[0].versionId,'extra-v2');assert.equal(await fs.readFile(path.join(game,'mods/extra.jar'),'utf8'),'extra');assert.equal((await content.read(id)).find(r=>r.projectId==='extra').versionId,'extra-v1');
});
test('archiving and icons persist without changing instance content',async t=>{
 const {library,profile}=await setup(t,{});await library.update(profile.id,{archived:true,iconData:'data:image/png;base64,'+require('pngjs').PNG.sync.write(new (require('pngjs').PNG)({width:128,height:128})).toString('base64')});const saved=(await library.list()).find(p=>p.id===profile.id);assert.equal(saved.archived,true);assert(saved.iconData);await library.update(profile.id,{archived:false,iconData:null});assert.equal((await library.list()).find(p=>p.id===profile.id).archived,false);
});

test('bundled JARs without catalog matches can be disabled while the pack remains linked',async t=>{
 const {content,addPack,id,game}=await linkedFixture(t);addPack('pack-v2','2026-02-01',['unknown']);await content.syncPack(id,{versionId:'pack-v2'});const mod=(await content.read(id)).find(r=>r.localFile);assert(mod);await content.toggle({instanceId:id,projectId:mod.projectId,enabled:false});assert.equal(await fs.readFile(path.join(game,'mods/unknown.jar.disabled'),'utf8'),'unknown');assert.equal((await content.syncPack(id)).changed,false);
});

test('disabled bundled override mods stay disabled during an unchanged-content pack update',async t=>{
 const {content,addPack,id,game}=await linkedFixture(t);addPack('pack-v2','2026-02-01',[],'default',{'overrides/mods/local.jar':'local'});await content.syncPack(id,{versionId:'pack-v2'});const record=(await content.read(id)).find(r=>r.localFile);await content.toggle({instanceId:id,projectId:record.projectId,enabled:false});addPack('pack-v3','2026-03-01',[],'default',{'overrides/mods/local.jar':'local'});await content.syncPack(id,{versionId:'pack-v3'});assert.equal(await fs.readFile(path.join(game,'mods/local.jar.disabled'),'utf8'),'local');await assert.rejects(fs.access(path.join(game,'mods/local.jar')));assert.equal((await content.syncPack(id)).changed,false);
});

test('switching pack Minecraft versions requires confirmation and retains additional file bytes',async t=>{
 const {content,library,addPack,id,game}=await linkedFixture(t);const extra=await content.plan({projectId:'extra',instanceId:id});await content.install({planId:extra.planId});addPack('pack-v2','2026-02-01',['root'],'default',{},'26.3');const plan=await content.plan({projectId:'pack',instanceId:id,versionId:'pack-v2',syncPack:true});assert(plan.warnings.some(w=>w.includes('changes Minecraft')));await assert.rejects(content.install({planId:plan.planId}),/Confirm/);assert.equal((await library.list()).find(p=>p.id===id).gameVersion,'1.21.1');await content.install({planId:plan.planId,confirmWarnings:true});assert.equal((await library.list()).find(p=>p.id===id).gameVersion,'26.3');assert.equal(await fs.readFile(path.join(game,'mods/extra.jar'),'utf8'),'extra');
});
