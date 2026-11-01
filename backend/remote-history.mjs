import core from 'teleproto';
import sessions from 'teleproto/sessions';
import extensions from 'teleproto/extensions';
import { readTdlSession } from './tdl-session.mjs';
import { transportFor } from './remote-thumbnail.mjs';
const {TelegramClient,Api}=core,{StringSession}=sessions,{Logger}=extensions;
const peers=new Map();

async function inputPeer(client,account,chatId,chat,op) {
  if(chatId==='saved')return new Api.InputPeerSelf();
  const key=account.namespace+':'+chatId;
  if(peers.has(key))return peers.get(key);
  if(chat?.username&&/^[a-zA-Z0-9_]+$/.test(chat.username)) {
    const peer=await client.getInputEntity('@'+chat.username);
    if(String(peer.channelId||peer.chatId||peer.userId)===chatId){peers.set(key,peer);return peer;}
  }
  for await(const dialog of client.iterDialogs({})) {
    if(op.status==='cancelled')throw new Error('已取消');
    if(dialog.entity?.id&&dialog.inputEntity)peers.set(account.namespace+':'+dialog.entity.id,dialog.inputEntity);
    if(peers.has(key))return peers.get(key);
  }
  throw new Error('无法定位此会话，请刷新会话列表后重试');
}

// Only locate message IDs here. tdl still reads message content and downloads files.
export async function selectHistoryPage(client,peer,{timestamp,afterId,topic},op={}) {
  async function collect(reverse,offset) {
    const messages=[];
    const options={limit:undefined,reverse,...offset};if(topic)options.replyTo=topic;
    for await(const message of client.iterMessages(peer,options)) {
      if(op.status==='cancelled')throw new Error('已取消');
      if(message.className!=='Message')continue;
      if(afterId&&message.id<=afterId)continue;
      if(reverse&&timestamp&&message.date<timestamp)continue;
      messages.push({id:message.id,date:message.date});if(messages.length>=51)break;
    }
    return messages;
  }
  let reverse=true,messages=await collect(true,afterId?{offsetId:afterId}:{offsetDate:timestamp-1});
  if(timestamp&&!messages.length){reverse=false;messages=await collect(false,{offsetDate:timestamp});}
  const selected=messages.slice(0,50),ids=selected.map(message=>message.id);
  return {ids,oldestId:ids.length?Math.min(...ids):null,newestId:ids.length?Math.max(...ids):null,
    targetId:ids[0]||null,hasMoreOlder:reverse?!!ids.length:messages.length>50,hasMoreNewer:reverse&&messages.length>50};
}

export async function locateHistoryPage({account,chatId,chat,settings,timestamp,afterId,topic,op}) {
  const stored=readTdlSession(account.namespace),address=new URL('tcp://'+stored.address);
  const server=Buffer.from(address.hostname),prefix=Buffer.alloc(3),port=Buffer.alloc(2);
  prefix.writeUInt8(stored.dc,0);prefix.writeUInt16BE(server.length,1);port.writeUInt16BE(Number(address.port||443));
  const sessionBytes=Buffer.concat([prefix,server,port,stored.authKey]);
  const session=new StringSession('1'+sessionBytes.toString('base64'));
  const app=stored.app==='builtin'?{id:15055931,hash:'021d433426cbb920eeb95164498fe3d3'}:{id:2040,hash:'b18441a1ff607e10a989891a5462e627'};
  const client=new TelegramClient(session,app.id,app.hash,{transport:transportFor(settings.proxy),baseLogger:new Logger('none'),connectionRetries:1,requestRetries:1,autoReconnect:false,timeout:10,deviceModel:'TDL Local Workbench',appVersion:'1.0',floodSleepThreshold:0});
  client.onError=()=>{};
  const abort=()=>client.destroy().catch(()=>{});op.abort=abort;let timeout=false;
  const timer=setTimeout(()=>{timeout=true;abort();},45000);
  try {
    await client.connect();if(op.status==='cancelled')throw new Error('已取消');
    const peer=await inputPeer(client,account,chatId,chat,op);
    const result=await selectHistoryPage(client,peer,{timestamp,afterId,topic},op);
    if(timeout)throw new Error('日期定位超时，请稍后重试');
    return result;
  } finally {
    clearTimeout(timer);if(op.abort===abort)op.abort=null;await client.destroy().catch(()=>{});
    stored.authKey.fill(0);sessionBytes.fill(0);try{session.authKey?.getKey()?.fill(0);}catch{}
  }
}
