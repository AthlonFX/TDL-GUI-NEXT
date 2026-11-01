import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function safePath(folder) {
  let current=path.parse(folder).root;
  for(const part of folder.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    try { if(fs.lstatSync(current).isSymbolicLink())throw new Error('缓存路径不能使用目录链接'); }
    catch(error) { if(error.code!=='ENOENT')throw error; }
  }
}
function filesIn(folder) {
  safePath(folder);
  if(!fs.existsSync(folder))return [];
  const files=[];
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
    const filename=path.join(folder,entry.name);
    if(entry.isSymbolicLink())throw new Error('缓存中存在目录链接，已停止操作');
    if(entry.isDirectory())files.push(...filesIn(filename));
    else if(entry.isFile())files.push(filename);
    else throw new Error('缓存中存在不支持的文件类型');
  }
  return files;
}
const hash=filename=>crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const markerName='.tdl-thumbnail-cache.json',owner='tdl-workbench-thumbnails';
function dedicated(folder){return path.basename(folder)==='tdl-thumbnail-cache'||(path.basename(folder)==='previews'&&path.basename(path.dirname(folder))==='cache');}
function cacheFiles(folder){return filesIn(folder).filter(file=>path.relative(folder,file)!==markerName);}
function copyVerified(sourceRoot,targetRoot) {
  for(const source of cacheFiles(sourceRoot)){
    let destination=path.join(targetRoot,path.relative(sourceRoot,source));const digest=hash(source);
    safePath(destination);
    if(fs.existsSync(destination)&&hash(destination)!==digest)destination+='.'+digest+'.legacy';
    safePath(destination);fs.mkdirSync(path.dirname(destination),{recursive:true});
    if(!fs.existsSync(destination))fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
    if(hash(destination)!==digest)throw new Error('缓存迁移校验失败，原缓存已保留');
  }
}
function nested(parent,child){const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}

export class PreviewCache {
  constructor(folder,{adoptExisting=true}={}) {
    this.folder=path.resolve(folder);
    if(!dedicated(this.folder))throw new Error('缓存必须位于专用的缓存文件夹');
    this.ensure(adoptExisting);
    this.pending=new Set();this.clearing=false;
  }
  ensure(adoptExisting=false){
    safePath(this.folder);fs.mkdirSync(this.folder,{recursive:true});
    const marker=path.join(this.folder,markerName);safePath(marker);
    if(fs.existsSync(marker)){
      if(JSON.parse(fs.readFileSync(marker,'utf8')).owner!==owner)throw new Error('该文件夹不属于工作台缓存');
    }else{
      if(!adoptExisting&&fs.readdirSync(this.folder).length)throw new Error('该缓存子文件夹已有其他文件，请选择另一个位置');
      fs.writeFileSync(marker,JSON.stringify({owner,version:1}),{flag:'wx'});
    }
  }
  migrate(legacy) {
    legacy=path.resolve(legacy);
    if(legacy===this.folder||!fs.existsSync(legacy))return;
    if(path.basename(legacy)!=='previews'||path.basename(path.dirname(legacy))!=='data')throw new Error('旧缓存路径不正确');
    copyVerified(legacy,this.folder);
    // Check the resolved source again immediately before deleting the verified copy.
    safePath(legacy);filesIn(legacy);
    fs.rmSync(legacy,{recursive:true});
  }
  stats() {
    const files=cacheFiles(this.folder);
    const sizes=files.map(file=>fs.statSync(file,{throwIfNoEntry:false})?.size).filter(size=>size!==undefined);
    return {directory:this.folder,bytes:sizes.reduce((sum,size)=>sum+size,0),files:sizes.length};
  }
  async use(run) {
    if(this.clearing)throw new Error('正在清理缓存，请稍后重试');
    const pending=Promise.resolve().then(run);this.pending.add(pending);
    try { return await pending; } finally {this.pending.delete(pending);}
  }
  async clear(cancelPreviews) {
    if(this.clearing)throw new Error('正在清理缓存，请稍候');
    this.clearing=true;
    try {
      cancelPreviews?.();
      await Promise.allSettled([...this.pending]);
      const previous=this.stats();
      this.ensure();
      fs.rmSync(this.folder,{recursive:true});
      this.ensure();
      return {...this.stats(),clearedBytes:previous.bytes,clearedFiles:previous.files};
    } finally {this.clearing=false;}
  }
  async relocate(folder,{cancelPreviews,persist}={}){
    if(this.clearing)throw new Error('正在处理缓存，请稍候');
    const target=path.resolve(folder),previous=this.folder;
    if(target===previous){await persist?.(target);return this.stats();}
    if(nested(previous,target)||nested(target,previous))throw new Error('新旧缓存文件夹不能互相包含，请选择其他位置');
    this.clearing=true;
    try{
      cancelPreviews?.();await Promise.allSettled([...this.pending]);this.ensure();filesIn(previous);
      const next=new PreviewCache(target,{adoptExisting:false});
      filesIn(target);
      const probe=path.join(target,'.write-test-'+crypto.randomUUID());
      try{fs.writeFileSync(probe,'',{flag:'wx'});}finally{if(fs.existsSync(probe))fs.unlinkSync(probe);}
      copyVerified(previous,target);
      await persist?.(target);
      this.folder=next.folder;
      let warning='';try{safePath(previous);filesIn(previous);fs.rmSync(previous,{recursive:true});}catch{warning='新位置已生效，但旧缓存目录未能完全清理。';}
      return {...this.stats(),warning};
    }finally{this.clearing=false;}
  }
}
