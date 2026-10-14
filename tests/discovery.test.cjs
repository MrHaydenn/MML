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
  for (const file of ['vendor/marked.js', 'vendor/purify.js', 'project-content.js','screenshots.js','discovery.js', 'instances.js','default-skins.js','pixel-editor.js','skin-workspace.js', 'skins.js', 'app.js']) new vm.Script(await fs.readFile(path.join(root, file), 'utf8'), { filename: file }).runInContext(context);
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
  assert.equal(doc.querySelector('.project-markdown img').hasAttribute('onerror'), false);
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
  assert.match(doc.querySelector('#library-list').textContent, /Latest release/);
});

test('workspace sign-in only submits existing-account credentials and clears the password', async t => {
  const { dom, doc } = await page(t); let submitted;
  assert.equal(doc.querySelector('#account-service-url'),null);
  assert.equal(doc.querySelector('#instance-token'),null);
  dom.window.mml={connectAccount:async input=>{submitted=input;return {connected:true,serviceUrl:'https://accounts.mrhaydenn.us',user:{id:'1',username:'MixedCase',role:'member'}};}};
  doc.querySelector('#shared-username').value='MixedCase';doc.querySelector('#shared-password').value='test password';
  await doc.querySelector('#signin-form').onsubmit({preventDefault(){}});
  assert.equal(submitted.username,'MixedCase');assert.equal(submitted.password,'test password');assert.equal(Object.keys(submitted).length,2);
  assert.equal(doc.querySelector('#shared-password').value,'');assert.equal(doc.querySelector('#signin-screen').hidden,true);
});

test('instance tiles open a full page, expose Play, and instance settings persist sync choices',async t=>{
  const {dom,doc}=await page(t);let saved;
  dom.window.mml={installedContent:async()=>[],updateInstance:async(id,settings)=>{saved={id,...settings};return [{id,name:settings.name,gameVersion:'1.21.1',loader:'vanilla',...settings}];}};
  assert(doc.querySelector('.instance-tile .instance-image'));assert(doc.querySelector('.instance-tile [data-play]'));
  doc.querySelector('[data-content="default-vanilla"]').click();await tick();
  assert.equal(doc.querySelector('#instance-page').hidden,false);assert.equal(doc.querySelector('#instance-dialog').open,false);
  doc.querySelector('[data-instance-tab="settings"]').click();doc.querySelector('#instance-name').value='My settings';doc.querySelector('#instance-sync').checked=true;
  await doc.querySelector('#instance-settings-form').onsubmit({preventDefault(){}});assert.equal(saved.syncSettings,true);assert.equal(saved.memoryMb,4096);assert.equal(saved.name,'My settings');
  dom.window.renderMinecraft({accounts:[{id:'player',name:'Player',expires:Date.now()+10000,skinUrl:'https://textures.minecraft.net/texture/'+'a'.repeat(64)}],active:'player',configured:true});
  assert(doc.querySelector('#minecraft-sidebar-avatar .skin-face'));assert.equal(doc.querySelector('#minecraft-sidebar-name').textContent,'Player');
});

