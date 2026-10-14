const fs=require('node:fs/promises');
const path=require('node:path');
function createScreenshots({library,nativeImage,writeImage}){
  const cache=new Map();
  async function folder(instanceId){
    if(typeof instanceId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(instanceId)||(await library.list()).every(p=>p.id!==instanceId))throw new Error('Instance not found.');
    const root=await fs.realpath(library.directory),candidate=path.join(root,'instances',instanceId,'game','screenshots'),real=await fs.realpath(candidate);
    if(real!==candidate)throw new Error('Screenshot folders must be inside the instance.');
    return real;
  }
  async function locate(input){
    if(!input||typeof input.fileName!=='string'||input.fileName!==path.basename(input.fileName)||/[\\/:\x00-\x1f]/.test(input.fileName)||! /\.(png|jpe?g|webp)$/i.test(input.fileName))throw new Error('Invalid screenshot.');
    const directory=await folder(input.instanceId),file=path.join(directory,input.fileName),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw new Error('Screenshot is unavailable or too large.');
    if(await fs.realpath(file)!==file)throw new Error('Invalid screenshot path.');
    return{file,stat};
  }
  return{
    async list(){const items=[];for(const p of await library.list()){let directory;try{directory=await folder(p.id);}catch{continue;}for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(!entry.isFile()||! /\.(png|jpe?g|webp)$/i.test(entry.name))continue;try{const stat=await fs.lstat(path.join(directory,entry.name));if(!stat.isFile()||stat.size>64*1024*1024)continue;items.push({instanceId:p.id,instanceName:p.name,fileName:entry.name,modifiedAt:stat.mtime.toISOString(),size:stat.size});}catch{/* A screenshot may be removed while refreshing. */}}}return items.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));},
    async image(input){const{file,stat}=await locate(input),key=file+'|'+stat.mtimeMs+'|'+stat.size+'|'+Boolean(input.full);if(!input.full&&cache.has(key))return cache.get(key);let image=nativeImage.createFromBuffer(await fs.readFile(file));if(image.isEmpty())throw new Error('Screenshot image could not be read.');if(!input.full){const size=image.getSize();image=image.resize({width:Math.min(480,size.width)});}const data=image.toDataURL();if(!input.full){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,data)};return data;},
    async copy(input){const{file}=await locate(input);const image=nativeImage.createFromBuffer(await fs.readFile(file));if(image.isEmpty())throw new Error('Screenshot image could not be read.');await writeImage(image.toPNG());return true;}
  };
}
module.exports={createScreenshots};
