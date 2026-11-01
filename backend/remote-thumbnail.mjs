import core from 'teleproto';
import sessions from 'teleproto/sessions';
import extensions from 'teleproto/extensions';
import transports from 'teleproto/network/transport/index.js';
import bigInt from 'big-integer';
import { readTdlSession } from './tdl-session.mjs';

const {TelegramClient,Api}=core;
const {StringSession}=sessions;
const {Logger}=extensions;
const {HttpProxyTransport,SocksTransport,TcpTransport}=transports;

export function thumbnailLocation(info) {
  if(!info||!['document','photo'].includes(info.kind)||!info.thumbSize||!/^[a-zA-Z0-9]$/.test(info.thumbSize)||info.thumbSize==='i')throw new Error('消息没有提供可下载的独立缩略图');
  const params={id:bigInt(info.id),accessHash:bigInt(info.accessHash),fileReference:Buffer.from(info.fileReference,'base64'),thumbSize:info.thumbSize};
  return info.kind==='document'?new Api.InputDocumentFileLocation(params):new Api.InputPhotoFileLocation(params);
}
export function transportFor(value) {
  if(!value)return new TcpTransport();
  const proxy=new URL(value);
  const options={host:proxy.hostname,port:Number(proxy.port||8080),username:proxy.username?decodeURIComponent(proxy.username):undefined,password:proxy.password?decodeURIComponent(proxy.password):undefined,timeout:10};
  if(['http:','https:'].includes(proxy.protocol))return new HttpProxyTransport({...options,tls:proxy.protocol==='https:'});
  if(proxy.protocol==='socks5:')return new SocksTransport({...options,version:5});
  throw new Error('缩略图连接暂不支持这个代理类型');
}
export async function downloadRemoteThumbnail(account,settings,info,op={}) {
  const location=thumbnailLocation(info);
  const stored=readTdlSession(account.namespace);
  const address=new URL('tcp://'+stored.address);
  const server=Buffer.from(address.hostname),prefix=Buffer.alloc(3),port=Buffer.alloc(2);
  prefix.writeUInt8(stored.dc,0);prefix.writeUInt16BE(server.length,1);port.writeUInt16BE(Number(address.port||443));
  const sessionBytes=Buffer.concat([prefix,server,port,stored.authKey]);
  const session=new StringSession('1'+sessionBytes.toString('base64'));
  const app=stored.app==='builtin'?{id:15055931,hash:'021d433426cbb920eeb95164498fe3d3'}:{id:2040,hash:'b18441a1ff607e10a989891a5462e627'};
  const client=new TelegramClient(session,app.id,app.hash,{transport:transportFor(settings.proxy),baseLogger:new Logger('none'),
    connectionRetries:1,requestRetries:1,autoReconnect:false,timeout:10,deviceModel:'TDL Local Workbench',appVersion:'1.0',floodSleepThreshold:0});
  client.onError=()=>{};
  let timedOut=false;
  op.abort=()=>client.destroy().catch(()=>{});
  const timer=setTimeout(()=>{timedOut=true;op.abort();},45000);
  try {
    op.log=(op.log||'')+'正在读取 Telegram 独立缩略图…\n';
    await client.connect();
    if(op.status==='cancelled')throw new Error('已取消');
    const buffer=await client.downloadFile(location,{dcId:info.dcId,fileSize:info.size?bigInt(info.size):undefined,partSizeKb:32});
    if(timedOut)throw new Error('缩略图连接超时，请重试');
    if(op.status==='cancelled')throw new Error('已取消');
    if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>8*1024*1024)throw new Error('服务器未返回有效的缩略图');
    return {buffer,bytes:buffer.length,width:info.width,height:info.height,source:'telegram-thumbnail'};
  } finally {
    clearTimeout(timer);op.abort=null;
    await client.destroy().catch(()=>{});
    stored.authKey.fill(0);sessionBytes.fill(0);
    try{session.authKey?.getKey()?.fill(0);}catch{}
  }
}
