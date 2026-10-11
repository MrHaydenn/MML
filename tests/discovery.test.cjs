const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function page(t) {
  const root = path.join(__dirname, '../src');
  const dom = new JSDOM(await fs.readFile(path.join(root, 'index.html'), 'utf8'), { url: 'http://localhost/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.scrollTo = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const calls = [];
  dom.window.fetch = async (url, options) => {
    const method = url.split('/').at(-1), value = JSON.parse(options.body).value; calls.push({ method, value });
    const project = { id: 'project', project_id: 'project', title: 'Example', author: 'Author', description: 'Example content', project_type: value?.type || 'mod', downloads: 100, followers: 3, body: '# Project home\n<script>window.pwned=true</script>\n<img src="https://evil.invalid/track" onerror="alert(1)">\n[Project link](https://example.com)' };
    const data = method === 'search' ? { hits: [project], total_hits: 1 } : method === 'project' ? project : method === 'versions' ? [{ id: 'v1', name: 'Version one', game_versions: ['1.21.1'], loaders: ['fabric'], date_published: '2026-01-01', version_type: 'release' }] : method === 'gameVersions' ? ['1.21.1'] : method === 'library' ? [{ id: 'default-vanilla', name: 'Latest Minecraft', gameVersion: '1.21.1', loader: 'vanilla', autoUpdate: true }] : null;
    return { ok: true, json: async () => data };
  };
  const context = dom.getInternalVMContext();
  for (const file of ['vendor/marked.js', 'vendor/purify.js', 'discovery.js', 'app.js']) new vm.Script(await fs.readFile(path.join(root, file), 'utf8'), { filename: file }).runInContext(context);
  await tick(); await tick();
  dom.window.document.querySelector('#continue-local').click();
  return { dom, doc: dom.window.document, calls };
}
test('discover opens without the banner, keeps modpack cards, and changes other content to list rows', async t => {
  const { doc, calls } = await page(t);
  assert.equal(doc.querySelector('.hero'), null);
  assert(doc.querySelector('#results.project-grid .project-card'));
  assert.equal(calls.find(c => c.method === 'search').value.sort, 'downloads');
  doc.querySelector('[data-type="mod"]').click(); await tick();
  assert(doc.querySelector('#results.project-list .project-row'));
  assert(doc.querySelector('[data-install]')); assert(doc.querySelector('[data-versions]'));
});
test('project overview renders sanitized Markdown, versions can open an instance-selection install dialog', async t => {
  const { dom, doc } = await page(t);
  doc.querySelector('[data-project]').click(); await tick(); await tick();
  assert.equal(doc.querySelector('#project-page').hidden, false);
  assert.match(doc.querySelector('.project-markdown').textContent, /Project home/);
  assert.equal(doc.querySelector('.project-markdown script'), null);
  assert.equal(doc.querySelector('.project-markdown img'), null);
  assert.equal(dom.window.pwned, undefined);
  doc.querySelector('[data-project-tab="versions"]').click();
  assert(doc.querySelector('[data-version-install="v1"]'));
  doc.querySelector('[data-version-install="v1"]').click(); await tick(); await tick();
  assert.equal(doc.querySelector('#install-dialog').open, true);
  assert.equal(doc.querySelector('#install-version').value, 'v1');
  assert.match(doc.querySelector('#install-hint').textContent, /incompatible/);
});
test('Minecraft accounts are accessible from the bottom-left and browser previews do not accept account credentials', async t => {
  const { doc } = await page(t);
  doc.querySelector('#minecraft-menu').click(); await tick();
  assert.equal(doc.querySelector('#accounts-page').hidden, false);
  assert.equal(doc.querySelector('#minecraft-add').disabled, true);
  assert.match(doc.querySelector('#minecraft-error').textContent, /Windows application/);
  assert.match(doc.querySelector('#library-list').textContent, /LATEST VANILLA/);
});
