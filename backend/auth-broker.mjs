import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'auth-worker.mjs');
const ended = status => ['success','failed','cancelled'].includes(status);
export class LoginBroker {
  constructor(onSuccess) { this.onSuccess = onSuccess; this.sessions = new Map(); }
  view(s) { return {id:s.id,status:s.status,error:s.error||'',qrVersion:s.qrVersion||'',account:s.account||null}; }
  get(id) { const s=this.sessions.get(id); if(!s)throw new Error('登录已过期，请重新扫码');return this.view(s); }
  qr(id) { return this.sessions.get(id)?.qr || null; }
  start(settings,label) {
    for(const s of this.sessions.values())if(!ended(s.status))return this.view(s);
    const s={id:crypto.randomUUID(),status:'starting',qr:null,child:null,replaceAccountId:settings.replaceAccountId||null};this.sessions.set(s.id,s);
    const child=fork(workerPath,[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});s.child=child;
    const finish=status=>{clearTimeout(s.timer);s.status=status;if(ended(status)){s.qr=null;s.qrVersion='';}};
    child.on('message',message=>{
      if(ended(s.status))return;
      if(message.status==='success'){
        try{s.account=this.onSuccess({...message.account,replaceAccountId:s.replaceAccountId});finish('success');}catch(error){s.error=error.message;finish('failed');}
      }else{
        s.status=message.status;s.error=message.error||'';s.qr=message.qr||null;s.qrVersion=message.qrVersion||'';
        if(ended(s.status))finish(s.status);
      }
    });
    child.on('error',()=>{if(!ended(s.status)){s.error='无法启动登录进程，请重试';finish('failed');}});
    child.on('exit',()=>{s.child=null;if(!ended(s.status)){s.error='登录已中断，请重新扫码';finish('failed');}});
    child.send({type:'start',settings,label:String(label||'').trim().slice(0,40)});
    s.timer=setTimeout(()=>{s.error='本次登录已超时，请重新扫码';this.cancel(s.id);s.status='failed';},6*60*1000);s.timer.unref();
    return this.view(s);
  }
  input(id,password){
    const s=this.sessions.get(id);if(!s||s.status!=='password'||!s.child?.connected)throw new Error('当前没有等待输入密码的登录，请重新扫码');
    if(typeof password!=='string'||!password||password.length>512||/[\r\n\x00-\x1f]/.test(password))throw new Error('请输入有效的二步验证密码');
    s.status='verifying';s.child.send({type:'input',password});return this.view(s);
  }
  cancel(id){
    const s=this.sessions.get(id);if(!s)throw new Error('登录已结束');
    if(!ended(s.status)){s.status='cancelled';s.qr=null;s.qrVersion='';clearTimeout(s.timer);if(s.child?.connected)s.child.send({type:'cancel'});const child=s.child;const timer=setTimeout(()=>{try{child?.kill();}catch{}},1200);timer.unref();}
    return this.view(s);
  }
  close(){for(const s of this.sessions.values())this.cancel(s.id);}
}
