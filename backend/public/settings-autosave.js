export class SettingsAutosave {
  constructor({save,onSaved=()=>{},onState=()=>{},delay=500,retryDelay=400}){
    Object.assign(this,{save,onSaved,onState,delay,retryDelay});
    this.pending=new Map();this.errors=new Map();this.versions=new Map();this.tail=Promise.resolve();this.writes=0;this.saved=false;
  }
  state(){return {pending:this.pending.size+this.writes,errors:[...this.errors.values()],saved:this.saved};}
  notify(){this.onState(this.state());}
  schedule(group,read,{immediate=false}={}){
    this.cancel(group,false);const version=this.versions.get(group);
    const timer=immediate?null:setTimeout(()=>this.commit(group),this.delay);
    this.pending.set(group,{read,version,timer});this.notify();
    if(immediate)return this.commit(group);
  }
  cancel(group,notify=true){
    clearTimeout(this.pending.get(group)?.timer);this.pending.delete(group);this.errors.delete(group);
    this.versions.set(group,(this.versions.get(group)||0)+1);if(notify)this.notify();
  }
  write(run){
    this.writes++;this.notify();
    const job=this.tail.then(run);this.tail=job.then(()=>{},()=>{});
    return job.then(value=>{if(value!=null)this.saved=true;return value;}).finally(()=>{this.writes--;this.notify();});
  }
  async commit(group){
    const draft=this.pending.get(group);if(!draft)return true;
    clearTimeout(draft.timer);this.pending.delete(group);
    let patch;
    try{patch=draft.read();}catch(error){this.errors.set(group,error.message);this.notify();return false;}
    try{
      const result=await this.write(async()=>{
        for(let attempt=0;attempt<3;attempt++){
          if(this.versions.get(group)!==draft.version)return null;
          try{return await this.save(patch);}catch(error){
            if(attempt===2)throw error;
            await new Promise(resolve=>setTimeout(resolve,this.retryDelay*(attempt+1)));
          }
        }
      });
      if(result!==null){this.onSaved(result,patch);if(this.versions.get(group)===draft.version)this.errors.delete(group);}
      this.notify();return true;
    }catch(error){if(this.versions.get(group)===draft.version)this.errors.set(group,'保存失败：'+error.message);this.notify();return false;}
  }
  async flush(){
    await Promise.all([...this.pending.keys()].map(group=>this.commit(group)));await this.tail;
    return this.errors.size===0;
  }
}
