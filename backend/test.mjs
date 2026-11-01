import test from 'node:test';
import assert from 'node:assert/strict';
import { directory, messageLinks, chatId, positiveInt, plainLog, tdlJson, withSavedMessages } from './core.mjs';
import { ExportPageReader } from './history.mjs';
import { parseMessageWithThumbnail } from './thumbnail-info.mjs';
import { thumbnailLocation } from './remote-thumbnail.mjs';
import { readTdlSession } from './tdl-session.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FolderPickers } from './picker.mjs';
import { messageView, strippedThumbnail } from './media.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { LoginSessions } from './login.mjs';

test('保留中文目录并拒绝相对路径和命令字符', () => {
  assert.equal(directory('D:/Telegram下载/视频'), 'D:\\Telegram下载\\视频');
  assert.equal(directory('\\\\NAS\\媒体\\下载'), '\\\\NAS\\媒体\\下载');
  for (const value of ['downloads', '\\Windows', 'D:\\bad" & calc', 'D:\\x:stream', '']) assert.throws(() => directory(value));
});
test('只接收具体 Telegram 消息链接并去重', () => {
  assert.deepEqual(messageLinks('https://t.me/c/123/456\nhttps://t.me/c/123/456'), ['https://t.me/c/123/456']);
  assert.equal(messageLinks('https://t.me/channel/123?comment=456').length, 1);
  assert.equal(messageLinks('https://t.me/c/123/456/789').length, 1);
  for (const value of ['', 'https://evil.test/a/123', 'https://t.me/name', 'https://t.me/+invite', 'file:///C:/Windows', 'https://t.me:4430/a/123']) assert.throws(() => messageLinks(value));
});
test('校验会话和数量，避免把用户输入解释为选项', () => {
  assert.equal(chatId(123456789), '123456789');
  assert.equal(positiveInt('50', 1, 1000, '数量'), 50);
  assert.throws(() => chatId('--help'));
  assert.throws(() => positiveInt(-1, 1, 1000, '数量'));
  assert.throws(() => positiveInt(1001, 1, 1000, '数量'));
});
test('清理终端控制符并解析带提示的 JSON', () => {
  assert.equal(plainLog('\u001b[32mhello\u001b[0m\rworld'), 'hello\nworld');
  assert.deepEqual(tdlJson('提示\n[{"id":12}]\n'), [{ id: 12 }]);
});

