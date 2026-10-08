const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { searchParams, createClient, USER_AGENT } = require('../electron/modrinth.cjs');
const { createLibrary, validateProfile } = require('../electron/library.cjs');

test('search combines project type, loader and game version as AND facets', () => {
  const params = searchParams({ query: 'caves & cliffs', loader: 'fabric', version: '1.21.1', offset: -1 });
  assert.deepEqual(JSON.parse(params.get('facets')), [['project_type:modpack'], ['categories:fabric'], ['versions:1.21.1']]);
  assert.equal(params.get('query'), 'caves & cliffs'); assert.equal(params.get('offset'), '0');
});
test('client identifies MML and explains rate limiting', async () => {
  const api = createClient(async (_url, options) => { assert.equal(options.headers['User-Agent'], USER_AGENT); return { ok: false, status: 429 }; });
  await assert.rejects(api.search({}), /wait a minute/);
  assert.throws(() => api.project('../anything'), /Invalid project/);
});
test('profile validation rejects malformed data', () => {
  assert.throws(() => validateProfile({ name: ' ', gameVersion: '1.21', loader: 'fabric' }));
  assert.throws(() => validateProfile({ name: 'Pack', gameVersion: '../../file', loader: 'fabric' }));
});
test('library persists concurrent writes, removes profiles, and preserves corrupt data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-test-'));
  try {
    const library = createLibrary(dir);
    await Promise.all(['First', 'Second'].map(name => library.create({ name, gameVersion: '1.21.1', loader: 'fabric' })));
    const profiles = await createLibrary(dir).list(); assert.equal(profiles.length, 2);
    assert.equal((await library.remove(profiles[0].id)).length, 1);
    await fs.writeFile(path.join(dir, 'profiles.json'), 'broken');
    await assert.rejects(library.create({ name: 'Third', gameVersion: '1.21.1', loader: 'fabric' }), /preserved/);
    assert.equal(await fs.readFile(path.join(dir, 'profiles.json'), 'utf8'), 'broken');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
