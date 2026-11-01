import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHistoryPage } from './remote-history.mjs';
function clientFor(messages){return {calls:[],async *iterMessages(peer,options){this.calls.push(options);const rows=messages.filter(m=>options.offsetId?m.id>options.offsetId:options.reverse?m.date>options.offsetDate:m.date<options.offsetDate).sort((a,b)=>options.reverse?a.id-b.id:b.id-a.id);yield*rows;}};}
test('日期跳转从当天起读取最近一页，保持消息 ID 空洞和同秒消息',async()=>{
  const messages=Array.from({length:130},(_,i)=>({className:'Message',id:100+i*3,date:1000+Math.floor(i/2)}));
  const client=clientFor(messages),page=await selectHistoryPage(client,{}, {timestamp:1010,topic:5});
  assert.equal(page.ids[0],160);assert.equal(page.ids.length,50);assert(page.hasMoreNewer);assert(page.hasMoreOlder);
  assert.equal(client.calls[0].offsetDate,1009);assert.equal(client.calls[0].replyTo,5);
  const next=await selectHistoryPage(client,{}, {afterId:page.newestId});
  assert.equal(next.ids[0],page.newestId+3);assert.equal(new Set([...page.ids,...next.ids]).size,100);
});
test('所选日期之后没有消息时回落到最近历史，空会话正常返回',async()=>{
  const messages=[{className:'Message',id:7,date:100},{className:'Message',id:9,date:110}];
  const page=await selectHistoryPage(clientFor(messages),{}, {timestamp:200});
  assert.deepEqual(page.ids,[9,7]);assert.equal(page.targetId,9);assert.equal(page.hasMoreNewer,false);
  const empty=await selectHistoryPage(clientFor([]),{}, {timestamp:200});assert.deepEqual(empty.ids,[]);assert.equal(empty.targetId,null);
});
test('不把服务通知当成可导出的普通消息，翻到最后会结束',async()=>{
  const client=clientFor([{className:'MessageService',id:3,date:100},{className:'Message',id:5,date:100},{className:'Message',id:9,date:100}]);
  const page=await selectHistoryPage(client,{}, {afterId:3});assert.deepEqual(page.ids,[5,9]);assert.equal(page.hasMoreNewer,false);
  const empty=await selectHistoryPage(client,{}, {afterId:9});assert.equal(empty.hasMoreNewer,false);assert.deepEqual(empty.ids,[]);
});
