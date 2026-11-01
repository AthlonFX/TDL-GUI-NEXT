import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Read-only bbolt snapshot. No sessions or authentication keys are exported to disk.
export function boltBucket(buffer, name) {
  const valid=(offset,length=1)=>Number.isSafeInteger(offset)&&offset>=0&&offset+length<=buffer.length;
  const u64=offset=>{if(!valid(offset,8))throw new Error('Invalid storage page');const value=buffer.readBigUInt64LE(offset);if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid storage address');return Number(value);};
  const pageSize=buffer.readUInt32LE(24);
  if(pageSize<1024||pageSize>65536||pageSize%512)throw new Error('Unsupported storage page size');
  const metas=[0,pageSize].filter(base=>valid(base,80)&&buffer.readUInt32LE(base+16)===0xed0cdaed&&buffer.readUInt32LE(base+20)===2).sort((a,b)=>u64(b+64)-u64(a+64));
  if(!metas.length)throw new Error('Not a tdl Bolt database');
  let visits=0;
  const walk=(offset,find)=>{
    if(++visits>20000||!valid(offset,16))throw new Error('Invalid storage tree');
    const flags=buffer.readUInt16LE(offset+8),count=buffer.readUInt16LE(offset+10);
    if(!valid(offset+16,count*16))throw new Error('Invalid storage entries');
    if(flags&1){for(let i=0;i<count;i++){const found=walk(u64(offset+16+i*16+8)*pageSize,find);if(found)return found;}return null;}
    if(!(flags&2))throw new Error('Unsupported storage page');
    for(let i=0;i<count;i++){
      const entry=offset+16+i*16,kind=buffer.readUInt32LE(entry),data=entry+buffer.readUInt32LE(entry+4),keySize=buffer.readUInt32LE(entry+8),valueSize=buffer.readUInt32LE(entry+12);
      if(!valid(data,keySize+valueSize))throw new Error('Invalid storage value');
      const key=buffer.subarray(data,data+keySize).toString('utf8');
      const value=buffer.subarray(data+keySize,data+keySize+valueSize);
      const found=find(key,value,kind,data+keySize);if(found)return found;
    }
    return null;
  };
  for(const meta of metas){
    try {
      visits=0;
      const bucket=walk(u64(meta+32)*pageSize,(key,value,kind,offset)=>key===name&&(kind&1)?{value,offset}:null);
      if(!bucket)continue;
      const entries=new Map(),root=u64(bucket.offset);
      walk(root?root*pageSize:bucket.offset+16,(key,value,kind)=>{if(!(kind&1))entries.set(key,Buffer.from(value));return null;});
      return entries;
    } catch(error) {if(meta===metas.at(-1))throw error;}
  }
  throw new Error('Account not found in tdl storage');
}

export function tdlSessionFile(namespace, options={}) {
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace))throw new Error('账号标识无效');
  let folder=options.folder||path.join(os.homedir(),'.tdl','data');
  if(!options.folder&&process.env.TDL_STORAGE){const storage=JSON.parse(process.env.TDL_STORAGE);if(storage.type&&storage.type!=='bolt')throw new Error('独立缩略图暂只支持 tdl 的默认存储');folder=storage.path||folder;}
  return path.resolve(folder,namespace);
}

export function readTdlSession(namespace, options={}) {
  const data=fs.readFileSync(tdlSessionFile(namespace,options));
  try {
    const entries=boltBucket(data,namespace),record=entries.get('session');
    if(!record)throw new Error('此账号还没有 tdl 登录会话');
    const session=JSON.parse(record.toString('utf8'));
    const result=session.Data||session.data;
    if(!result?.AuthKey||!result.DC)throw new Error('无法识别此账号的登录状态');
    const option=result.Config?.DCOptions?.find(dc=>dc.ID===result.DC&&!dc.Ipv6&&!dc.MediaOnly);
    const address=result.Addr||(option?.IPAddress?`${option.IPAddress}:${option.Port||443}`:null);
    if(!address)throw new Error('登录状态中没有可用的连接地址');
    const authKey=Buffer.from(result.AuthKey,'base64');
    if(authKey.length!==256)throw new Error('账号登录数据不完整');
    return {dc:result.DC,address,authKey,app:entries.get('app')?.toString('utf8')||'desktop'};
  } finally {data.fill(0);}
}
