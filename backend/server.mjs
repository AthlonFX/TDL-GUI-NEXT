import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { directory, messageLinks, positiveInt, chatId, plainLog, tdlJson, withSavedMessages } from './core.mjs';
import { ExportPageReader } from './history.mjs';
import { FolderPickers } from './picker.mjs';
import { LoginBroker as LoginSessions } from './auth-broker.mjs';
import { messageView } from './media.mjs';
import { makeClearPreview, previewLocation } from './clear-preview.mjs';
import {proxyChoice,resolveConnection,testConnection,downloadGateway} from './network.mjs';
import { PreviewCache } from './preview-cache.mjs';
import { locateHistoryPage } from './remote-history.mjs';
import { openFolder } from './folder-open.mjs';
import {logoutAccount} from './logout.mjs';
import {tdlSessionFile} from './tdl-session.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.TDL_WORKBENCH_DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const settingsPath = process.env.TDL_WORKBENCH_SETTINGS || path.join(root, 'settings.json');
let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''));
const port = Number(process.env.TDL_WORKBENCH_PORT || settings.port || 18797);
const origin = `http://127.0.0.1:${port}`;
const token = crypto.randomBytes(24).toString('hex');
const systemDownloadsDirectory=directory(process.env.TDL_WORKBENCH_DOWNLOADS_DIR||path.join(os.homedir(),'Downloads'));
function settingsView(){return {defaultDirectory:settings.defaultDirectory,systemDownloadsDirectory,proxy:settings.proxy,customProxy:settings.customProxy??settings.proxy??'',proxyMode:settings.proxyMode||'custom',downloadLimitBps:Number(settings.downloadLimitBps)||0};}
const accountsPath = path.join(dataDir, 'accounts.json');
const defaultPreviewRoot=path.resolve(process.env.TDL_WORKBENCH_PREVIEW_DIR||path.join(root,'cache','previews'));
let previewRoot=settings.previewCacheDirectory?directory(settings.previewCacheDirectory):defaultPreviewRoot;
const previewCache=new PreviewCache(previewRoot,{adoptExisting:!settings.previewCacheDirectory});
previewCache.migrate(path.join(dataDir,'previews'));
function cacheView(){const isDefault=path.relative(defaultPreviewRoot,previewRoot)==='';return {...previewCache.stats(),isDefault,defaultDirectory:defaultPreviewRoot,selectionDirectory:isDefault?path.dirname(path.dirname(previewRoot)):path.dirname(previewRoot)};}
const ffmpegPath=path.join(root,'vendor','ffmpeg','ffmpeg.exe');
let accounts = [{ id: 'default', namespace: 'default', label: '原有账号', status: fs.existsSync(tdlSessionFile('default'))?'ready':'logged_out' }];
try { accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8')).accounts; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!accounts.some(account => account.id === settings.activeAccountId)) settings.activeAccountId = 'default';
const accountCaches = new Map();
function currentAccount() { return accounts.find(account => account.id === settings.activeAccountId) || accounts[0]; }
function accountFor(id) {
  const account = id ? accounts.find(account => account.id === id) : currentAccount();
  if (!account || account.status !== 'ready') throw new Error('账号不可用，请先登录');
  return account;
}
function cacheFor(account) {
  if (!accountCaches.has(account.id)) accountCaches.set(account.id, { chats: [], updatedAt: null });
  return accountCaches.get(account.id);
}
function accountView(account) { return { id: account.id, label: account.label, username: account.username || '', userId: account.userId || '', status: account.status, pinnedChatIds: account.pinnedChatIds || [] }; }
const pickers = new FolderPickers(path.join(root, 'FolderPicker.exe'));
const logins = new LoginSessions(info => {
  const previous=accounts.find(item=>item.id===info.replaceAccountId&&item.status==='logged_out');
  const reuse=previous&&(previous.userId===info.userId||(!previous.userId&&!tasks.some(task=>task.accountId===previous.id)&&!previous.pinnedChatIds?.length));
  const account = { ...(reuse?previous:{}),id: reuse?previous.id:crypto.randomUUID(), namespace: info.namespace, userId: info.userId, username: info.username,
    label: info.label || (info.username ? '@' + info.username : '账号 ' + info.userId), status: 'ready' };
  if(reuse)accounts=accounts.map(item=>item===previous?account:item);else accounts.push(account);
  accountCaches.delete(account.id);atomicJson(accountsPath, { accounts });
  settings.activeAccountId = account.id; atomicJson(settingsPath, settings);
  return accountView(account);
});
const taskPath = path.join(dataDir, 'tasks.json');
let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(taskPath, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') console.error('Task history could not be loaded:', error.message);
}
for (const task of tasks) if (['queued', 'running'].includes(task.status)) {
  task.status = 'failed'; task.error = '工作台重启，任务已暂停。点击重试可继续。';
}
for (const task of tasks) { task.accountId ||= 'default'; task.namespace ||= 'default'; }
let active = null;
const scans = new Map();
const operations = new Map();
function cancelPreviewOperations(){for(const op of operations.values())if(op.kind==='preview'&&['queued','running'].includes(op.status)){op.status='cancelled';op.child?.kill();Promise.resolve(op.abort?.()).catch(()=>{});}}
let saveTimer;

function atomicJson(filename, value) {
  const temp = filename + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, filename);
}
function saveTasks(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const persist = () => atomicJson(taskPath, tasks.map(({ child, run, ...saved }) => saved));
  if (immediate) persist();
  else saveTimer = setTimeout(persist, 400);
}
function queue(item) {
  operations.set(item.id, item);
  item.status = 'queued';
  pump();
  return item;
}
function pump() {
  if (active) return;
  const op = [...operations.values()].find(item => item.status === 'queued');
  if (!op) return;
  active = op; op.status = 'running'; op.startedAt = new Date().toISOString();
  Promise.resolve().then(() => op.run(op)).then(result => {
    if (op.status === 'cancelled') return;
    op.result = result; op.status = 'succeeded'; op.endedAt = new Date().toISOString();
  }).catch(error => {
    if (op.status !== 'cancelled') { op.status = 'failed'; op.error = error.message; }
    op.endedAt = new Date().toISOString();
  }).finally(() => {
    op.child = null; active = null; saveTasks(true); pump();
  });
}
async function execTdl(args, op, exportPage = null) {
  if (!fs.existsSync(settings.tdlPath)) return Promise.reject(new Error('找不到 tdl.exe，请检查安装目录'));
  const connection=await resolveConnection(settings);
  const gateway=op.kind==='download'?await downloadGateway(connection.proxy,()=>Number(settings.downloadLimitBps)||0):null;
  if(op.status==='cancelled'){gateway?.close();throw new Error('已取消');}
  try{return await new Promise((resolve, reject) => {
    const child = spawn(settings.tdlPath, [
      '--proxy', gateway?.proxy??connection.proxy, '--ns', op.namespace || 'default', '--reconnect-timeout', '30s', '--disable-progress-ps', ...args,
    ], { cwd: path.dirname(settings.tdlPath), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    op.child = child;
    const reader=exportPage?new ExportPageReader(exportPage.filename,51):null;
    let pageStopped=false,pageError=null;
    const pageTimer=reader?setInterval(()=>{try{if(!pageStopped&&reader.read()){pageStopped=true;child.kill();}}catch(error){pageError=error;child.kill();}},30):null;
    let stdout = '', stderr = '', lastOutput = Date.now();
    const receive = (chunk, isError) => {
      const text = plainLog(chunk);
      if (isError) stderr = (stderr + text).slice(-2000000);
      else stdout = (stdout + text).slice(-16000000);
      op.log = ((op.log || '') + text).slice(-24000);
      const progress = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].at(-1);
      if (progress) op.progress = Math.min(99, Number(progress[1]));
      lastOutput = Date.now();
      if (op.kind === 'download') saveTasks();
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => receive(text, false));
    child.stderr.on('data', text => receive(text, true));
    const timer = setInterval(() => {
      if (op.kind !== 'download' && Date.now() - lastOutput > 5 * 60 * 1000) {
        child.kill(); op.timeout = true;
      }
    }, 10000);
    child.on('error', error => { clearInterval(timer);if(pageTimer)clearInterval(pageTimer); reject(error); });
    child.on('close', code => {
      clearInterval(timer); op.child = null;
      if(pageTimer)clearInterval(pageTimer);
      if (op.status === 'cancelled') return reject(new Error('已取消'));
      if (op.timeout) return reject(new Error('读取会话超时，请检查代理连接后重试'));
      if(pageError)return reject(pageError);
      if(reader&&(pageStopped||code===0)){
        try{reader.read();if(reader.id==null)throw new Error('读取消息记录失败');const page=reader.page();op.page=page;atomicJson(exportPage.filename,page.raw);return resolve(stdout);}catch(error){return reject(error);}
      }
      if (code !== 0) {
        const detail = (stderr.trim() || stdout.trim()).slice(-1800);
        return reject(new Error(detail || `tdl 执行失败（${code}），请检查登录和代理`));
      }
      resolve(stdout);
    });
  });}finally{gateway?.close();}
}
function publicOp(op) {
  return { id: op.id, accountId: op.accountId, kind: op.kind, status: op.status, log: op.log || '', error: op.error || '', result: op.result || null };
}
function publicTask(task) {
  return { id: task.id, title: task.title, status: task.status, directory: task.directory,
    count: task.count, createdAt: task.createdAt, startedAt: task.startedAt, endedAt: task.endedAt,
    progress: task.progress || 0, log: task.log || '', error: task.error || '', source: task.source };
}
async function ensureFolder(value) {
  const result = directory(value);
  await fs.promises.mkdir(result, { recursive: true });
  await fs.promises.access(result, fs.constants.W_OK);
  return result;
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('请发送 JSON 数据');
  let length = 0, chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 128 * 1024) throw new Error('请求过大');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('请求格式无效'); }
}
function newOp(kind, run, account = currentAccount()) {
  return queue({ id: crypto.randomUUID(), accountId: account.id, namespace: account.namespace, kind, createdAt: new Date().toISOString(), log: '', run });
}
function createTask(input) {
  const account = accountFor(input.accountId);
  let file = null, links = null, count, title;
  if (input.source === 'media') {
    const scan = scans.get(String(input.scanId));
    if (!scan) throw new Error('媒体列表已过期，请重新加载');
    if (scan.accountId !== account.id) throw new Error('媒体属于其他账号，请重新选择会话');
    if (!Array.isArray(input.messageIds) || !input.messageIds.length) throw new Error('请先勾选需要下载的媒体');
    const ids = new Set(input.messageIds.map(Number));
    const messages = scan.raw.messages.filter(message => ids.has(message.id) && message.file);
    if (messages.length !== ids.size) throw new Error('所选媒体无效，请重新加载');
    const taskId = crypto.randomUUID();
    file = path.join(dataDir, `download-${taskId}.json`);
    atomicJson(file, { id: scan.raw.id, messages });
    count = messages.length; title = `${scan.title} · ${count} 个媒体`;
  } else {
    links = messageLinks(input.links); count = links.length; title = count === 1 ? links[0] : `${count} 条消息链接`;
  }
  const destination = directory(input.directory || settings.defaultDirectory);
  if (tasks.filter(t => ['queued', 'running'].includes(t.status)).length >= 50) throw new Error('等待任务较多，请完成一些任务后再添加');
  const task = {
    id: crypto.randomUUID(), kind: 'download', title, source: file ? 'media' : 'links',
    accountId: account.id, namespace: account.namespace,
    directory: destination, file, links, count, group: input.group !== false, skipSame: input.skipSame !== false,
    createdAt: new Date().toISOString(), status: 'queued', progress: 0, log: '',
  };
  task.run = async op => {
    await ensureFolder(task.directory);
    const args = ['dl', '-d', task.directory, '--continue'];
    if (task.group) args.push('--group');
    if (task.skipSame) args.push('--skip-same');
    if (task.file) args.push('-f', task.file);
    else for (const link of task.links) args.push('-u', link);
    await execTdl(args, op);
    task.progress = 100;
    return { directory: task.directory };
  };
  tasks.unshift(task); saveTasks(true); queue(task);
  return task;
}
async function proxyAvailable() {
  let effective;try{effective=(await resolveConnection(settings)).proxy;}catch{return false;}
  if(!effective)return true;
  return new Promise(resolve => {
    try {
      const url = new URL(effective);
      const socket = net.connect({ host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) });
      const done = value => { socket.destroy(); resolve(value); };
      socket.setTimeout(1500); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
    } catch { resolve(false); }
  });
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(res, 403, { error: '仅允许本机访问' });
  const url = new URL(req.url, origin);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { app: 'tdl-local-workbench', version: 4 });
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, {
      settings: settingsView(),
      account: accountView(currentAccount()), accounts: accounts.map(accountView),
      tasks: currentAccount().status==='ready'?tasks.filter(task => task.accountId === currentAccount().id).map(publicTask):[],
      desktopBusy: process.env.TDL_WORKBENCH_DESKTOP === '1' && (tasks.some(task => ['queued','running'].includes(task.status)) || [...logins.sessions.values()].some(session => !['success','failed','cancelled'].includes(session.status))),
      active: active ? active.accountId === currentAccount().id ? publicOp(active) : { kind: 'other-account', status: 'running' } : null,
      chatsUpdated: currentAccount().status==='ready'?cacheFor(currentAccount()).updatedAt:null, chatCount: currentAccount().status==='ready'?cacheFor(currentAccount()).chats.length+1:0,
    });
    if (req.method === 'GET' && url.pathname === '/api/connection') return json(res, 200, { proxy: await proxyAvailable(),mode:settings.proxyMode||'custom', tdl: fs.existsSync(settings.tdlPath) });
    if (req.method === 'GET' && url.pathname === '/api/cache') return json(res,200,cacheView());
    const previewRoute=url.pathname.match(/^\/api\/previews\/([a-zA-Z0-9-]+)\/([a-f0-9]{64})\.jpg$/);
    if(req.method==='GET'&&previewRoute){
      if(previewRoute[1]!==currentAccount().id||currentAccount().status!=='ready')return json(res,403,{error:'请先登录此账号'});
      const filename=path.join(previewRoot,previewRoute[1],previewRoute[2]+'.jpg');
      if(!fs.existsSync(filename))return json(res,404,{error:'预览尚未生成'});
      res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(fs.readFileSync(filename));
    }
    if (req.method === 'GET' && url.pathname === '/api/chats') return json(res, 200, { ...cacheFor(currentAccount()), chats:currentAccount().status==='ready'?withSavedMessages(cacheFor(currentAccount()).chats):[], accountId: currentAccount().id });
    if (req.method === 'GET' && url.pathname.startsWith('/api/folder/pickers/')) return json(res, 200, pickers.get(url.pathname.split('/').at(-1)));
    const authRoute = url.pathname.match(/^\/api\/auth\/([^/]+)(?:\/(qr\.svg))?$/);
    if (req.method === 'GET' && authRoute) {
      if (authRoute[2]) {
        const svg = logins.qr(authRoute[1]);
        if (!svg) return json(res, 404, { error: '二维码已过期，请重新生成' });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); return res.end(svg);
      }
      return json(res, 200, logins.get(authRoute[1]));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/operations/')) {
      const op = operations.get(url.pathname.split('/').at(-1));
      return op && (op.kind==='logout'||(op.accountId===currentAccount().id&&currentAccount().status==='ready')) ? json(res, 200, publicOp(op)) : json(res, 404, { error: '任务已结束或账号已切换' });
    }
    if (req.method === 'POST') {
      if (req.headers['x-workbench-key'] !== token || (req.headers.origin && ![origin, `http://localhost:${port}`].includes(req.headers.origin))) return json(res, 403, { error: '请刷新工作台后重试' });
      const input = await body(req);
      if(url.pathname==='/api/cache/open'){previewCache.ensure();await openFolder(previewRoot);return json(res,200,{ok:true});}
      if(url.pathname==='/api/cache/clear'){const result=await previewCache.clear(cancelPreviewOperations);return json(res,200,{...result,...cacheView()});}
      if(url.pathname==='/api/cache/location'){
        const destination=input.useDefault===true?defaultPreviewRoot:path.join(directory(input.directory),'tdl-thumbnail-cache');
        const result=await previewCache.relocate(destination,{cancelPreviews:cancelPreviewOperations,persist:folder=>{
          const next={...settings,previewCacheDirectory:path.relative(defaultPreviewRoot,folder)===''?'':folder};
          atomicJson(settingsPath,next);settings=next;previewRoot=folder;
        }});
        return json(res,200,{...result,...cacheView()});
      }
      if (url.pathname === '/api/proxy/test') return json(res,200,await testConnection({...settings,...proxyChoice(input,settings)}));
      if (url.pathname === '/api/downloads/reset') {
        const destination=await ensureFolder(systemDownloadsDirectory);
        const next={...settings,defaultDirectory:destination};
        atomicJson(settingsPath,next);settings=next;
        return json(res,200,settingsView());
      }
      if (url.pathname === '/api/settings') {
        const destination = await ensureFolder(input.defaultDirectory||settings.defaultDirectory);
        const downloadLimitBps=input.downloadLimitBps===undefined?(Number(settings.downloadLimitBps)||0):input.downloadLimitBps;
        if(!Number.isSafeInteger(downloadLimitBps)||downloadLimitBps<0||downloadLimitBps>1073741824)throw new Error('下载限速应在 0 到 1024 MB/s 之间，0 表示不限速');
        const next = { ...settings,...proxyChoice(input,settings), defaultDirectory: destination,downloadLimitBps };
        atomicJson(settingsPath,next);settings=next;
        return json(res, 200, settingsView());
      }
      if (url.pathname === '/api/folder/pick') return json(res, 202, pickers.start(input.directory || settings.defaultDirectory));
      if (url.pathname === '/api/folder/cancel') return json(res, 200, pickers.cancel(String(input.id)));
      if (url.pathname === '/api/folder/open') { await openFolder(await ensureFolder(input.directory || settings.defaultDirectory)); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/auth/start') {
        if(accounts.some(item=>item.status==='logging_out'))throw new Error('请等待账号退出完成后再扫码');
        const previous=input.replaceAccountId?accounts.find(item=>item.id===input.replaceAccountId&&item.status==='logged_out'):null;
        if(input.replaceAccountId&&!previous)throw new Error('此账号尚未退出，请先退出登录');
        return json(res,202,logins.start({...settings,replaceAccountId:previous?.id,proxy:(await resolveConnection(settings)).proxy,cwd:path.dirname(settings.tdlPath)},input.label||previous?.label));
      }
      const authAction = url.pathname.match(/^\/api\/auth\/([^/]+)\/(input|cancel)$/);
      if (authAction) return json(res, 200, authAction[2] === 'input' ? logins.input(authAction[1], input.password) : logins.cancel(authAction[1]));
      if (url.pathname === '/api/accounts/logout') {
        const account=accountFor(String(input.accountId));
        if(tasks.some(task=>task.accountId===account.id&&['queued','running'].includes(task.status)))throw new Error('此账号仍有下载任务，请先完成或取消下载后再退出');
        if([...logins.sessions.values()].some(item=>!['success','failed','cancelled'].includes(item.status)))throw new Error('请先完成或取消当前扫码登录');
        account.status='logging_out';
        for(const op of operations.values())if(op.accountId===account.id&&['queued','running'].includes(op.status)){op.status='cancelled';op.child?.kill();Promise.resolve(op.abort?.()).catch(()=>{});}
        const op=newOp('logout',async()=>{
          let revoked=false;
          try{
            const result=await logoutAccount(account,{...settings,proxy:(await resolveConnection(settings)).proxy});
            revoked=true;
            account.status='logged_out';if(result.userId)account.userId=result.userId;
            accountCaches.delete(account.id);for(const [id,scan] of scans)if(scan.accountId===account.id)scans.delete(id);
            if(settings.activeAccountId===account.id)settings.activeAccountId=accounts.find(item=>item.status==='ready')?.id||account.id;
            atomicJson(accountsPath,{accounts});atomicJson(settingsPath,settings);
            return {accountId:account.id,warning:result.warning||''};
          }catch(error){account.status=revoked?'logged_out':'ready';throw error;}
        },account);
        return json(res,202,publicOp(op));
      }
      if (url.pathname === '/api/accounts/switch') {
        const account = accountFor(String(input.accountId));
        settings.activeAccountId = account.id; atomicJson(settingsPath, settings);
        return json(res, 200, accountView(account));
      }
      if (url.pathname === '/api/tasks/clear') {
        const account = accountFor(input.accountId);
        const removed = tasks.filter(task => task.accountId === account.id && !['queued', 'running'].includes(task.status));
        const ids = new Set(removed.map(task => task.id));
        tasks = tasks.filter(task => !ids.has(task.id));
        for (const id of ids) operations.delete(id);
        saveTasks(true);
        return json(res, 200, { cleared: removed.length });
      }
      const cancelOp = url.pathname.match(/^\/api\/operations\/([^/]+)\/cancel$/);
      if (cancelOp) {
        const op = operations.get(cancelOp[1]);
        if (!op || op.accountId !== currentAccount().id || op.kind === 'download') throw new Error('读取任务不可取消');
        if (['running', 'queued'].includes(op.status)) { op.status = 'cancelled'; op.child?.kill(); Promise.resolve(op.abort?.()).catch(()=>{});pump(); }
        return json(res, 200, publicOp(op));
      }
      if (url.pathname === '/api/chats/pin') {
        const account = accountFor(input.accountId), id = chatId(input.chatId);
        if (id === 'saved') throw new Error('我的收藏已固定在顶部');
        if (typeof input.pinned !== 'boolean') throw new Error('请选择置顶或取消置顶');
        const ids = (account.pinnedChatIds || []).filter(value => String(value) !== id);
        const pinnedChatIds = input.pinned ? [id, ...ids] : ids;
        atomicJson(accountsPath, { accounts: accounts.map(item => item === account ? { ...item, pinnedChatIds } : item) });
        account.pinnedChatIds = pinnedChatIds;
        return json(res, 200, { accountId: account.id, pinnedChatIds });
      }
      if (url.pathname === '/api/chats/refresh') {
        const account = accountFor(input.accountId), cache = cacheFor(account);
        const existing = [...operations.values()].find(op => op.kind === 'chats' && op.accountId === account.id && ['queued', 'running'].includes(op.status));
        if (existing) return json(res, 202, publicOp(existing));
        const op = newOp('chats', async op => {
          const output = await execTdl(['chat', 'ls', '-o', 'json'], op);
          const parsed = tdlJson(output);
          if (!Array.isArray(parsed)) throw new Error('会话列表格式不正确');
          cache.chats = parsed; cache.updatedAt = new Date().toISOString();
          return { count: cache.chats.length };
        }, account);
        return json(res, 202, publicOp(op));
      }
      if(url.pathname==='/api/media/preview'){
        if(previewCache.clearing)return json(res,409,{error:'正在清理缓存，请稍后重试'});
        const account=accountFor(input.accountId),scan=scans.get(String(input.scanId));
        if(!scan||scan.accountId!==account.id)throw new Error('请重新读取当前会话后再生成预览');
        const id=positiveInt(input.messageId,1,2147483647,'消息编号');
        const message=scan.raw.messages.find(message=>message.id===id&&message.file);
        if(!message)throw new Error('找不到这个文件');
        const location=previewLocation(previewRoot,account,scan.raw.id,message);
        const existing=[...operations.values()].find(op=>op.kind==='preview'&&op.accountId===account.id&&op.previewKey===location.key&&['queued','running'].includes(op.status));
        if(existing)return json(res,202,publicOp(existing));
        const op=newOp('preview',op=>previewCache.use(async()=>{
          if(op.status==='cancelled')throw new Error('已取消');
          const connection=await resolveConnection(settings);
          if(op.status==='cancelled')throw new Error('已取消');
          return makeClearPreview({root:previewRoot,ffmpeg:ffmpegPath,account,scan,message,settings:{...settings,proxy:connection.proxy},tasks,execTdl,op});
        }),account);
        op.previewKey=location.key;
        return json(res,202,publicOp(op));
      }
      if (url.pathname === '/api/media/scan') {
        const account = accountFor(input.accountId), cache = cacheFor(account);
        const id = chatId(input.chatId);
        const title = id==='saved'?'我的收藏 / Saved Messages':cache.chats.find(chat => String(chat.id) === id)?.visible_name || `会话 ${id}`;
        const topic = input.topic ? positiveInt(input.topic, 1, 2147483647, '话题 ID') : null;
        const jumpAt=input.mode==='jump'?positiveInt(input.timestamp,1,2147483647,'跳转日期'):null;
        const afterId=input.mode==='newer'?positiveInt(input.cursor?.afterId,1,2147483647,'消息位置'):null;
        let args = ['chat', 'export', '--with-content', '--raw'];
        if(id!=='saved')args.push('-c',id);
        const before=input.cursor&&!afterId?positiveInt(input.cursor.beforeId,1,2147483647,'消息位置'):null;
        if (input.includeText !== false) args.push('--all');
        if (input.mode === 'time') {
          const from = positiveInt(input.from, 1, 2147483647, '起始时间');
          const to = positiveInt(input.to, from, 2147483647, '结束时间');
          const end=before?Math.min(to,positiveInt(input.cursor.beforeDate,from,2147483647,'消息时间')):to;
          args.push('-T', 'time', '-i', `${from},${end}`);
          if(before)args.push('-f',`ID < ${before}`);
        } else if(!jumpAt&&!afterId) {
          if(before)args.push('-T','id','-i',`0,${before-1}`);
          else args.push('-T', 'last', '-i', '51');
        }
        if (topic) args.push('--topic', String(topic));
        const op = newOp('scan', async op => {
          const filename = path.join(dataDir, `scan-${op.id}.json`);
          let located=null;
          if(jumpAt||afterId){
            const connection=await resolveConnection(settings);
            located=await locateHistoryPage({account,chatId:id,chat:cache.chats.find(chat=>String(chat.id)===id),settings:{...settings,proxy:connection.proxy},timestamp:jumpAt,afterId,topic,op});
            if(op.status==='cancelled')throw new Error('已取消');
            if(located.ids.length)args.push('-T','id','-i',`${located.oldestId},${located.newestId}`);
          }
          if(located&&!located.ids.length)op.page={raw:{id:id==='saved'?0:Number(id),messages:[]},hasMore:false,cursor:null};
          else await execTdl([...args, '-o', filename], op,{filename});
          if(located){op.page.hasMore=located.hasMoreOlder;op.page.hasMoreNewer=located.hasMoreNewer;op.page.newerCursor=located.newestId?{afterId:located.newestId}:null;op.page.targetId=located.targetId;}
          const raw=op.page.raw;
          if (!Array.isArray(raw.messages)) throw new Error('媒体数据不完整');
          const previous=scans.get(String(input.historyId));
          const scope=JSON.stringify([id,topic,input.mode==='time'?input.from:null,input.mode==='time'?input.to:null]);
          const matching=previous&&previous.accountId===account.id&&previous.scope===scope;
          if(matching&&!raw.messages.length)raw.id=previous.raw.id;
          const historyId=matching?String(input.historyId):op.id;
          const merged=new Map((matching?previous.raw.messages:[]).map(message=>[message.id,message]));
          for(const message of raw.messages)merged.set(message.id,message);
          scans.set(historyId, { raw:{id:raw.id,messages:[...merged.values()]}, title, accountId: account.id, scope });
          const names = new Map(cache.chats.map(chat => [String(chat.id), chat.visible_name || chat.username]));
          return { scanId: historyId, accountId: account.id, chatId: id, title, hasMore:op.page.hasMore,cursor:op.page.cursor,hasMoreNewer:!!op.page.hasMoreNewer,newerCursor:op.page.newerCursor||null,targetId:op.page.targetId||null,
            messages: raw.messages.map(message => {const view=messageView(message,title,names);const preview=previewLocation(previewRoot,account,raw.id,message);if(fs.existsSync(preview.filename))view.clearPreview=preview.url;return view;}).sort((a, b) => a.date - b.date || a.id - b.id) };
        }, account);
        return json(res, 202, publicOp(op));
      }
      if (url.pathname === '/api/tasks') return json(res, 201, publicTask(createTask(input)));
      const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(cancel|retry)$/);
      if (match) {
        const task = tasks.find(task => task.id === match[1]);
        if (!task || task.accountId !== currentAccount().id) return json(res, 404, { error: '任务不存在或属于其他账号' });
        if (match[2] === 'cancel') {
          if (!['queued', 'running'].includes(task.status)) throw new Error('任务已经结束');
          task.status = 'cancelled'; task.endedAt = new Date().toISOString();
          task.child?.kill(); saveTasks(true); pump();
          return json(res, 200, publicTask(task));
        }
        if (['queued', 'running'].includes(task.status)) throw new Error('任务仍在处理中');
        if (task.file && !fs.existsSync(task.file)) throw new Error('媒体记录已不存在，请重新加载媒体');
        const retry = { ...task,namespace:accountFor(task.accountId).namespace, id: crypto.randomUUID(), status: 'queued', error: '', log: '', progress: 0,
          createdAt: new Date().toISOString(), startedAt: null, endedAt: null, result: null, timeout: false };
        retry.run = async op => {
          await ensureFolder(retry.directory);
          const args = ['dl', '-d', retry.directory, '--continue'];
          if (retry.group) args.push('--group'); if (retry.skipSame) args.push('--skip-same');
          if (retry.file) args.push('-f', retry.file); else for (const link of retry.links) args.push('-u', link);
          await execTdl(args, op); retry.progress = 100;
        };
        tasks.unshift(retry); saveTasks(true); queue(retry);
        return json(res, 201, publicTask(retry));
      }
      throw new Error('找不到该操作');
    }
    if (req.method !== 'GET') return json(res, 405, { error: '不支持该请求' });
    if (url.pathname === '/') {
      const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8').replace('__WORKBENCH_TOKEN__', token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
    }
    const assets = { '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/settings-autosave.js': ['settings-autosave.js', 'text/javascript; charset=utf-8'], '/thumbnail-queue.js': ['thumbnail-queue.js', 'text/javascript; charset=utf-8'], '/appearance.js': ['appearance.js', 'text/javascript; charset=utf-8'], '/date-picker.js': ['date-picker.js', 'text/javascript; charset=utf-8'], '/ui.css': ['ui.css', 'text/css; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/conversation.css': ['conversation.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
    if (assets[url.pathname]) {
      const [filename, type] = assets[url.pathname];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(root, 'public', filename)));
    }
    json(res, 404, { error: '页面不存在' });
  } catch (error) { json(res, 400, { error: error.message }); }
});

function openBrowser() {
  const child = spawn('explorer.exe', [origin], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', error => console.error(error.message)); child.unref();
}
server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${origin}/api/health`);
      const health = await response.json();
      if (health.app === 'tdl-local-workbench') { if (process.argv.includes('--open')) openBrowser(); process.exit(0); }
    } catch {}
  }
  console.error('Could not start workbench:', error.message); process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  fs.writeFileSync(path.join(dataDir, 'server.pid'), String(process.pid));
  console.log(`TDL workbench: ${origin}`);
  if (process.argv.includes('--open')) openBrowser();
});
function shutdown() {
  pickers.close(); logins.close();
  Promise.resolve(active?.abort?.()).catch(()=>{});
  if (saveTimer) clearTimeout(saveTimer);
  if (active?.child) active.child.kill();
  saveTasks(true); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

if (process.env.TDL_WORKBENCH_DESKTOP === '1') {
  process.on('message', message => { if (message?.type === 'desktop-shutdown') shutdown(); });
  process.on('disconnect', shutdown);
}
