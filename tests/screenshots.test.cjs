const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const{createScreenshots}=require('../electron/screenshots.cjs');
test('screenshots include all instances, resize previews, copy image bytes and reject paths outside screenshots',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mml-screenshots-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const profiles=[{id:'one',name:'Vanilla'},{id:'two',name:'Archived pack',archived:true}];
 for(const p of profiles){const folder=path.join(directory,'instances',p.id,'game','screenshots');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,p.id+'.png'),p.id);await fs.writeFile(path.join(folder,'ignore.txt'),'ignore');}
 let copied,resized=0;const image={isEmpty:()=>false,getSize:()=>({width:1920,height:1080}),resize:options=>{assert.equal(options.width,480);resized++;return image;},toPNG:()=>Buffer.from('one'),toDataURL:()=> 'data:image/png;base64,cGl4ZWxz'};
 const screenshots=createScreenshots({library:{directory,list:async()=>profiles},nativeImage:{createFromBuffer:bytes=>{assert.equal(bytes.toString(),'one');return image;}},writeImage:async value=>{copied=value;}});
 const items=await screenshots.list();assert.equal(items.length,2);assert(items.some(i=>i.instanceName==='Archived pack'));
 const item=items.find(i=>i.instanceId==='one');assert.equal(await screenshots.image(item),'data:image/png;base64,cGl4ZWxz');await screenshots.image(item);assert.equal(resized,1);await screenshots.copy(item);assert.equal(copied.toString(),'one');
 await assert.rejects(screenshots.copy({...item,fileName:'../one.png'}),/Invalid screenshot/);await assert.rejects(screenshots.image({...item,instanceId:'missing'}),/Instance not found/);
 await fs.writeFile(path.join(directory,'outside.png'),'outside');await assert.rejects(screenshots.copy({...item,fileName:'..\\outside.png'}),/Invalid screenshot/);
});
