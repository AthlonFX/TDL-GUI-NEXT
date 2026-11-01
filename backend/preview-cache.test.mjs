import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PreviewCache } from './preview-cache.mjs';

function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tdl-preview-cache-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;}
test('旧缓存迁入软件目录，冲突保留两份，并保护设置与下载文件',t=>{
  const folder=fixture(t),legacy=path.join(folder,'profile','data','previews'),target=path.join(folder,'app','cache','previews');
  fs.mkdirSync(path.join(legacy,'default'),{recursive:true});fs.writeFileSync(path.join(legacy,'default','image.jpg'),'old image');
  const sentinel=path.join(folder,'profile','data','accounts.json');fs.writeFileSync(sentinel,'login registry');
  const downloaded=path.join(folder,'downloaded.zip');fs.writeFileSync(downloaded,'download');
  const cache=new PreviewCache(target);fs.mkdirSync(path.join(target,'default'));fs.writeFileSync(path.join(target,'default','image.jpg'),'new image');
  cache.migrate(legacy);
  assert(!fs.existsSync(legacy));assert.equal(fs.readFileSync(path.join(target,'default','image.jpg'),'utf8'),'new image');
  assert.equal(cache.stats().files,2);assert.equal(cache.stats().bytes,18);
  assert.equal(fs.readFileSync(sentinel,'utf8'),'login registry');assert.equal(fs.readFileSync(downloaded,'utf8'),'download');
  cache.migrate(legacy);assert.equal(cache.stats().files,2);
});
test('清理等待预览写入结束，阻止新预览，随后可重新生成',async t=>{
  const folder=fixture(t),cache=new PreviewCache(path.join(folder,'app','cache','previews'));
  let finish,cancelled=false;const waiting=new Promise(resolve=>{finish=resolve;});
  const preview=cache.use(async()=>{await waiting;fs.writeFileSync(path.join(cache.folder,'last.jpg'),'preview');});
  const clear=cache.clear(()=>{cancelled=true;});
  assert(cancelled);await assert.rejects(cache.use(()=>{}),/正在清理/);
  finish();await preview;const result=await clear;
  assert.equal(result.clearedBytes,7);assert.equal(result.clearedFiles,1);assert.equal(cache.stats().files,0);
  assert.equal((await cache.clear()).clearedBytes,0);
  await cache.use(()=>fs.writeFileSync(path.join(cache.folder,'new.jpg'),'new'));assert.equal(cache.stats().bytes,3);
});
test('拒绝宽泛删除目标以及指向缓存之外的目录链接',async t=>{
  const folder=fixture(t);assert.throws(()=>new PreviewCache(folder),/专用/);
  const outside=path.join(folder,'downloads');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.jpg'),'keep');
  const cache=new PreviewCache(path.join(folder,'app','cache','previews'));
  fs.symlinkSync(outside,path.join(cache.folder,'linked'),'junction');
  await assert.rejects(cache.clear(),/链接/);assert.equal(fs.readFileSync(path.join(outside,'keep.jpg'),'utf8'),'keep');
  assert.equal(cache.clearing,false);
});
test('更换位置等待预览写入、校验迁移并可恢复默认，父目录文件保留',async t=>{
  const folder=fixture(t),original=path.join(folder,'app','cache','previews'),cache=new PreviewCache(original);
  const parent=path.join(folder,'中文 缓存位置');fs.mkdirSync(parent);fs.writeFileSync(path.join(parent,'keep.txt'),'user file');
  let finish,saved;const pending=cache.use(async()=>{await new Promise(resolve=>{finish=resolve;});fs.writeFileSync(path.join(original,'a.jpg'),'preview');});
  await Promise.resolve();
  const target=path.join(parent,'tdl-thumbnail-cache');const move=cache.relocate(target,{cancelPreviews:()=>finish(),persist:destination=>{saved=destination;}});
  await pending;await move;assert.equal(saved,target);assert.equal(cache.folder,target);assert(!fs.existsSync(original));assert.equal(cache.stats().files,1);
  assert.equal(fs.readFileSync(path.join(target,'a.jpg'),'utf8'),'preview');assert.equal(fs.readFileSync(path.join(parent,'keep.txt'),'utf8'),'user file');
  await cache.relocate(original,{persist:destination=>{saved=destination;}});assert.equal(saved,original);assert(!fs.existsSync(target));assert.equal(cache.stats().files,1);
});
test('拒绝迁入已有其他文件的子目录及互相包含的目录，保存失败保留旧缓存',async t=>{
  const folder=fixture(t),cache=new PreviewCache(path.join(folder,'app','cache','previews'));fs.writeFileSync(path.join(cache.folder,'a.jpg'),'cached');
  const occupied=path.join(folder,'occupied','tdl-thumbnail-cache');fs.mkdirSync(occupied,{recursive:true});fs.writeFileSync(path.join(occupied,'personal.zip'),'keep');
  await assert.rejects(cache.relocate(occupied),/其他文件/);assert.equal(fs.readFileSync(path.join(occupied,'personal.zip'),'utf8'),'keep');
  await assert.rejects(cache.relocate(path.join(cache.folder,'tdl-thumbnail-cache')),/互相包含/);
  const original=cache.folder;await assert.rejects(cache.relocate(path.join(folder,'new','tdl-thumbnail-cache'),{persist:()=>{throw new Error('保存失败');}}),/保存失败/);
  assert.equal(cache.folder,original);assert.equal(fs.readFileSync(path.join(original,'a.jpg'),'utf8'),'cached');assert.equal(cache.clearing,false);
});
