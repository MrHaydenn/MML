const assert = require('node:assert/strict');
const { createClient } = require('../electron/modrinth.cjs');
(async () => {
  const api = createClient();
  const result = await api.search({ type: 'modpack', query: 'Fabulously Optimized', loader: 'fabric' });
  assert(result.hits.length > 0);
  const project = await api.project(result.hits[0].project_id);
  const versions = await api.versions(project.id);
  const games = await api.gameVersions();
  assert(versions.length > 0); assert(games.length > 0);
  console.log(`Live API passed: ${project.title}; ${versions.length} releases; ${games.length} Minecraft versions.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
