import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { directory } from './core.mjs';
const requests=new Map();
process.on('message',message=>{
  if(message?.type!=='open-folder-result')return;
  const request=requests.get(message.id);if(!request)return;
  requests.delete(message.id);clearTimeout(request.timer);
  if(message.error)request.reject(new Error('无法打开文件夹：'+message.error));else request.resolve();
});
export async function openFolder(value) {
  const folder=directory(value);
  if(!fs.existsSync(folder)||!fs.statSync(folder).isDirectory())throw new Error('文件夹不存在，请重新选择位置');
  if(process.env.TDL_WORKBENCH_DESKTOP==='1') {
    if(!process.connected)throw new Error('桌面连接已断开，请重新打开工作台');
    await new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),timer=setTimeout(()=>{requests.delete(id);reject(new Error('打开文件夹超时，请重试'));},8000);timer.unref();
      requests.set(id,{resolve,reject,timer});
      process.send({type:'open-folder',id,directory:folder},error=>{if(error){requests.delete(id);clearTimeout(timer);reject(new Error('无法连接桌面窗口，请重启工作台'));}});
    });
  }else await new Promise((resolve,reject)=>{
    const child=spawn('explorer.exe',[folder],{detached:true,stdio:'ignore',windowsHide:false});
    child.once('error',error=>reject(new Error('无法打开文件夹：'+error.message)));
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
