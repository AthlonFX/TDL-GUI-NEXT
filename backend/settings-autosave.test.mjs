import test from 'node:test';import assert from 'node:assert/strict';import {SettingsAutosave} from './public/settings-autosave.js';
import {setTimeout as delay} from 'node:timers/promises';

test('快速编辑只提交最后一次，并在关闭设置时立即保存尚未到期的更改',async()=>{
  const saved=[];const manager=new SettingsAutosave({save:async value=>{saved.push(value);return value;},delay:1000});
  manager.schedule('speed',()=>({speed:1}));manager.schedule('speed',()=>({speed:2}));manager.schedule('speed',()=>({speed:3}));
  assert(await manager.flush());assert.deepEqual(saved,[{speed:3}]);assert.equal(manager.state().pending,0);
});
test('不同设置串行提交，旧请求不会在新值之后落盘；恢复默认不被旧草稿覆盖',async()=>{
  let release;const blocked=new Promise(resolve=>release=resolve),calls=[];
  const manager=new SettingsAutosave({save:async value=>{calls.push(value);if(value.speed===1)await blocked;return value;}});
  const first=manager.schedule('speed',()=>({speed:1}),{immediate:true});await delay(1);
  const old=manager.schedule('directory',()=>({directory:'old'}),{immediate:true});
  manager.schedule('speed',()=>({speed:2}),{immediate:true});manager.cancel('directory');
  const reset=manager.write(async()=>{calls.push({directory:'system'});return {};});release();
  await Promise.all([first,old,reset,manager.flush()]);assert.deepEqual(calls,[{speed:1},{speed:2},{directory:'system'}]);
});
test('无效输入不提交、不阻挡其他设置，改正后清除错误',async()=>{
  const saved=[];const manager=new SettingsAutosave({save:async value=>{saved.push(value);return value;}});
  manager.schedule('proxy',()=>{throw new Error('代理地址未填写完整');});manager.schedule('speed',()=>({speed:4}));
  assert.equal(await manager.flush(),false);assert.deepEqual(saved,[{speed:4}]);assert.equal(manager.state().errors[0],'代理地址未填写完整');
  manager.schedule('proxy',()=>({proxy:'http://127.0.0.1:7897'}));assert(await manager.flush());assert.equal(manager.state().errors.length,0);
});
test('保存失败会重试并显示失败状态，旧请求失败不会覆盖后续输入的状态',async()=>{
  let attempts=0;const manager=new SettingsAutosave({save:async()=>{attempts++;throw new Error('服务不可用');},retryDelay:1});
  manager.schedule('speed',()=>({speed:1}));assert.equal(await manager.flush(),false);assert.equal(attempts,3);assert.match(manager.state().errors[0],/保存失败/);assert.equal(manager.state().saved,false);
  manager.save=async value=>value;manager.schedule('speed',()=>({speed:2}));assert(await manager.flush());assert(manager.state().saved);
});
