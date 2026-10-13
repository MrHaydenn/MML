const fs=require('node:fs/promises');
const path=require('node:path');
const ACCOUNT_SERVICE='https://accounts.mrhaydenn.us';
function createAccount({directory,safeStorage,fetcher=fetch}) {
  // Preserve the existing encrypted Haydenn Accounts session filename.
  const file=path.join(directory,'mmsm-connection.bin');let connection=null,busy=false;
  const current=()=>connection?{connected:true,serviceUrl:ACCOUNT_SERVICE,user:connection.user,expires:connection.expires}:{connected:false};
  async function request(route,body,token){
    let response;try{response=await fetcher(ACCOUNT_SERVICE+'/api/'+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new Error('Could not reach Haydenn Accounts. Check your connection and try again.');}
    if(!response.ok){const error=new Error(response.status===401?(route==='login'?'Invalid username or password.':'Account session expired or revoked. Sign in again.'):response.status===429?'Too many sign-in attempts. Wait a moment and try again.':'Haydenn Accounts access denied or service unavailable.');error.status=response.status;throw error;}
    const text=await response.text();if(text.length>65536)throw new Error('Invalid account service response.');return JSON.parse(text);
  }
  function user(value){if(typeof value.user?.id!=='string'||typeof value.user.username!=='string'||!Number.isFinite(value.expires)||value.expires<=Date.now()/1000)throw new Error('Invalid account service response.');return {id:value.user.id,username:value.user.username,role:'member'};}
  async function save(){if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable.');await fs.mkdir(directory,{recursive:true});await fs.writeFile(file+'.tmp',safeStorage.encryptString(JSON.stringify(connection)));await fs.rename(file+'.tmp',file);}
  async function clear(){connection=null;await fs.rm(file,{force:true});}
  async function refresh(){if(!connection)return current();try{const result=await request('me',null,connection.accessToken),identity=user(result);if(identity.id!==connection.user.id)throw new Error('Account identity changed. Sign in again.');connection={...connection,user:identity,expires:result.expires};await save();return current();}catch(error){if(error.status===401)await clear();throw error;}}
  async function exclusive(fn){if(busy)throw new Error('An account request is already running.');busy=true;try{return await fn();}finally{busy=false;}}
  return {current,refresh:()=>exclusive(refresh),
    restore:()=>exclusive(async()=>{
      let stored;try{const bytes=await fs.readFile(file);if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable.');stored=JSON.parse(safeStorage.decryptString(bytes));}catch(error){if(error.code==='ENOENT')return current();throw new Error('Saved Haydenn Accounts session could not be opened. Sign in again.');}
      if(stored.mode!=='central'||stored.serviceUrl!==ACCOUNT_SERVICE){await clear();return current();}
      user(stored);if(!/^[A-Za-z0-9_-]{43}$/.test(stored.accessToken||''))throw new Error('Invalid saved account session.');connection=stored;return refresh();
    }),
    connect:input=>exclusive(async()=>{
      if(connection)throw new Error('Sign out before connecting another account.');if(typeof input?.username!=='string'||!input.username.trim()||typeof input.password!=='string'||!input.password)throw new Error('Enter your username and password.');if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable.');
      const result=await request('login',{username:input.username.trim(),password:input.password,audience:'mml'}),identity=user(result);if(!/^[A-Za-z0-9_-]{43}$/.test(result.token||''))throw new Error('Invalid account service token.');
      connection={mode:'central',serviceUrl:ACCOUNT_SERVICE,user:identity,accessToken:result.token,expires:result.expires};try{await save();}catch(error){await request('logout',{},result.token).catch(()=>{});connection=null;throw error;}return current();
    }),
    disconnect:()=>exclusive(async()=>{if(connection)try{await request('logout',{},connection.accessToken);}catch(error){if(error.status!==401)throw error;}await clear();return current();})
  };
}
module.exports={createAccount,ACCOUNT_SERVICE};
