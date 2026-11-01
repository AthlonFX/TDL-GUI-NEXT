import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
const exec=promisify(execFile);
export function proxyUrl(value){
  if(typeof value!=='string'||!value.trim())throw new Error('请填写代理地址');
  let url;try{url=new URL(value.trim());}catch{throw new Error('代理地址格式不正确，例如 http://127.0.0.1:7897');}
  if(!['http:','https:','socks5:'].includes(url.protocol)||!url.hostname||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('代理地址应为 HTTP、HTTPS 或 SOCKS5 地址');
  return url.href.replace(/\/$/,'');
}
export function proxyChoice(input,current={}){
  const proxyMode=input.proxyMode??current.proxyMode??'custom';
  if(!['none','system','custom'].includes(proxyMode))throw new Error('请选择有效的代理模式');
  const value=input.customProxy??input.proxy??current.customProxy??current.proxy??'';
  const customProxy=proxyMode==='custom'?proxyUrl(value):String(value||'').trim();
  return {proxyMode,customProxy,proxy:customProxy};
}
export function proxyFromPac(result){
  const first=String(result||'DIRECT').split(';')[0].trim();
  if(first==='DIRECT')return '';
  const match=first.match(/^(PROXY|HTTP|HTTPS|SOCKS5|SOCKS)\s+(.+)$/i);
  if(!match)throw new Error('系统代理类型暂不支持，请改用自定义代理');
  return proxyUrl(`${/socks/i.test(match[1])?'socks5':/^https$/i.test(match[1])?'https':'http'}://${match[2]}`);
}
export function proxyFromRegistry(values){
  if(!values.enabled)return '';
  const server=String(values.server||'').trim();if(!server)return '';
  const parts=new Map(server.split(';').map(part=>part.split('=').map(value=>value.trim())));
  const chosen=server.includes('=')?(parts.get('https')||parts.get('http')||parts.get('socks')):server;
  if(!chosen)throw new Error('系统没有可用的 HTTP 或 SOCKS5 代理');
  return proxyUrl(chosen.includes('://')?chosen:`${!parts.get('https')&&!parts.get('http')&&parts.get('socks')?'socks5':'http'}://${chosen}`);
}
let pendingSystem=new Map();
process.on('message',message=>{if(message?.type!=='system-proxy-result')return;const item=pendingSystem.get(message.id);if(item){clearTimeout(item.timer);pendingSystem.delete(message.id);message.error?item.reject(new Error(message.error)):item.resolve(message.result);}});
async function systemProxy(){
  if(process.env.TDL_WORKBENCH_DESKTOP==='1'&&process.connected){
    const result=await new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{pendingSystem.delete(id);reject(new Error('读取系统代理超时，请重试'));},10000);pendingSystem.set(id,{resolve,reject,timer});process.send({type:'resolve-system-proxy',id});});
    return proxyFromPac(result);
  }
  if(process.platform!=='win32')return '';
  const {stdout}=await exec('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{windowsHide:true,timeout:5000});
  const value=name=>stdout.match(new RegExp(`\\s${name}\\s+REG_\\w+\\s+([^\\r\\n]+)`))?.[1]?.trim()||'';
  if(value('AutoConfigURL'))throw new Error('系统使用自动代理脚本，请通过桌面版读取，或选择自定义代理');
  return proxyFromRegistry({enabled:parseInt(value('ProxyEnable')||'0',16)!==0,server:value('ProxyServer')});
}
export async function resolveConnection(settings){
  const choice=proxyChoice({},settings);
  const proxy=choice.proxyMode==='none'?'':choice.proxyMode==='system'?await systemProxy():choice.customProxy;
  return {mode:choice.proxyMode,proxy,label:proxy?choice.proxyMode==='system'?'系统代理':'自定义代理':'直连'};
}
function connected(socket){return new Promise((resolve,reject)=>{const done=()=>{cleanup();socket.setTimeout(0);resolve(socket);},fail=error=>{cleanup();socket.destroy();reject(error);},timeout=()=>fail(new Error('连接超时'));const cleanup=()=>{socket.off('error',fail);socket.off('timeout',timeout);};socket.setTimeout(10000);socket.once(socket instanceof tls.TLSSocket?'secureConnect':'connect',done);socket.once('error',fail);socket.once('timeout',timeout);});}
export function directTunnel(host,port){return connected(net.connect({host,port}));}
function readUntil(socket,predicate){
  return new Promise((resolve,reject)=>{
    let data=Buffer.alloc(0);const cleanup=()=>{clearTimeout(timer);socket.off('data',receive);socket.off('error',fail);socket.off('end',ended);};
    const fail=error=>{cleanup();reject(error);},ended=()=>fail(new Error('连接被提前关闭'));
    const receive=chunk=>{data=Buffer.concat([data,chunk]);if(data.length>65536)return fail(new Error('代理返回数据异常'));const size=predicate(data);if(size){socket.pause();cleanup();const rest=data.subarray(size);if(rest.length)socket.unshift(rest);resolve(data.subarray(0,size));}};
    const timer=setTimeout(()=>fail(new Error('代理握手超时')),10000);socket.on('data',receive);socket.once('error',fail);socket.once('end',ended);socket.resume();
  });
}
export async function openTunnel(proxy,host,port){
  if(!proxy)return directTunnel(host,port);
  const url=new URL(proxy),secure=url.protocol==='https:',upstream=await connected(secure?tls.connect({host:url.hostname,port:Number(url.port||443),servername:net.isIP(url.hostname)?undefined:url.hostname}):net.connect({host:url.hostname,port:Number(url.port||(url.protocol==='socks5:'?1080:80))}));
  try{
    if(url.protocol==='socks5:'){
      const auth=!!url.username;upstream.write(Buffer.from(auth?[5,2,0,2]:[5,1,0]));
      const answer=await readUntil(upstream,b=>b.length>=2?2:0);if(answer[0]!==5||![0,2].includes(answer[1]))throw new Error('SOCKS5 代理拒绝连接');
      if(answer[1]===2){const user=Buffer.from(decodeURIComponent(url.username)),pass=Buffer.from(decodeURIComponent(url.password));if(user.length>255||pass.length>255)throw new Error('代理账号或密码过长');upstream.write(Buffer.concat([Buffer.from([1,user.length]),user,Buffer.from([pass.length]),pass]));const login=await readUntil(upstream,b=>b.length>=2?2:0);if(login[1]!==0)throw new Error('代理账号或密码不正确');}
      const destination=Buffer.from(host);const bytes=Buffer.alloc(2);bytes.writeUInt16BE(port);upstream.write(Buffer.concat([Buffer.from([5,1,0,3,destination.length]),destination,bytes]));
      const result=await readUntil(upstream,b=>{if(b.length<5)return 0;const size=b[3]===1?10:b[3]===4?22:b[3]===3?7+b[4]:0;return size&&b.length>=size?size:0;});if(result[1]!==0)throw new Error(`SOCKS5 无法连接 Telegram（${result[1]}）`);
    }else{
      const target=`${net.isIP(host)===6?'['+host+']':host}:${port}`,authorization=url.username?`Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}\r\n`:'';
      upstream.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authorization}\r\n`);
      const response=await readUntil(upstream,b=>{const end=b.indexOf('\r\n\r\n');return end<0?0:end+4;});if(!/^HTTP\/1\.[01] 200\b/.test(response.toString()))throw new Error('代理无法建立 Telegram 连接（'+response.toString().split('\r\n')[0]+')');
    }
    return upstream;
  }catch(error){upstream.destroy();throw error;}
}
export async function testConnection(settings){
  const start=performance.now();let route;
  try{
    route=await resolveConnection(settings);
    const socket=await openTunnel(route.proxy,'telegram.org',443);
    await new Promise((resolve,reject)=>{
      const secure=tls.connect({socket,servername:'telegram.org',rejectUnauthorized:true});
      const timer=setTimeout(()=>{secure.destroy();reject(new Error('Telegram TLS 握手超时'));},10000);
      secure.once('secureConnect',()=>{clearTimeout(timer);secure.destroy();resolve();});secure.once('error',error=>{clearTimeout(timer);secure.destroy();reject(error);});
    });
    return {ok:true,label:route.label,latencyMs:Math.round(performance.now()-start),message:`${route.label}已连通 Telegram 网站`};
  }catch(error){return {ok:false,label:route?.label||'连接',latencyMs:Math.round(performance.now()-start),message:`${route?.label||'连接'}测试失败：${error.message}`};}
}

class BandwidthGate{
  constructor(rate){this.rate=rate;this.items=[];this.budget=0;this.last=performance.now();this.timer=null;}
  wait(bytes,signal){return new Promise((resolve,reject)=>{const item={remaining:bytes,resolve,reject,signal};item.abort=()=>{this.items=this.items.filter(value=>value!==item);reject(new Error('连接已关闭'));};if(signal.aborted)return item.abort();signal.addEventListener('abort',item.abort,{once:true});this.items.push(item);this.pump();});}
  pump(){
    if(this.timer)return;const tick=()=>{
      this.timer=null;const now=performance.now(),rate=this.rate();this.budget=rate?Math.min(Math.max(1024,rate*.2),this.budget+(now-this.last)*rate/1000):Infinity;this.last=now;
      while(this.items.length&&this.budget>=1){const item=this.items[0],used=Math.min(item.remaining,Math.floor(this.budget));item.remaining-=used;this.budget-=used;if(!item.remaining){this.items.shift();item.signal.removeEventListener('abort',item.abort);item.resolve();}else break;}
      if(this.items.length)this.timer=setTimeout(tick,20);else{this.budget=0;this.last=performance.now();}
    };tick();
  }
  close(){clearTimeout(this.timer);this.timer=null;for(const item of [...this.items])item.abort();this.items=[];}
}
export async function downloadGateway(proxy,rate){
  const sockets=new Set(),gate=new BandwidthGate(rate);
  const server=http.createServer((_req,res)=>{res.writeHead(405);res.end();});
  server.on('connect',async(req,client,head)=>{
    const controller=new AbortController();sockets.add(client);let upstream;
    const close=()=>{controller.abort();upstream?.destroy();sockets.delete(client);};client.once('close',close);client.on('error',close);
    try{
      const target=new URL('tcp://'+req.url);if(!target.port||!net.isIP(target.hostname.replace(/^\[|\]$/g,'')))throw new Error('下载目标无效');
      upstream=await openTunnel(proxy,target.hostname.replace(/^\[|\]$/g,''),Number(target.port));if(client.destroyed){upstream.destroy();return;}
      upstream.on('error',()=>client.destroy());client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);
      for await(const chunk of upstream){
        for(let offset=0;offset<chunk.length;){const speed=rate(),size=speed?Math.min(16384,Math.max(256,Math.floor(speed/10))):chunk.length,part=chunk.subarray(offset,offset+size);await gate.wait(part.length,controller.signal);if(!client.write(part))await once(client,'drain',{signal:controller.signal});offset+=part.length;}
      }
      client.end();
    }catch{client.destroy();upstream?.destroy();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {proxy:`http://127.0.0.1:${server.address().port}`,close(){for(const socket of sockets)socket.destroy();gate.close();server.close();}};
}
