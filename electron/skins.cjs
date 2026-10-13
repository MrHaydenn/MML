const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PNG}=require('pngjs');
function skinPNG(value){
  if(typeof value!=='string'||value.length>100000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))throw new Error('Choose a PNG skin (64 × 64 or 64 × 32).');
  const bytes=Buffer.from(value.split(',')[1],'base64');
  if(bytes.length<24||bytes.readUInt32BE(16)!==64||![32,64].includes(bytes.readUInt32BE(20)))throw new Error('Skins must be 64 × 64 or 64 × 32 pixels.');
  let image;try{image=PNG.sync.read(bytes,{checkCRC:true});}catch{throw new Error('The skin PNG could not be read.');}
  if(image.width!==64||![32,64].includes(image.height))throw new Error('Invalid skin dimensions.');
  return PNG.sync.write(image);
}
const textureURL=value=>/^https?:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(value||'')?value.replace(/^http:/,'https:'):null;
function createSkins({directory,accounts,fetcher=fetch}){
  let queue=Promise.resolve();
  const owner=id=>{if(!/^[a-f0-9]{32}$/i.test(id||'')||!accounts.state().accounts.some(a=>a.id===id))throw new Error('Select a connected Minecraft account.');return path.join(directory,id+'.json');};
  async function list(id){try{const items=JSON.parse(await fs.readFile(owner(id),'utf8'));if(!Array.isArray(items))throw new Error();return items;}catch(error){if(error.code==='ENOENT')return [];throw new Error('Skin library could not be read; existing skins were preserved.');}}
  function mutate(id,fn){const task=queue.then(async()=>{const file=owner(id),items=await fn(await list(id));await fs.mkdir(directory,{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(items));await fs.rename(file+'.tmp',file);return items;});queue=task.catch(()=>{});return task;}
  async function session(id){owner(id);const session=await accounts.launchSession();if(session.id!==id)throw new Error('Minecraft account changed. Select the active account and try again.');return session;}
  async function request(route,session,options={}){
    let response;try{response=await fetcher('https://api.minecraftservices.com/minecraft/profile'+route,{...options,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+session.accessToken,...options.headers}});}catch{throw new Error('Could not reach Minecraft. Your local skin library is unchanged.');}
    if(!response.ok)throw new Error(response.status===401?'Minecraft session expired. Sign in again.':response.status===429?'Minecraft is limiting requests. Wait a moment and retry.':`Minecraft rejected the appearance change (HTTP ${response.status}). Check your account permissions and try again.`);
    if(response.status===204)return null;return response.json();
  }
  async function profile(id){const auth=await session(id),profile=await request('',auth);if(profile.id!==id)throw new Error('Minecraft returned a different account.');await accounts.cacheProfile?.(profile);return {id:profile.id,name:profile.name,skins:(profile.skins||[]).map(s=>({id:s.id,state:s.state,url:textureURL(s.url),variant:s.variant})),capes:(profile.capes||[]).map(c=>({id:c.id,state:c.state,url:textureURL(c.url),name:String(c.alias||'Cape')}))};}
  return {
    list,
    save:({accountId,id,name,variant,data})=>mutate(accountId,items=>{if(typeof name!=='string'||!name.trim()||name.length>60||!['classic','slim'].includes(variant))throw new Error('Enter a skin name and arm style.');const png=skinPNG(data);if(id&&!items.some(s=>s.id===id))throw new Error('Skin not found.');if(!id&&items.length>=100)throw new Error('Your skin library is full (100 skins).');const skin={id:id||randomUUID(),name:name.trim(),variant,data:'data:image/png;base64,'+png.toString('base64'),updatedAt:Date.now()};return items.filter(s=>s.id!==skin.id).concat(skin);}),
    remove:({accountId,id})=>mutate(accountId,items=>items.filter(s=>s.id!==id)),
    profile,
    async texture(url){const safe=textureURL(url);if(!safe)throw new Error('Invalid Minecraft texture.');const response=await fetcher(safe,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Texture download failed.');if(Number(response.headers.get('content-length'))>100000)throw new Error('Texture too large.');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>100000)throw new Error('Texture too large.');return 'data:image/png;base64,'+bytes.toString('base64');},
    async apply({accountId,id}){const skin=(await list(accountId)).find(s=>s.id===id);if(!skin)throw new Error('Skin not found.');const auth=await session(accountId),form=new FormData();form.append('variant',skin.variant);form.append('file',new Blob([skinPNG(skin.data)],{type:'image/png'}),'skin.png');await request('/skins',auth,{method:'POST',body:form});return profile(accountId);},
    async cape({accountId,id}){const before=await profile(accountId);if(id&&!before.capes.some(c=>c.id===id))throw new Error('This Minecraft account does not own that cape.');const auth=await session(accountId);await request('/capes/active',auth,{method:id?'PUT':'DELETE',...(id?{headers:{'Content-Type':'application/json'},body:JSON.stringify({capeId:id})}:{})});return profile(accountId);}
  };
}
module.exports={createSkins,skinPNG,textureURL};
