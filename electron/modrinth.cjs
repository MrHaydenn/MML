const BASE = 'https://api.modrinth.com/v2';
const USER_AGENT = 'MrHaydenn/MML/0.7.0 (https://github.com/MrHaydenn/MML)';
const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];

function searchParams(input = {}) {
  const type = ['modpack', 'mod', 'resourcepack', 'shader'].includes(input.type) ? input.type : 'modpack';
  const facets = [[`project_type:${type}`]];
  if (LOADERS.includes(input.loader)) facets.push([`categories:${input.loader}`]);
  if (/^\d+\.\d+(\.\d+)?$/.test(input.version || '')) facets.push([`versions:${input.version}`]);
  return new URLSearchParams({ query: String(input.query || '').slice(0, 200), facets: JSON.stringify(facets),
    index: ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(input.sort) ? input.sort : 'downloads',
    limit: '12', offset: String(Math.max(0, Math.min(10000, Number(input.offset) || 0))) });
}

function createClient(fetcher = fetch) {
  async function request(path, body) {
    const response = await fetcher(`${BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(15000), ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'Modrinth is busy. Please wait a minute and try again.' : `Modrinth request failed (${response.status}). Please try again.`);
    return response.json();
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid project ID.');
    return encodeURIComponent(value);
  }
  return {
    search: input => request(`/search?${searchParams(input)}`),
    project: value => request(`/project/${id(value)}`),
    versions: value => request(`/project/${id(value)}/version`),
    version: value => request(`/version/${id(value)}`),
    versionFiles: hashes => request('/version_files', { hashes, algorithm: 'sha1' }),
    gameVersions: async () => (await request('/tag/game_version')).filter(v => v.version_type === 'release').map(v => v.version)
  };
}
module.exports = { createClient, searchParams, USER_AGENT };