test('选择窗口取消后可立即重开，旧进程退出不会清掉新窗口', async () => {
  const manager = new FolderPickers('', () => spawn(process.execPath, ['-e', "setTimeout(()=>process.stdout.write('D:\\\\测试目录'),350)"], {windowsHide:true}));
  const first = manager.start('D:\\');
  assert.equal(manager.start('D:\\').id, first.id);
  manager.cancel(first.id);
  const second = manager.start('D:\\');
  assert.notEqual(second.id,first.id);
  for(let i=0;i<30 && manager.get(second.id).status==='opening';i++) await delay(50);
  assert.equal(manager.get(first.id).status,'cancelled');
  assert.equal(manager.get(second.id).status,'selected');
  assert.equal(manager.get(second.id).directory,'D:\\测试目录');
  manager.close();
});
test('文字与任意文件分开识别，压缩包保留大小和下载入口', () => {
  const text = messageView({id:1,text:'hello',file:'',raw:{Out:true}},'会话');
  assert.equal(text.hasMedia,false); assert.equal(text.sender,'我');
  const archive = messageView({id:2,file:'资料.zip',raw:{FromID:{UserID:123},Media:{Document:{MimeType:'application/zip',Size:4096}}}},'会话',new Map([['123','联系人']]));
  assert.equal(archive.kind,'archive');assert.equal(archive.size,4096);assert.equal(archive.hasMedia,true);assert.equal(archive.sender,'联系人');
});
test('Telegram 小缩略图补全 JPEG 头部与宽高，异常输入不生成预览', () => {
  const thumbnail = strippedThumbnail(Buffer.from([1,32,40,1,2,3,4]).toString('base64'));
  assert.equal(thumbnail.subarray(0,2).toString('hex'),'ffd8');
  assert.equal(thumbnail[164],32);assert.equal(thumbnail[166],40);
  assert.equal(thumbnail.subarray(-2).toString('hex'),'ffd9');
  assert.equal(strippedThumbnail(''),null);assert.equal(strippedThumbnail('AAECAwQ='),null);
});
test('扫码后转入二步验证，密码经输入通道提交并在成功后释放会话', async () => {
  let receive, typed = '', killed = false, accountInfo;
  const terminal = { onData(fn){receive=fn;}, onExit(){}, write(value){typed+=value;}, kill(){killed=true;} };
  const manager = new LoginSessions(info => {accountInfo=info;return {id:'account-2',label:'工作账号'};}, {spawn:()=>terminal});
  const session=manager.start({tdlPath:'test.exe',proxy:'http://127.0.0.1:7897',cwd:'.'},'工作账号');
  try {
    receive('Enter 2FA Password: ');
    for(let n=0;n<30 && manager.get(session.id).status!=='password';n++)await delay(10);
    assert.equal(manager.get(session.id).status,'password');
    manager.input(session.id,'test-only-password');
    assert(typed.endsWith('test-only-password\r'));
    assert.equal(manager.get(session.id).status,'verifying');
    receive('\r\nLogin successfully! ID: 123456, Username: testuser\r\n');
    for(let n=0;n<30 && manager.get(session.id).status!=='success';n++)await delay(10);
    assert.equal(manager.get(session.id).status,'success');
    assert.equal(accountInfo.username,'testuser');assert.equal(accountInfo.label,'工作账号');
    assert(!JSON.stringify(manager.get(session.id)).includes('test-only-password'));assert(killed);
  } finally {manager.close();}
});
test('收藏夹固定置顶，并能在尚未获取会话时打开',()=>{
  assert.equal(chatId('saved'),'saved');
  const list=withSavedMessages([{id:123,visible_name:'频道'},{id:'saved'}]);
  assert.deepEqual(list.map(chat=>chat.id),['saved',123]);
  assert.equal(withSavedMessages([])[0].visible_name,'我的收藏 / Saved Messages');
});
test('历史读取处理分块 UTF-8、嵌套对象和引号，并在一个分页边界停止',()=>{
  const filename=path.join(os.tmpdir(),`tdl-history-test-${Date.now()}.json`);
  const objects=Array.from({length:1600},(_,i)=>({id:2500-i,date:10000-i,text:'中文 } [ \\" 内容',raw:{nested:[{value:'\\'}]}}));
  const encoded=Buffer.from(JSON.stringify({id:123,messages:objects}));
  const reader=new ExportPageReader(filename,51);
  try{
    fs.writeFileSync(filename,'');
    for(let offset=0;offset<encoded.length;offset+=17){fs.appendFileSync(filename,encoded.subarray(offset,offset+17));if(reader.read())break;}
    const page=reader.page();assert.equal(page.raw.messages.length,50);assert(page.hasMore);assert.equal(page.cursor.beforeId,2451);assert.equal(page.raw.messages[0].text,objects[0].text);
    assert(fs.statSync(filename).size<encoded.length);
  }finally{fs.unlinkSync(filename);}
});
test('独立缩略图保持 64 位文件标识精度，且拒绝请求原文件位置',()=>{
  const message=parseMessageWithThumbnail('{"id":193,"file":"example.mp4","raw":{"Media":{"Document":{"ID":4976596932500652799,"AccessHash":276625812612412440,"FileReference":"AQID","DCID":1,"Thumbs":[{"Type":"i","Bytes":"AQID"},{"Type":"m","W":320,"H":320,"Size":16467}]}}}}');
  assert.equal(message.previewFileLocation.id,'4976596932500652799');
  assert.equal(message.previewFileLocation.accessHash,'276625812612412440');
  const location=thumbnailLocation(message.previewFileLocation);
  assert.equal(location.thumbSize,'m');assert.equal(location.id.toString(),'4976596932500652799');
  assert.throws(()=>thumbnailLocation({...message.previewFileLocation,thumbSize:''}));
  assert.throws(()=>thumbnailLocation({...message.previewFileLocation,thumbSize:'../'}));
});
test('tdl 会话适配器只读读取指定账号，不写入或导出登录文件',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tdl-session-test-'));
  function leaf(entries){const size=16+entries.length*16+entries.reduce((n,e)=>n+Buffer.byteLength(e.key)+e.value.length,0),out=Buffer.alloc(size);out.writeUInt16LE(2,8);out.writeUInt16LE(entries.length,10);let data=16+entries.length*16;entries.forEach((entry,i)=>{const start=16+i*16,key=Buffer.from(entry.key);out.writeUInt32LE(entry.bucket?1:0,start);out.writeUInt32LE(data-start,start+4);out.writeUInt32LE(key.length,start+8);out.writeUInt32LE(entry.value.length,start+12);key.copy(out,data);entry.value.copy(out,data+key.length);data+=key.length+entry.value.length;});return out;}
  const record=Buffer.from(JSON.stringify({Version:1,Data:{DC:2,Addr:'149.154.167.51:443',AuthKey:Buffer.alloc(256,1).toString('base64')}}));
  const inner=leaf([{key:'app',value:Buffer.from('desktop')},{key:'session',value:record}]);
  const bucket=Buffer.concat([Buffer.alloc(16),inner]),root=leaf([{key:'test',value:bucket,bucket:true}]),database=Buffer.alloc(4096*3);
  for(const base of [0,4096]){database.writeUInt16LE(4,base+8);database.writeUInt32LE(0xed0cdaed,base+16);database.writeUInt32LE(2,base+20);database.writeUInt32LE(4096,base+24);database.writeBigUInt64LE(2n,base+32);database.writeBigUInt64LE(base===0?1n:2n,base+64);}root.copy(database,8192);
  const filename=path.join(folder,'test');fs.writeFileSync(filename,database);
  try{const before=fs.readFileSync(filename);const session=readTdlSession('test',{folder});assert.equal(session.authKey.length,256);assert.equal(session.app,'desktop');assert.deepEqual(fs.readFileSync(filename),before);assert.deepEqual(fs.readdirSync(folder),['test']);session.authKey.fill(0);}
  finally{fs.unlinkSync(filename);fs.rmdirSync(folder);}
});