test('instance content browser fixes its target, filters compatible mods, and installs directly',async t=>{
  const {dom,doc,calls}=await page(t);let planned,installed;
  dom.window.eval("state.profiles.push({id:'11111111-aaaa-4444-bbbb-111111111111',name:'Fabric pack',gameVersion:'1.21.1',loader:'fabric'})");
  const id='11111111-aaaa-4444-bbbb-111111111111';
  // API library refresh also returns the target instance.
  const original=dom.window.fetch;dom.window.fetch=async(url,options)=>{if(url.endsWith('/library'))return {ok:true,json:async()=>[{id,name:'Fabric pack',gameVersion:'1.21.1',loader:'fabric'}]};return original(url,options);};
  dom.window.mml={planInstall:async input=>{planned=input;return {planId:'plan',instance:{id,name:'Fabric pack',gameVersion:'1.21.1',loader:'fabric'},version:'Version one',files:1,contents:[],warnings:[]};},installContent:async input=>{installed=input;return {instance:{id,name:'Fabric pack'},profiles:[{id,name:'Fabric pack',gameVersion:'1.21.1',loader:'fabric'}]};},installedContent:async()=>[]};
  dom.window.openInstanceDiscovery(id);await tick();
  assert.equal(doc.querySelector('[data-type="modpack"]').hidden,true);assert(doc.querySelector('[data-type="mod"]').classList.contains('selected'));
  const search=calls.filter(c=>c.method==='search').at(-1).value;assert.equal(search.version,'1.21.1');assert.equal(search.loader,'fabric');
  doc.querySelector('[data-install]').click();for(let i=0;i<6;i++)await tick();
  assert.equal(planned.instanceId,id);assert.equal(installed.planId,'plan');assert.equal(doc.querySelector('#instance-page').hidden,false);
  dom.window.openInstanceDiscovery(id);doc.querySelector('[data-type="resourcepack"]').click();await tick();assert.equal(calls.filter(c=>c.method==='search').at(-1).value.loader,'');
  doc.querySelector('[data-page="discover"]').click();await tick();assert.equal(doc.querySelector('[data-type="modpack"]').hidden,false);assert(doc.querySelector('[data-type="modpack"]').classList.contains('selected'));
});
test('linked modpack content is separate and can be disabled; Servers and MMSM pairing are absent',async t=>{
  const {dom,doc}=await page(t);
  assert.equal(doc.querySelector('[data-page="hosting"]'),null);assert.equal(doc.querySelector('#hosting-page'),null);assert.equal(doc.querySelector('#instance-token'),null);
  dom.window.eval("state.profiles[0].source={id:'pack',title:'Example pack'};state.profiles[0].packUpdates=true");
  dom.window.mml={installedContent:async()=>[{projectId:'pack',title:'Example pack',type:'modpack',version:'1.0',dependencies:['bundled'],files:[]},{projectId:'bundled',title:'Bundled mod',type:'mod',version:'1.0',files:['mods/bundled.jar']},{projectId:'extra',title:'Extra mod',type:'mod',version:'2.0',files:['mods/extra.jar']}]};
  await dom.window.showInstance('default-vanilla');assert.match(doc.querySelector('.instance-content-heading').textContent,/Additional content/);assert.equal(doc.querySelector('[data-toggle-mod="bundled"]'),null);assert(doc.querySelector('[data-toggle-mod="extra"]'));
  doc.querySelector('[data-pack-expand]').click();assert.match(doc.querySelector('.linked-pack').textContent,/Bundled mod/);assert(doc.querySelector('.linked-pack [data-toggle-mod="bundled"]'));
});

test('Library is the startup page; archiving moves and restores tiles without losing the instance',async t=>{
 const {dom,doc}=await page(t);assert.equal(doc.querySelector('#library-page').hidden,false);assert.equal(doc.querySelector('#discover-page').hidden,true);
 dom.window.mml={updateInstance:async(id,settings)=>[{id,name:'Latest Minecraft',gameVersion:'1.21.1',loader:'vanilla',autoUpdate:true,...settings}]};
 assert.equal(doc.querySelector('#library-list [data-archive]'),null);dom.window.mml.installedContent=async()=>[];await dom.window.showInstance('default-vanilla');doc.querySelector('[data-instance-tab="settings"]').click();doc.querySelector('#instance-archived').checked=true;await doc.querySelector('#instance-settings-form').onsubmit({preventDefault(){}});dom.window.showPage('library');assert.equal(doc.querySelector('#library-list .instance-tile'),null);assert(doc.querySelector('#archived-list .instance-tile'));assert.equal(doc.querySelector('#archived-section').hidden,false);
 doc.querySelector('#archived-list [data-archive]').click();await tick();assert(doc.querySelector('#library-list .instance-tile'));assert.equal(doc.querySelector('#archived-section').hidden,true);
});
test('pack versions and additional update buttons are shown independently',async t=>{
 const {dom,doc}=await page(t);dom.window.eval("state.profiles[0].source={id:'pack',title:'Pack'};state.profiles[0].packUpdates=true");
 dom.window.mml={installedContent:async()=>[{projectId:'pack',type:'modpack',title:'Pack',versionId:'p1',version:'1',dependencies:[],files:[]},{projectId:'extra',type:'mod',title:'Extra',version:'1',files:[]}],instanceUpdates:async()=>({available:true,latest:'Pack 2',latestId:'p2',additional:[{projectId:'extra',versionId:'e2',version:'Extra 2'}],versions:[{id:'p1',name:'Pack 1',type:'release',gameVersions:['1.21.1'],loaders:['fabric']},{id:'p2',name:'Pack 2',type:'release',gameVersions:['1.21.1'],loaders:['fabric']}]})};
 await dom.window.showInstance('default-vanilla');assert(doc.querySelector('[data-pack-update="p2"]'));assert(doc.querySelector('[data-content-update="extra"]'));doc.querySelector('[data-instance-tab="versions"]').click();assert.match(doc.querySelector('#instance-page').textContent,/Switch version/);assert(doc.querySelector('[data-pack-update="p1"]').disabled);
});

