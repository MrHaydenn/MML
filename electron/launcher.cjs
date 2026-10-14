const fs = require('node:fs/promises');
const path = require('node:path');
const { MinecraftFolder, Version, launch } = require('@xmcl/core');
const installer = require('@xmcl/installer');

const SYNC_FILES = ['options.txt', 'servers.dat'];
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Download service unavailable (HTTP ${response.status}).`);
  return response.json();
}
async function regular(file) {
  try { const info = await fs.lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error('Settings sync requires ordinary files smaller than 8 MB.'); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function syncSettings(game, shared, direction) {
  await fs.mkdir(shared, { recursive: true }); await fs.mkdir(game, { recursive: true });
  for (const folder of [game,shared]) if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('Settings sync cannot use linked folders.');
  for (const name of SYNC_FILES) {
    const local = path.join(game, name), central = path.join(shared, name);
    const hasLocal = await regular(local), hasCentral = await regular(central);
    if (direction === 'pull' && hasCentral) {
      if (hasLocal) { const backup = local + '.mml-before-sync'; if (await regular(backup)) await fs.rm(backup); await fs.copyFile(local, backup); }
      await fs.copyFile(central, local);
    } else if (hasLocal) { const temp = central + '.tmp'; if (await regular(temp)) await fs.rm(temp); await fs.copyFile(local, temp); await fs.rename(temp, central); }
  }
}

function createLauncher({ directory, library, content, accounts, notify = () => {}, now=Date.now, platform = process.platform, install = installer, core = { MinecraftFolder, Version, launch }, fetchJson = json }) {
  const resources = path.join(directory, 'minecraft'), shared = path.join(directory, 'shared-settings');
  const running = new Map(), statuses = new Map(); let preparing = null;
  const status = (id, value) => { const entry=running.get(id);const next = { instanceId: id, ...(entry?{sessionStartedAt:entry.startedAt,basePlaytimeSeconds:entry.basePlaytimeSeconds}:{}), ...value }; statuses.set(id,next); notify(next); return next; };
  const state = () => [...statuses.values()];
  const active = id => preparing === id || running.has(id);
  function guard(id) { if (active(id)) throw new Error('Stop this Minecraft instance before changing its files or settings.'); }
  async function prepare(profile) {
    if (platform !== 'win32') throw new Error('Minecraft launching currently supports Windows only.');
    const folder = core.MinecraftFolder.from(resources);
    await fs.mkdir(resources,{recursive:true});
    const runtime = install.createDefaultNodeInstallRuntime({ maxConcurrency: 8 });
    const executeFiles = files => install.executeInstallManifest({schemaVersion:1,tasks:[{id:'files',type:'files',files}]},runtime);
    status(profile.id,{state:'preparing',message:'Checking Minecraft game files…'});
    let metadata;
    try { metadata = JSON.parse(await fs.readFile(folder.getVersionJson(profile.gameVersion),'utf8')); }
    catch(error) { if(error.code !== 'ENOENT') throw error;
      const list = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      const entry = list.versions.find(v=>v.id===profile.gameVersion); if (!entry) throw new Error('Minecraft version is no longer listed by Mojang.');
      await executeFiles([install.resolveMinecraftVersionJsonInstallFile(entry,folder)]);
      metadata = JSON.parse(await fs.readFile(folder.getVersionJson(profile.gameVersion),'utf8'));
    }
    let version = await core.Version.parse(folder,profile.gameVersion);
    const component = metadata.javaVersion?.component || 'jre-legacy';
    if (!/^[a-z0-9-]+$/.test(component)) throw new Error('Invalid Java runtime component.');
    const javaHome = path.join(directory,'java',component), javaPath = path.join(javaHome,'bin','java.exe');
    const expectedJava = metadata.javaVersion?.majorVersion || 8;
    const installedJava = await install.resolveJava(javaPath);
    if (!installedJava || installedJava.majorVersion !== expectedJava) {
      status(profile.id,{state:'preparing',message:`Installing Java ${expectedJava} from Mojang…`});
      const index = await fetchJson(install.DEFAULT_RUNTIME_ALL_URL), target = index['windows-x64']?.[component]?.[0];
      if (!target) throw new Error(`Mojang does not provide the required Java ${expectedJava} runtime for Windows x64.`);
      await install.executeInstallWorkflow(install.createJavaRuntimeInstallWorkflow({target,destination:javaHome}),runtime);
      const actualJava = await install.resolveJava(javaPath);
      if (!actualJava || actualJava.majorVersion !== expectedJava) throw new Error('Installed Java version does not match this Minecraft instance.');
    }
    const jar = install.resolveMinecraftJarInstallFile(version); if(jar) await executeFiles([jar]);
    let versionId = profile.gameVersion, loaderVersion = profile.loaderVersion;
    if (profile.loader !== 'vanilla') {
      status(profile.id,{state:'preparing',message:`Installing ${profile.loader} loader…`});
      if (['fabric','quilt'].includes(profile.loader)) {
        if(!loaderVersion) {
          const list = await fetchJson(`https://meta.${profile.loader==='fabric'?'fabricmc.net/v2':'quiltmc.org/v3'}/versions/loader/${profile.gameVersion}`);
          const sorted=[...list].sort((a,b)=>b.loader.version.localeCompare(a.loader.version,undefined,{numeric:true}));
          loaderVersion = (sorted.find(v=>v.loader.stable!==false&&!/beta|alpha|rc/i.test(v.loader.version)) || sorted[0])?.loader.version;
        }
        // Fabric metadata uses v2, while Quilt uses v3.
        if(!loaderVersion) throw new Error('No compatible loader version is available.');
        const workflow = profile.loader === 'fabric' ? install.createFabricInstallWorkflow : install.createQuiltInstallWorkflow;
        versionId = await install.executeInstallWorkflow(workflow({minecraft:folder,minecraftVersion:profile.gameVersion,version:loaderVersion}),runtime);
      } else {
        if(!loaderVersion && profile.loader==='forge') { const promotions = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'); loaderVersion = promotions.promos[profile.gameVersion+'-recommended'] || promotions.promos[profile.gameVersion+'-latest']; }
        if(!loaderVersion && profile.loader==='neoforge') { const index = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'); const parts=profile.gameVersion.split('.'); const prefix=Number(parts[0])>=26?profile.gameVersion+'.':parts[1]+'.'+(parts[2]||'0')+'.'; loaderVersion=index.versions?.filter(v=>v.startsWith(prefix)&&!v.includes('beta')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1); }
        if(!loaderVersion) throw new Error('No compatible loader version is available. Install a modpack with a pinned loader version.');
        const options = {java:javaPath,side:'client'};
        const artifact = profile.loader==='forge' ? install.resolveForgeArtifactVersion(profile.gameVersion,loaderVersion) : loaderVersion;
        const resolved = profile.loader==='forge' ? install.resolveForgeInstallerFile(artifact,undefined,folder,options) : await install.resolveNeoForgedInstallerFile('neoforge',loaderVersion,folder,options);
        const result = await install.executeInstallWorkflow(install.createModernForgeInstallWorkflow({id:`mml-${profile.loader}-${profile.gameVersion}-${loaderVersion}`,minecraft:folder,minecraftVersion:profile.gameVersion,artifactVersion:artifact,installer:resolved.file,java:javaPath,installOptions:options}),runtime);
        versionId = result.version;
      }
      version = await core.Version.parse(folder,versionId);
    }
    status(profile.id,{state:'preparing',message:'Downloading and verifying libraries and assets. First play may take a few minutes…'});
    await executeFiles(install.resolveLibraryInstallFiles(version.libraries,folder));
    await install.executeInstallManifest(install.resolveAssetMetadataInstallManifest(version,folder),runtime);
    await executeFiles(await install.resolveAssetObjectInstallFiles(version,folder));
    return {version,javaPath,resources,loaderVersion};
  }
  async function play(id) {
    if(preparing) throw new Error('Another Minecraft instance is being prepared.'); guard(id);
    if(content.isBusy()) throw new Error('Wait for content installation to finish.');
    preparing=id; let session;
    try {
      let profile=(await library.list()).find(p=>p.id===id); if(!profile) throw new Error('Instance not found.');
      if(profile.syncSettings && [...running.values()].some(r=>r.syncSettings)) throw new Error('Only one instance with shared settings can run at a time.');
      status(id,{state:'preparing',message:'Checking your Minecraft account…'}); session=await accounts.launchSession();
      if(profile.source&&profile.packUpdates!==false&&content.syncPack){status(id,{state:'preparing',message:'Checking and matching linked modpack files…'});await content.syncPack(id);profile=(await library.list()).find(p=>p.id===id);}
      const prepared=await prepare(profile), game=path.join(content.instancePath(id),'game');
      await fs.mkdir(game,{recursive:true});
      if((await fs.lstat(content.instancePath(id))).isSymbolicLink() || (await fs.lstat(game)).isSymbolicLink()) throw new Error('Cannot launch an instance through a linked folder.');
      if(profile.syncSettings) await syncSettings(game,shared,'pull');
      status(id,{state:'preparing',message:`Starting Minecraft as ${session.name}…`});
      const child=await core.launch({gamePath:game,resourcePath:resources,javaPath:prepared.javaPath,version:prepared.version,gameProfile:{id:session.id,name:session.name},accessToken:session.accessToken,userType:'mojang',launcherName:'MML',launcherBrand:'MML',minMemory:512,maxMemory:profile.memoryMb || 4096,extraExecOption:{windowsHide:true}});
      const startedAt=now(),entry={child,syncSettings:profile.syncSettings,startedAt,basePlaytimeSeconds:profile.playtimeSeconds||0};running.set(id,entry);
      let recorded=0,statsFailed=false,statsQueue=Promise.resolve();
      const started=library.startSession?library.startSession(id,startedAt).catch(()=>{statsFailed=true;}):Promise.resolve();
      const checkpoint=endedAt=>{statsQueue=statsQueue.then(async()=>{await started;if(!library.recordPlaytime)return;const total=Math.max(0,Math.floor((endedAt-startedAt)/1000)),delta=total-recorded;if(delta>0){try{await library.recordPlaytime(id,delta);recorded=total;}catch{statsFailed=true;}}});return statsQueue;};
      const heartbeat=setInterval(()=>{if(!entry.closing)checkpoint(now());},60000);heartbeat.unref?.();

      const logFile=path.join(content.instancePath(id),'mml-launch.log'); let log='',writeQueue=Promise.resolve();
      const redact=text=>String(text).split(session.accessToken).join('[redacted]').replace(/(--accessToken\s+)\S+/g,'$1[redacted]');
      const logChunk=chunk=>{log=redact(log+String(chunk)).slice(-512*1024);writeQueue=writeQueue.then(()=>fs.writeFile(logFile,log)).catch(()=>{});};
      child.stdout?.on('data',logChunk);child.stderr?.on('data',logChunk);
      child.once('error',error=>{logChunk(error.message); status(id,{state:'error',message:'The Minecraft process could not run. Open Logs for details.'});});
      child.once('close',async code=>{
        entry.closing=true;clearInterval(heartbeat);const endedAt=now(),stopped=running.get(id)?.stopping;await writeQueue;await checkpoint(endedAt);running.delete(id);
        try{if(profile.syncSettings) await syncSettings(game,shared,'push'); status(id,{state:code===0||stopped?'stopped':'error',message:code===0||stopped?(statsFailed?'Minecraft stopped. Some playtime could not be saved.':'Minecraft stopped.'):`Minecraft exited with code ${code}. Open Logs for details.`});}
        catch{status(id,{state:'error',message:'Minecraft stopped, but shared settings could not be saved.'});}
      });
      return status(id,{state:'running',message:`Playing as ${session.name}`});
    } catch(error) { const message=session?.accessToken ? String(error.message).split(session.accessToken).join('[redacted]') : error.message; status(id,{state:'error',message}); throw new Error(message); }
    finally {preparing=null;}
  }
  return {play,prepare,state,active,guard,anyActive:()=>Boolean(preparing)||running.size>0,stop:id=>{const entry=running.get(id);if(!entry)throw new Error('This instance is not running.');entry.stopping=true;entry.child.kill();return status(id,{state:'stopping',message:'Stopping Minecraft…'});},
    logs:async id=>{try{return (await fs.readFile(path.join(content.instancePath(id),'mml-launch.log'),'utf8')).slice(-512*1024);}catch(error){if(error.code==='ENOENT')return 'No launch log yet. Play this instance to create one.';throw error;}}};
}
module.exports={createLauncher,syncSettings};
