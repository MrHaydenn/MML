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
