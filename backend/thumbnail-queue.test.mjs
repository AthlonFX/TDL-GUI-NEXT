import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ViewportPreviewQueue } from './public/thumbnail-queue.js';
const item=id=>({id,key:String(id)});
async function until(check){for(let n=0;n<100;n++){if(check())return;await delay(5);}assert.fail('queue did not settle');}

test('向上滚动会取消旧任务并丢弃屏幕外积压，优先加载新画面',async()=>{
  const started=[],cancelled=[],finished=[];let finish;
  const queue=new ViewportPreviewQueue({load:async(row,signal)=>{
    started.push(row.id);
    if(row.id===80)await new Promise(resolve=>{finish=resolve;signal.addEventListener('abort',()=>{cancelled.push(row.id);resolve();},{once:true});});
    if(!signal.aborted)finished.push(row.id);
  }});
  queue.update([item(80),item(79),item(78)]);await until(()=>started.length===1);
  queue.update([item(40),item(39)]);await until(()=>finished.length===2);
  assert.deepEqual(started,[80,40,39]);assert.deepEqual(cancelled,[80]);assert.deepEqual(finished,[40,39]);finish();
});
test('创建请求尚未返回时切换画面，旧请求仍会收到取消信号',async()=>{
  const started=[],cancelled=[];let resolveCreation;
  const creation=new Promise(resolve=>{resolveCreation=resolve;});
  const queue=new ViewportPreviewQueue({load:async(row,signal)=>{
    started.push(row.id);if(row.id===1){await creation;if(signal.aborted)cancelled.push(row.id);}
  }});
  queue.update([item(1),item(2)]);await until(()=>started.length===1);
  queue.update([item(9)]);resolveCreation();await until(()=>started.length===2);
  assert.deepEqual(started,[1,9]);assert.deepEqual(cancelled,[1]);
});
test('重排时保留仍在画面中的任务，去重，并允许取消后再次进入画面',async()=>{
  const started=[];let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const queue=new ViewportPreviewQueue({load:async(row,signal)=>{started.push(row.id);if(row.id===1)await pending;}});
  queue.update([item(1),item(2)]);await until(()=>queue.active?.item.id===1&&started.length===1);
  queue.update([item(3),item(1),item(3)]);assert.equal(queue.active.controller.signal.aborted,false);
  finish();await until(()=>started.length===2);assert.deepEqual(started,[1,3]);
  await until(()=>!queue.active);queue.update([item(2)]);await until(()=>started.length===3);
  assert.deepEqual(started,[1,3,2]);
});
