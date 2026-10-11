const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createClient } = require('../electron/modrinth.cjs');
const { createLibrary } = require('../electron/library.cjs');
const { createContent } = require('../electron/content.cjs');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mml-live-install-'));
  try {
    const library = createLibrary(path.join(directory, 'library')), api = createClient();
    const [profile] = await library.create({ name: 'Live API check', gameVersion: '1.21.1', loader: 'fabric' });
    const content = createContent({ directory: path.join(directory, 'instances'), library, api });
    const mod = await content.plan({ projectId: 'reeses-sodium-options', instanceId: profile.id });
    assert(mod.contents.length >= 2, 'Expected Sodium as a required dependency');
    await content.install({ planId: mod.planId, confirmWarnings: true });
    const records = await content.read(profile.id);
    assert(records.some(r => r.requiredBy.length));
    console.log(`Real mod installation verified: ${mod.contents.length} projects with reverse dependencies.`);
    const pack = await content.plan({ projectId: 'fabulously-optimized' });
    await content.install({ planId: pack.planId, confirmWarnings: true });
    assert((await library.list()).some(p => p.id === pack.instance.id));
    assert((await fs.readdir(path.join(content.instancePath(pack.instance.id), 'game/mods'))).length > 0);
    console.log(`Real .mrpack installation verified: ${pack.files} hashed files; Minecraft ${pack.instance.gameVersion} / ${pack.instance.loader}.`);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
