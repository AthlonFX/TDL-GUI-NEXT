import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { messageView } from './media.mjs';
import { downloadRemoteThumbnail } from './remote-thumbnail.mjs';
import { thumbnailInfo } from './thumbnail-info.mjs';
const previewRevision=crypto.randomBytes(8).toString('hex');

export function previewKey(account, chat, message) {
  const media=message.raw?.Media;
  return crypto.createHash('sha256').update(JSON.stringify(['remote-thumbnail-v1',account.namespace,chat,message.id,media?.Document?.ID||media?.Photo?.ID||message.file,message.date])).digest('hex');
}
export function previewLocation(root, account, chat, message) {
  const key=previewKey(account,chat,message);
  return {key,filename:path.join(root,account.id,key+'.jpg'),url:`/api/previews/${account.id}/${key}.jpg?v=${previewRevision}`};
}
async function findMedia(folder,chat,id) {
  try {
    const prefix=`${chat}_${id}_`;
    for(const file of await fs.promises.readdir(folder,{withFileTypes:true}))if(file.isFile()&&file.name.startsWith(prefix)&&!file.name.endsWith('.json'))return path.join(folder,file.name);
  } catch {}
  return null;
}
async function frame(ffmpeg,source,destination,view,op) {
  await fs.promises.mkdir(path.dirname(destination),{recursive:true});
  const temporaryOutput=destination+'.tmp.jpg';
  const args=['-nostdin','-hide_banner','-loglevel','error','-threads','2'];
  if(view.kind==='video'&&view.duration>1)args.push('-ss',String(Math.min(1,view.duration/5)));
  args.push('-protocol_whitelist','file,pipe','-i',source,'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease,setsar=1','-q:v','3','-an','-y',temporaryOutput);
  try {await new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});op.child=child;let error='';
    child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{error=(error+chunk).slice(-1000);});
    const timer=setTimeout(()=>child.kill(),45000);
    child.once('error',err=>{clearTimeout(timer);reject(err);});
    child.once('close',code=>{clearTimeout(timer);op.child=null;if(op.status==='cancelled')reject(new Error('已取消'));else if(code!==0)reject(new Error('这个文件暂时无法生成清晰预览，可先下载查看。'+(error?` (${error.trim().slice(-160)})`:'')));else resolve();});
  });await fs.promises.rename(temporaryOutput,destination);
  } finally {await fs.promises.unlink(temporaryOutput).catch(()=>{});}
}
export async function makeClearPreview({root,ffmpeg,account,scan,message,settings,tasks,execTdl,op}) {
  const location=previewLocation(root,account,scan.raw.id,message);
  if(fs.existsSync(location.filename))return {url:location.url,cached:true};
  const view=messageView(message,scan.title);
  if(!['image','video'].includes(view.kind))throw new Error('此类文件不提供图片预览');
  async function refreshedThumbnailInfo(){
    const metaRoot=path.join(root,'metadata');await fs.promises.mkdir(metaRoot,{recursive:true});
    const filename=path.join(metaRoot,crypto.randomUUID()+'.json');
    try{
      const args=['chat','export','-T','id','-i',`${message.id},${message.id}`,'--raw','--with-content','-o',filename];
      const chatKey=scan.scope?JSON.parse(scan.scope)[0]:null;
      if(chatKey!=='saved')args.push('-c',String(scan.raw.id));
      await execTdl(args,op);
      const precise=JSON.parse(await fs.promises.readFile(filename,'utf8'),(key,value,context)=>typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)?context.source:value);
      return precise.messages?.[0]?thumbnailInfo(precise.messages[0]):null;
    }finally{await fs.promises.unlink(filename).catch(()=>{});}
  }
  let info=message.previewFileLocation||await refreshedThumbnailInfo();
  if(info){
    let remote;
    try{remote=await downloadRemoteThumbnail(account,settings,info,op);}catch(error){
      if(op.status==='cancelled')throw error;
      if(!/FILE_REFERENCE|FILEREF/i.test(error.message))throw new Error('独立缩略图暂时读取失败，请稍后重试。'+error.message.slice(-160));
      info=await refreshedThumbnailInfo();if(!info)throw new Error('这条消息不再提供独立缩略图');
      remote=await downloadRemoteThumbnail(account,settings,info,op);
    }
    await fs.promises.mkdir(path.dirname(location.filename),{recursive:true});
    const temporaryOutput=location.filename+'.download';
    try{await fs.promises.writeFile(temporaryOutput,remote.buffer);await fs.promises.rename(temporaryOutput,location.filename);}finally{await fs.promises.unlink(temporaryOutput).catch(()=>{});}
    op.log=(op.log||'')+`已读取独立预览图：${remote.width}×${remote.height}，${remote.bytes} 字节。未读取原文件。\n`;
    return {url:location.url,cached:false,source:remote.source,bytes:remote.bytes,width:remote.width,height:remote.height,originalFileDownloaded:false};
  }
  const folders=new Set([settings.defaultDirectory,...tasks.filter(task=>task.accountId===account.id&&task.status==='succeeded').map(task=>task.directory)]);
  let source=null;
  for(const folder of folders){source=await findMedia(folder,scan.raw.id,message.id);if(source)break;}
    if(!source)throw new Error('这条消息没有提供独立缩略图；下载后可从本地文件提取预览。');
    if(op.status==='cancelled')throw new Error('已取消');
    op.log=(op.log||'')+'正在生成清晰预览图…\n';
    await frame(ffmpeg,source,location.filename,view,op);
    return {url:location.url,cached:false,source:'existing-local-file',originalFileDownloaded:false};
}
