const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateProfile(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 60) throw new Error('Choose a profile name between 1 and 60 characters.');
  if (!/^\d+\.\d+(\.\d+)?$/.test(input.gameVersion || '')) throw new Error('Choose a valid Minecraft version.');
  if (!['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(input.loader)) throw new Error('Choose a supported loader.');
  const source = input.source && /^[a-zA-Z0-9_-]{1,100}$/.test(input.source.id) ? { id: input.source.id, title: String(input.source.title).slice(0, 100) } : null;
  return { name: input.name.trim(), gameVersion: input.gameVersion, loader: input.loader, source };
}

function createLibrary(directory) {
  const file = path.join(directory, 'profiles.json');
  let queue = Promise.resolve();
  async function list() {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(data)) throw new Error('Invalid library');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error('Your library could not be read. The existing file has been preserved.');
    }
  }
  function mutate(operation) {
    const next = queue.then(async () => {
      const profiles = await operation(await list());
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(profiles, null, 2));
      await fs.rename(`${file}.tmp`, file);
      return profiles;
    });
    queue = next.catch(() => {});
    return next;
  }
  return {
    list,
    create: input => { const profile = validateProfile(input); return mutate(profiles => [{ ...profile, id: randomUUID(), createdAt: new Date().toISOString() }, ...profiles]); },
    remove: id => mutate(profiles => profiles.filter(p => p.id !== id)),
    update: (id, input) => mutate(profiles => {
      const profile = profiles.find(p => p.id === id); if (!profile) throw new Error('Instance not found.');
      if (input.name !== undefined) { if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 60) throw new Error('Choose a name between 1 and 60 characters.'); profile.name = input.name.trim(); }
      if (input.memoryMb !== undefined) { if (!Number.isInteger(input.memoryMb) || input.memoryMb < 1024 || input.memoryMb > 32768) throw new Error('Memory must be between 1024 and 32768 MB.'); profile.memoryMb = input.memoryMb; }
      for (const key of ['syncSettings', 'packUpdates']) if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') throw new Error('Invalid instance setting.'); profile[key] = input[key]; }
      if (typeof input.iconUrl === 'string' && /^https:\/\/cdn\.modrinth\.com\//.test(input.iconUrl)) profile.iconUrl = input.iconUrl;
      return profiles;
    }),
    ensureDefault: version => mutate(profiles => {
      if (!/^\d+\.\d+(\.\d+)?$/.test(version)) throw new Error('Invalid latest Minecraft release.');
      const current = profiles.find(p => p.id === 'default-vanilla');
      if (current) { current.gameVersion = version; current.loader = 'vanilla'; current.autoUpdate = true; }
      else profiles.unshift({ id: 'default-vanilla', name: 'Latest Minecraft', gameVersion: version, loader: 'vanilla', autoUpdate: true, createdAt: new Date().toISOString() });
      return profiles;
    }),
    add: profile => mutate(profiles => [...profiles, profile]),
    directory
  };
}
module.exports = { createLibrary, validateProfile };
