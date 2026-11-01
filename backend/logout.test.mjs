import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {logoutAccount} from './logout.mjs';

function fixture(){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tdl-logout-test-'));fs.writeFileSync(path.join(folder,'first'),'fake session');fs.writeFileSync(path.join(folder,'second'),'other account');return folder;}
test('真正注销当前 Telegram 会话后才移除该账号登录文件，其他账号保留',async()=>{
  const folder=fixture(),calls=[];const client={async connect(){calls.push('connect');},async getMe(){return {id:123};},async invoke(request){assert.equal(request.className,'auth.LogOut');assert(fs.existsSync(path.join(folder,'first')));calls.push('logout');},async destroy(){calls.push('destroy');}};
  try{const result=await logoutAccount({namespace:'first'},{},{folder,client});assert(result.revoked);assert.equal(result.userId,'123');assert(!fs.existsSync(path.join(folder,'first')));assert.equal(fs.readFileSync(path.join(folder,'second'),'utf8'),'other account');assert.deepEqual(calls,['connect','logout','destroy']);}finally{fs.rmSync(folder,{recursive:true});}
});
test('网络或代理错误时保留登录文件并释放连接，允许重试',async()=>{
  const folder=fixture();let destroyed=false;const client={async connect(){throw new Error('proxy unavailable');},async destroy(){destroyed=true;}};
  try{await assert.rejects(logoutAccount({namespace:'first'},{},{folder,client}),/proxy unavailable/);assert(fs.existsSync(path.join(folder,'first')));assert(destroyed);}finally{fs.rmSync(folder,{recursive:true});}
});
test('已失效的会话可退出，登录文件缺失时幂等返回，并拒绝越界账号路径',async()=>{
  const folder=fixture(),client={async connect(){throw new Error('AUTH_KEY_UNREGISTERED');},async destroy(){}};
  try{assert((await logoutAccount({namespace:'first'},{},{folder,client})).revoked);assert((await logoutAccount({namespace:'first'},{},{folder,client})).alreadyLoggedOut);await assert.rejects(logoutAccount({namespace:'../second'},{},{folder,client}),/账号标识无效/);assert(fs.existsSync(path.join(folder,'second')));}finally{fs.rmSync(folder,{recursive:true});}
});