test('compact navigation opens skins and instance shortcuts while Discover omits its large heading',async t=>{
 const {dom,doc}=await page(t);assert.equal(doc.querySelector('#discover-title'),null);assert.equal(doc.querySelector('.discovery-note'),null);assert(doc.querySelector('[data-page="skins"][aria-label="Skins"] svg'));assert(doc.querySelector('#sidebar-instances [data-quick-instance="default-vanilla"]'));
 doc.querySelector('[data-page="skins"]').click();assert.equal(doc.querySelector('#skins-page').hidden,false);assert.match(doc.querySelector('#skins-page').textContent,/Windows launcher/);doc.querySelector('[data-page="library"]').click();assert.equal(doc.querySelector('#library-page').hidden,false);doc.querySelector('[data-quick-instance="default-vanilla"]').click();await tick();assert.equal(doc.querySelector('#instance-page').hidden,false);
});

test('instance settings gear is first, custom instance art does not replace linked pack art, and playtime is shown',async t=>{
 const {dom,doc}=await page(t);dom.window.eval("Object.assign(state.profiles[0],{source:{id:'pack',title:'Pack'},iconUrl:'https://cdn.modrinth.com/pack.png',iconData:'data:image/png;base64,aGVsbG8=',playtimeSeconds:7500,launchCount:4})");dom.window.mml={installedContent:async()=>[]};await dom.window.showInstance('default-vanilla');assert.equal(doc.querySelector('.instance-tabs button').dataset.instanceTab,'settings');assert.equal(doc.querySelector('.instance-hero .instance-image').getAttribute('src'),'data:image/png;base64,aGVsbG8=');assert.equal(doc.querySelector('.pack-summary .instance-image').getAttribute('src'),'https://cdn.modrinth.com/pack.png');assert.match(doc.querySelector('.instance-play-stats').textContent,/2h 5m/);assert.match(doc.querySelector('.instance-play-stats').textContent,/4 sessions/);dom.window.showPage('library');assert.equal(doc.querySelector('#library-page h1'),null);assert.match(doc.querySelector('.tile-playtime').textContent,/2h 5m/);
});

test('all Discover categories open from the card body and render description images, dropdowns, gallery and version filters',async t=>{
 const {dom,doc}=await page(t);
 const original=dom.window.fetch;
 let type='modpack';
 dom.window.fetch=async(url,options)=>{if(url.endsWith('/project'))return{ok:true,json:async()=>({id:'project',title:'Example',project_type:type,description:'Description',body:'<details><summary>More information</summary><p>Expanded content</p><img src="https://i.imgur.com/example.png" onerror="alert(1)"></details>',gallery:[{url:'https://cdn.modrinth.com/example.png',title:'In game',description:'Gallery description'}]})};if(url.endsWith('/versions'))return{ok:true,json:async()=>[{id:'v1',name:'Latest',version_number:'2.0',version_type:'release',game_versions:['1.21.1'],loaders:['fabric'],date_published:'2026-01-01',downloads:100},{id:'v2',name:'Old',version_number:'1.0',version_type:'beta',game_versions:['1.20.1'],loaders:['forge'],date_published:'2025-01-01',downloads:50}]};return original(url,options);};
 for(type of ['modpack','mod','resourcepack','shader']){
  doc.querySelector('[data-page="discover"]').click();doc.querySelector('[data-type="'+type+'"]').click();await tick();await tick();
  const card=doc.querySelector('#results article');assert(card.hasAttribute('data-project'));card.click();await tick();await tick();
  assert.equal(doc.querySelector('#project-page').hidden,false);assert.equal(doc.querySelector('.project-markdown img').getAttribute('src'),'https://i.imgur.com/example.png');assert.equal(doc.querySelector('.project-markdown img').hasAttribute('onerror'),false);
  doc.querySelector('.project-markdown summary').click();assert.equal(doc.querySelector('.project-markdown details').open,true);
  doc.querySelector('[data-project-tab="gallery"]').click();assert.equal(doc.querySelectorAll('.project-gallery img').length,1);
  doc.querySelector('[data-project-tab="versions"]').click();assert.equal(doc.querySelectorAll('.project-version-table tbody tr').length,2);
  const filter=doc.querySelector('#project-game-filter');filter.value='1.20.1';filter.dispatchEvent(new dom.window.Event('change'));assert.equal(doc.querySelectorAll('.project-version-table tbody tr').length,1);assert(doc.querySelector('[data-version-install="v2"]'));
 }
});

