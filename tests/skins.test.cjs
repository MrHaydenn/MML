const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {PNG}=require('pngjs');
const {createSkins,skinPNG}=require('../electron/skins.cjs');
const id='a'.repeat(32), other='b'.repeat(32);
function image(){return 'data:image/png;base64,'+PNG.sync.write(new PNG({width:64,height:64})).toString('base64');}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mml-skins-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let active=id;
 const calls=[],cached=[],profile={id,name:'Player',skins:[{id:'skin',state:'ACTIVE',url:'http://textures.minecraft.net/texture/'+'c'.repeat(64),variant:'SLIM'}],capes:[{id:'owned-cape',alias:'Owned cape',state:'INACTIVE',url:'https://textures.minecraft.net/texture/'+'d'.repeat(64)}]};
 const accounts={state:()=>({accounts:[{id},{id:other}]}),launchSession:async()=>({id:active,accessToken:'private-token'}),cacheProfile:async value=>cached.push(value)};
 const fetcher=async(url,options)=>{calls.push({url,options});if(options?.method==='DELETE'||options?.method==='PUT')return new Response(null,{status:204});return new Response(JSON.stringify(profile));};
 return {skins:createSkins({directory,accounts,fetcher}),directory,calls,cached,activate:value=>active=value};
}
test('skin library saves validated PNGs per account, edits and restores locally without network access',async t=>{
 const {skins,directory,calls}=await fixture(t);const data=image();const saved=await skins.save({accountId:id,name:'First skin',variant:'slim',data});assert.equal(saved.length,1);assert.equal(calls.length,0);assert.equal((await skins.list(other)).length,0);
 await skins.save({accountId:id,id:saved[0].id,name:'Edited skin',variant:'classic',data});const restored=createSkins({directory,accounts:{state:()=>({accounts:[{id}]})}});assert.equal((await restored.list(id))[0].name,'Edited skin');assert.equal((await skins.remove({accountId:id,id:saved[0].id})).length,0);
 await assert.rejects(skins.save({accountId:id,name:'Bad',variant:'classic',data:'data:image/png;base64,aGVsbG8='}),/skin/i);
 assert.throws(()=>skinPNG('data:image/png;base64,'+PNG.sync.write(new PNG({width:128,height:128})).toString('base64')),/64/);
});
test('Apply uploads multipart PNG to Minecraft with an internal bearer token and updates cached profile',async t=>{
 const {skins,calls,cached}=await fixture(t);const [skin]=await skins.save({accountId:id,name:'Skin',variant:'slim',data:image()});const result=await skins.apply({accountId:id,id:skin.id});
 const upload=calls.find(c=>c.url.endsWith('/skins'));assert.equal(upload.options.method,'POST');assert.equal(upload.options.headers.Authorization,'Bearer private-token');assert.equal(upload.options.body.get('variant'),'slim');assert.equal(upload.options.body.get('file').type,'image/png');assert(cached.length);assert.equal(result.skins[0].url.startsWith('https:'),true);assert(!JSON.stringify(result).includes('private-token'));
});
test('cape changes allow owned capes or hide, and reject unowned capes and changed active accounts',async t=>{
 const {skins,calls,activate}=await fixture(t);await assert.rejects(skins.cape({accountId:id,id:'unowned'}),/does not own/);assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);
 await skins.cape({accountId:id,id:'owned-cape'});assert.deepEqual(JSON.parse(calls.find(c=>c.options.method==='PUT').options.body),{capeId:'owned-cape'});await skins.cape({accountId:id,id:''});assert(calls.some(c=>c.options.method==='DELETE'));
 activate(other);await assert.rejects(skins.profile(id),/changed/);await assert.rejects(skins.texture('https://example.com/skin.png'),/Invalid/);
});

test('saved cape choices stay local until Apply, which updates both appearance and applied marker',async t=>{
 const {skins,calls}=await fixture(t);const [skin]=await skins.save({accountId:id,name:'With cape',variant:'classic',data:image(),capeId:'owned-cape'});assert.equal(calls.length,0);assert.equal((await skins.list(id))[0].capeId,'owned-cape');await skins.apply({accountId:id,id:skin.id});assert.equal(JSON.parse(calls.find(c=>c.options.method==='PUT').options.body).capeId,'owned-cape');assert((await skins.list(id))[0].appliedTextureUrl);await skins.save({accountId:id,id:skin.id,name:'Without cape',variant:'classic',data:image(),capeId:null});await skins.apply({accountId:id,id:skin.id});assert(calls.some(c=>c.options.method==='DELETE'));
});
test('an unavailable saved cape is rejected before changing the Minecraft skin',async t=>{
 const {skins,calls}=await fixture(t);const [skin]=await skins.save({accountId:id,name:'Unowned',variant:'classic',data:image(),capeId:'unowned'});await assert.rejects(skins.apply({accountId:id,id:skin.id}),/no longer owns/);assert.equal(calls.filter(c=>c.options.method==='POST').length,0);
});

test('all nine bundled default skin textures are valid editable Minecraft PNGs',async()=>{
 const vm=require('node:vm'),context=vm.createContext({});vm.runInContext(await fs.readFile(path.join(__dirname,'../src/default-skins.js'),'utf8'),context);const defaults=vm.runInContext('DEFAULT_SKINS',context);assert.equal(defaults.length,9);assert(defaults.some(s=>s.name==='Steve'));assert(defaults.some(s=>s.name==='Alex'&&s.variant==='slim'));for(const skin of defaults)assert(skinPNG(skin.data).length>0);
});
