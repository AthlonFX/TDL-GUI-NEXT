import fs from 'node:fs';
import core from 'teleproto';
import sessions from 'teleproto/sessions';
import extensions from 'teleproto/extensions';
import {readTdlSession,tdlSessionFile} from './tdl-session.mjs';
import {transportFor} from './remote-thumbnail.mjs';
const {TelegramClient,Api}=core,{StringSession}=sessions,{Logger}=extensions;
const revoked=error=>/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|AUTH_KEY_INVALID|USER_DEACTIVATED/.test(String(error?.errorMessage||error?.message||''));

export async function logoutAccount(account,settings,options={}){
  const filename=tdlSessionFile(account.namespace,options);
  if(!fs.existsSync(filename))return {revoked:true,alreadyLoggedOut:true,userId:account.userId||''};
  if(fs.lstatSync(filename).isSymbolicLink()||!fs.statSync(filename).isFile())throw new Error('登录文件路径异常，已停止退出操作');
  let stored,sessionBytes,client=options.client,userId=account.userId||'';
  if(!client){
    stored=readTdlSession(account.namespace,options);
    const address=new URL('tcp://'+stored.address),server=Buffer.from(address.hostname),prefix=Buffer.alloc(3),port=Buffer.alloc(2);
    prefix.writeUInt8(stored.dc,0);prefix.writeUInt16BE(server.length,1);port.writeUInt16BE(Number(address.port||443));
    sessionBytes=Buffer.concat([prefix,server,port,stored.authKey]);
    const app=stored.app==='builtin'?{id:15055931,hash:'021d433426cbb920eeb95164498fe3d3'}:{id:2040,hash:'b18441a1ff607e10a989891a5462e627'};
    client=new TelegramClient(new StringSession('1'+sessionBytes.toString('base64')),app.id,app.hash,{transport:transportFor(settings.proxy),baseLogger:new Logger('none'),connectionRetries:1,requestRetries:1,autoReconnect:false,timeout:10,deviceModel:'TDL-GUI-NEXT',appVersion:'1.0',floodSleepThreshold:0});
    client.onError=()=>{};
  }
  let timer;
  try{
    await Promise.race([(async()=>{
      try{
        await client.connect();
        if(!userId&&client.getMe)try{userId=String((await client.getMe()).id);}catch{}
        await client.invoke(new Api.auth.LogOut());
      }catch(error){if(!revoked(error))throw error;}
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{client.destroy().catch(()=>{});reject(new Error('退出登录连接超时，请检查代理后重试'));},30000);timer.unref();})]);
    let warning='';
    try{if(fs.existsSync(filename)){if(fs.lstatSync(filename).isSymbolicLink())throw new Error('登录文件已变更');fs.unlinkSync(filename);}}
    catch{warning='Telegram 登录已注销，但本机登录文件清理失败。该文件内的旧登录已失效。';}
    return {revoked:true,userId,warning};
  }finally{clearTimeout(timer);await client.destroy().catch(()=>{});stored?.authKey.fill(0);sessionBytes?.fill(0);}
}