test('image viewer navigates both directions with buttons and keyboard, and safely shows metadata',async t=>{
 const {dom,doc}=await page(t);const items=[{title:'First',url:'https://cdn.modrinth.com/1.png'},{title:'<b>Second</b>',url:'https://cdn.modrinth.com/2.png'}];
 const dialog=dom.window.openImageViewer({items,index:0,load:async i=>i.url});await tick();assert.equal(dialog.querySelector('img').getAttribute('src'),items[0].url);
 dialog.querySelector('.image-viewer-next').click();await tick();assert.equal(dialog.querySelector('h2').textContent,'<b>Second</b>');assert.equal(dialog.querySelector('h2 b'),null);assert.equal(dialog.querySelector('.image-viewer-count').textContent,'2 / 2');
 dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await tick();assert.equal(dialog.querySelector('img').getAttribute('src'),items[0].url);
 dialog.querySelector('.image-viewer-previous').click();await tick();assert.equal(dialog.querySelector('img').getAttribute('src'),items[1].url);
 dialog.querySelector('.lightbox-close').click();dialog.dispatchEvent(new dom.window.Event('close'));assert.equal(doc.querySelector('.image-viewer'),null);
});
test('Play starts Microsoft sign-in when needed and resumes only after completion; cancelled sign-in never launches',async t=>{
 const {dom,doc}=await page(t);let signedIn=false,launched=0,opened=0,poll;
 const player={id:'player',name:'Player',expires:Date.now()+3600000},auth=()=>({configured:true,clientId:'11111111-1111-1111-1111-111111111111',active:signedIn?'player':null,accounts:signedIn?[player]:[]});
 dom.window.setTimeout=(callback,ms)=>{if(ms===5000)poll=callback;return 1;};
 dom.window.mml={minecraftState:async()=>auth(),prepareMinecraft:async()=>({ready:signedIn,...auth()}),beginMinecraft:async()=>({userCode:'CODE',interval:5000}),openMinecraftLogin:async()=>{opened++;},pollMinecraft:async()=>{signedIn=true;return{pending:false,...auth()};},cancelMinecraft:async()=>auth(),playInstance:async()=>{launched++;return{state:'running'};},installedContent:async()=>[]};
 await dom.window.playInstance('default-vanilla');assert.equal(opened,1);assert.equal(launched,0);assert.equal(doc.querySelector('#accounts-page').hidden,false);assert.equal(doc.querySelector('#minecraft-code').textContent,'CODE');
 await poll();assert.equal(launched,1);assert.equal(doc.querySelector('#instance-page').hidden,false);
 signedIn=false;await dom.window.playInstance('default-vanilla');await doc.querySelector('#minecraft-cancel').onclick();assert.equal(launched,1);
 dom.window.renderMinecraft({...auth(),active:'player',accounts:[{...player,expires:0}]});assert(doc.querySelector('.minecraft-session-warning'));dom.window.renderMinecraft({...auth(),active:'player',accounts:[player]});assert.equal(doc.querySelector('.minecraft-session-warning'),null);
});
