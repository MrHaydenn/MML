const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {MinecraftFolder}=require('@xmcl/core');const {createLauncher,syncSettings}=require('../electron/launcher.cjs');
async function setup(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mml-launch-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const profile={id:'instance',gameVersion:'1.21.1',loader:'vanilla',memoryMb:6144};
 const folder=MinecraftFolder.from(path.join(directory,'minecraft'));await fs.mkdir(folder.getVersionRoot('1.21.1'),{recursive:true});await fs.writeFile(folder.getVersionJson('1.21.1'),JSON.stringify({javaVersion:{component:'java-runtime-delta',majorVersion:21}}));
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};let options;
 const content={isBusy:()=>false,instancePath:id=>path.join(directory,'instances',id)};
 const install={createDefaultNodeInstallRuntime:()=>({}),resolveJava:async()=>({majorVersion:21}),resolveMinecraftJarInstallFile:()=>undefined,executeInstallManifest:async()=>{},resolveLibraryInstallFiles:()=>[],resolveAssetMetadataInstallManifest:()=>({tasks:[]}),resolveAssetObjectInstallFiles:async()=>[]};
 const core={MinecraftFolder,Version:{parse:async()=>({id:'1.21.1',libraries:[]})},launch:async value=>{options=value;return child;}};
 const accounts={launchSession:async()=>({id:'1'.repeat(32),name:'TestPlayer',accessToken:'private-access-token'})};
 const engine=createLauncher({directory,library:{list:async()=>[profile]},content,accounts,core,install,platform:'win32'});
 return {directory,profile,content,accounts,engine,child,options:()=>options};
}
test('Play uses a verified account, isolated game directory and memory setting; running instances cannot be modified',async t=>{
 const f=await setup(t);assert.equal((await f.engine.play('instance')).state,'running');
 assert.equal(f.options().maxMemory,6144);assert.equal(f.options().gameProfile.name,'TestPlayer');assert.equal(f.options().accessToken,'private-access-token');assert.equal(f.options().gamePath,path.join(f.directory,'instances/instance/game'));
 assert(!JSON.stringify(f.engine.state()).includes('private-access-token'));assert.throws(()=>f.engine.guard('instance'),/Stop/);await assert.rejects(f.engine.play('instance'),/Stop/);
 f.child.stdout.write('token private-access-token --accessToken private-access-token');f.child.emit('close',0);
 await new Promise(r=>setTimeout(r,25));assert.match(await f.engine.logs('instance'),/redacted/);assert(!(await f.engine.logs('instance')).includes('private-access-token'));assert.equal(f.engine.active('instance'),false);
});
test('Play fails before downloads or Java launch when Minecraft authentication fails',async t=>{
 const f=await setup(t);f.accounts.launchSession=async()=>{throw new Error('Sign in first');};await assert.rejects(f.engine.play('instance'),/Sign in first/);assert.equal(f.options(),undefined);assert.equal(f.engine.active('instance'),false);
});
test('concurrent preparation is rejected and manual stop is reported as stopped',async t=>{
 const f=await setup(t);let release;f.accounts.launchSession=()=>new Promise(r=>{release=r;});const first=f.engine.play('instance');await new Promise(r=>setImmediate(r));await assert.rejects(f.engine.play('instance'),/being prepared/);release({id:'1'.repeat(32),name:'Player',accessToken:'token'});await first;f.engine.stop('instance');f.child.emit('close',1);await new Promise(r=>setTimeout(r,20));assert.equal(f.engine.state()[0].state,'stopped');
});
test('settings sync shares options and servers, backs up prior options and leaves worlds separate',async t=>{
 const f=await setup(t),game=path.join(f.directory,'game'),shared=path.join(f.directory,'shared');await fs.mkdir(game);await fs.writeFile(path.join(game,'options.txt'),'first');await fs.mkdir(path.join(game,'saves'));await fs.writeFile(path.join(game,'saves/world.txt'),'world');
 await syncSettings(game,shared,'pull');assert.equal(await fs.readFile(path.join(shared,'options.txt'),'utf8'),'first');await fs.writeFile(path.join(shared,'options.txt'),'shared');await syncSettings(game,shared,'pull');assert.equal(await fs.readFile(path.join(game,'options.txt'),'utf8'),'shared');assert.equal(await fs.readFile(path.join(game,'options.txt.mml-before-sync'),'utf8'),'first');assert.equal(await fs.readFile(path.join(game,'saves/world.txt'),'utf8'),'world');
 await fs.writeFile(path.join(game,'servers.dat'),'servers');await syncSettings(game,shared,'push');assert.equal(await fs.readFile(path.join(shared,'servers.dat'),'utf8'),'servers');
});
