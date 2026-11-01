// Replace the pending list with the current viewport, including while a load is starting.
export class ViewportPreviewQueue {
  constructor({load,onError=()=>{},onSettled=()=>{}}) {
    this.load=load;this.onError=onError;this.onSettled=onSettled;
    this.items=[];this.active=null;
  }
  update(items) {
    const visible=new Map(items.map(item=>[item.key,item]));
    if(this.active&&!visible.has(this.active.item.key))this.active.controller.abort();
    this.items=[...visible.values()].filter(item=>item.key!==this.active?.item.key);
    this.start();
  }
  start() {
    if(this.active||!this.items.length)return;
    const active={item:this.items.shift(),controller:new AbortController()};this.active=active;
    Promise.resolve().then(()=>this.load(active.item,active.controller.signal)).catch(error=>{
      if(!active.controller.signal.aborted)this.onError(error,active.item);
    }).finally(()=>{
      this.active=null;this.onSettled();this.start();
    });
  }
}
