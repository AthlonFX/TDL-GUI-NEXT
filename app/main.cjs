const {app,BrowserWindow,Menu,dialog,ipcMain,shell,nativeImage,Tray,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

const testMode=process.argv.includes('--desktop-test');
app.setName('TDL-GUI-NEXT');
app.setPath('userData',testMode&&process.env.TDL_DESKTOP_TEST_DIR?process.env.TDL_DESKTOP_TEST_DIR:path.join(app.getPath('appData'),'TDLWorkbenchDesktop'));
const resourceRoot=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
const backendRoot=path.join(resourceRoot,'backend');
const nodePath=path.join(resourceRoot,'runtime','node.exe');
const tdlPath=path.join(resourceRoot,'runtime','tdl.exe');
const profile=path.join(app.getPath('userData'),'workbench');
const previewCacheRoot=path.join(testMode?profile:(app.isPackaged?path.dirname(app.getPath('exe')):resourceRoot),'cache','previews');
let window=null,tray=null,backend=null,origin='',quitting=false,closePending=false,backendReady=false;
const icon=path.join(__dirname,'icon.ico');
const preferencesFile=path.join(app.getPath('userData'),'desktop-preferences.json');
const closeBehaviors=['ask','tray','quit'];
function desktopPreferences(){let saved={};try{saved=JSON.parse(fs.readFileSync(preferencesFile,'utf8'));}catch{}return {closeBehavior:closeBehaviors.includes(saved.closeBehavior)?saved.closeBehavior:'ask'};}
function saveCloseBehavior(value){if(!closeBehaviors.includes(value))throw new Error('请选择有效的关闭行为');const next={closeBehavior:value};atomicJson(preferencesFile,next);return next;}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function readJson(url){const response=await fetch(url,{signal:AbortSignal.timeout(1600)});if(!response.ok)throw new Error('工作台暂未响应');return response.json();}
async function isWorkbench(url){try{return (await readJson(url+'/api/health')).app==='tdl-local-workbench';}catch{return false;}}
function freePort(preferred=18797){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',error=>{if(error.code==='EADDRINUSE'&&preferred)freePort(0).then(resolve,reject);else reject(error);});probe.listen(preferred,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});}
function atomicJson(filename,value){fs.mkdirSync(path.dirname(filename),{recursive:true});const temp=filename+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,filename);}

function prepareProfile(){
  fs.mkdirSync(profile,{recursive:true});
  const settingsFile=path.join(profile,'settings.json');
  if(!fs.existsSync(settingsFile)){
    let legacy=null,settings={};
    if(!testMode){try{legacy=JSON.parse(fs.readFileSync(path.join(resourceRoot,'migration-source.json'),'utf8')).path;if(!fs.existsSync(path.join(legacy,'settings.json')))legacy=null;}catch{}}
    if(legacy){
      settings=JSON.parse(fs.readFileSync(path.join(legacy,'settings.json'),'utf8').replace(/^\uFEFF/,''));
      const oldData=path.join(legacy,'data'),newData=path.join(profile,'data');
      if(fs.existsSync(oldData))fs.cpSync(oldData,newData,{recursive:true});
      const tasksFile=path.join(newData,'tasks.json');
      if(fs.existsSync(tasksFile)){
        const tasks=JSON.parse(fs.readFileSync(tasksFile,'utf8'));
        for(const task of tasks){if(task.file){const relative=path.relative(oldData,task.file);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))task.file=path.join(newData,relative);}}
        atomicJson(tasksFile,tasks);
      }
      atomicJson(path.join(profile,'migration.json'),{source:legacy,completedAt:new Date().toISOString()});
    }
    settings={proxy:'',customProxy:'',proxyMode:'system',defaultDirectory:app.getPath('downloads'),activeAccountId:'default',...settings,tdlPath,port:18797};
    if(testMode)settings.defaultDirectory=path.join(profile,'test-downloads');
    atomicJson(settingsFile,settings);
  }
  const settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  if(settings.tdlPath!==tdlPath){settings.tdlPath=tdlPath;atomicJson(settingsFile,settings);}
  return settingsFile;
}

async function startBackend(){
  if(testMode&&process.env.TDL_DESKTOP_TEST_ORIGIN){const fixture=new URL(process.env.TDL_DESKTOP_TEST_ORIGIN);if(fixture.hostname!=='127.0.0.1'||fixture.protocol!=='http:')throw new Error('测试服务必须位于本机');origin=fixture.origin;return;}
  if(!testMode&&await isWorkbench('http://127.0.0.1:18797')){origin='http://127.0.0.1:18797';return;}
  if(!fs.existsSync(nodePath)||!fs.existsSync(tdlPath))throw new Error('程序文件不完整，请重新解压桌面版。');
  const settingsFile=prepareProfile(),port=await freePort(testMode?0:18797);
  origin=`http://127.0.0.1:${port}`;
  const logs=path.join(profile,'logs');fs.mkdirSync(logs,{recursive:true});
  const output=fs.openSync(path.join(logs,'server.log'),'a'),errors=fs.openSync(path.join(logs,'server-error.log'),'a');
  backend=spawn(nodePath,[path.join(backendRoot,'server.mjs')],{cwd:backendRoot,windowsHide:true,stdio:['ignore',output,errors,'ipc'],env:{...process.env,TDL_WORKBENCH_PORT:String(port),TDL_WORKBENCH_DATA_DIR:path.join(profile,'data'),TDL_WORKBENCH_SETTINGS:settingsFile,TDL_WORKBENCH_PREVIEW_DIR:previewCacheRoot,TDL_WORKBENCH_DOWNLOADS_DIR:app.getPath('downloads'),TDL_WORKBENCH_DESKTOP:'1'}});
  backend.on('message',async message=>{
    if(message?.type==='open-folder'&&typeof message.id==='string'){
      let error='';
      try{if(!path.isAbsolute(message.directory)||!fs.statSync(message.directory).isDirectory())throw new Error('文件夹不存在');error=await shell.openPath(message.directory);}catch(cause){error=cause.message;}
      if(backend?.connected)backend.send({type:'open-folder-result',id:message.id,error});
      return;
    }
    if(message?.type!=='resolve-system-proxy'||typeof message.id!=='string')return;
    try{const resolver=session.fromPartition('tdl-system-proxy');await resolver.setProxy({mode:'system'});const result=await resolver.resolveProxy('https://149.154.167.91:443');if(backend?.connected)backend.send({type:'system-proxy-result',id:message.id,result});}
    catch{if(backend?.connected)backend.send({type:'system-proxy-result',id:message.id,error:'无法读取系统代理，请重试或选择自定义代理'});}
  });
  fs.closeSync(output);fs.closeSync(errors);
  let failure='';backend.on('error',error=>failure=error.message);
  backend.on('exit',()=>{if(backendReady&&!quitting&&window&&!window.isDestroyed()){dialog.showErrorBox('工作台服务已停止','请退出并重新打开桌面版。下载记录和设置已保留。');}});
  for(let attempt=0;attempt<100;attempt++){
    if(failure||backend.exitCode!==null)throw new Error(failure||'工作台服务未能启动，请检查数据目录中的日志。');
    if(await isWorkbench(origin)){backendReady=true;atomicJson(path.join(profile,'desktop-service.json'),{pid:backend.pid,origin,appVersion:app.getVersion()});return;}
    await delay(160);
  }
  throw new Error('启动时间过长，请退出后重试。');
}

async function stopBackend(){
  const child=backend;if(!child||child.exitCode!==null)return;
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{try{child.kill();}catch{}resolve();},4500);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    try{if(child.connected)child.send({type:'desktop-shutdown'});else child.kill();}catch{clearTimeout(timer);resolve();}
  });
}
function showWindow(){if(window&&!window.isDestroyed()){window.show();if(window.isMinimized())window.restore();window.focus();}}
function ensureTray(){
  if(!tray){tray=new Tray(nativeImage.createFromPath(icon));tray.setToolTip('TDL-GUI-NEXT');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 TDL-GUI-NEXT',click:showWindow},{type:'separator'},{label:'退出 TDL-GUI-NEXT',click:()=>requestQuit()}]));tray.on('double-click',showWindow);tray.on('click',showWindow);}
}
function backgroundTray(){ensureTray();window?.hide();}
async function requestQuit({fromClose=false}={}){
  if(closePending||quitting)return;closePending=true;
  try{
    if(window&&!window.isDestroyed()&&origin&&window.webContents.getURL()===origin+'/'){
      try{await Promise.race([window.webContents.executeJavaScript('window.flushWorkbenchSettings?.()'),delay(4000)]);}catch{}
    }
    let busy=false;try{if(origin){const state=await readJson(origin+'/api/state');busy=state.desktopBusy||state.tasks.some(task=>['running','queued'].includes(task.status));}}catch{}
    if(fromClose){
      let behavior=desktopPreferences().closeBehavior;
      if(behavior==='ask'){
        const result=await dialog.showMessageBox(window,{type:'question',title:'关闭 TDL-GUI-NEXT',message:'退出软件，还是最小化到托盘？',detail:busy?'仍有下载或登录任务。最小化到托盘会继续运行；退出会停止当前任务，可在下次打开后重试。':'最小化后可点击右下角托盘图标重新打开。可在设置中更改关闭行为。',buttons:['最小化到托盘','退出软件','取消'],defaultId:0,cancelId:2,noLink:true,checkboxLabel:'记住我的选择，下次不再询问',checkboxChecked:false});
        if(result.response===2)return;
        behavior=result.response===0?'tray':'quit';if(result.checkboxChecked)saveCloseBehavior(behavior);
      }
      if(behavior==='tray'){backgroundTray();return;}
    }else if(backend){
      if(busy){const result=await dialog.showMessageBox(window,{type:'question',title:'任务尚未结束',message:'工作台仍有下载或登录任务。',detail:'可以留在后台继续；退出时会暂停任务，重新打开后可重试。',buttons:['后台继续','退出并暂停','返回工作台'],defaultId:0,cancelId:2,noLink:true});if(result.response===0){backgroundTray();return;}if(result.response!==1)return;}
    }
    quitting=true;await stopBackend();tray?.destroy();app.quit();
  }finally{closePending=false;}
}

function createWindow(){
  window=new BrowserWindow({width:1400,height:920,minWidth:1000,minHeight:680,title:'TDL-GUI-NEXT',icon,show:false,backgroundColor:'#212121',titleBarStyle:'hidden',titleBarOverlay:{color:'#212121',symbolColor:'#ececec',height:36},webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  Menu.setApplicationMenu(null);
  const loading=window.loadFile(path.join(__dirname,'loading.html'));
  window.once('ready-to-show',()=>window.show());
  window.on('close',event=>{if(!quitting){event.preventDefault();requestQuit({fromClose:true}).catch(error=>dialog.showErrorBox('无法退出',error.message));}});
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  window.webContents.session.setPermissionCheckHandler(()=>false);
  window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//i.test(url))shell.openExternal(url).catch(()=>{});return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(!origin||new URL(url).origin!==origin)event.preventDefault();});
  window.webContents.on('dom-ready',async()=>{
    if(!origin||!window.webContents.getURL().startsWith(origin+'/'))return;
    try{
      const css=fs.readFileSync(path.join(__dirname,'desktop.css'),'utf8');
      await window.webContents.executeJavaScript(`(()=>{const previous=document.getElementById('desktop-appearance');if(previous)previous.remove();const style=document.createElement('style');style.id='desktop-appearance';style.textContent=${JSON.stringify(css)};document.head.appendChild(style);})();\n`+fs.readFileSync(path.join(__dirname,'desktop-ui.js'),'utf8'));
    }catch(error){console.error('Desktop appearance:',error.message);}
  });
  window.webContents.on('context-menu',(_event,params)=>{const items=[];if(params.isEditable)items.push({role:'cut'},{role:'copy'},{role:'paste'},{type:'separator'},{role:'selectAll'});else if(params.selectionText)items.push({role:'copy'},{role:'selectAll'});if(items.length)Menu.buildFromTemplate(items).popup({window});});
  return loading;
}
ipcMain.on('desktop-appearance',(event,theme)=>{
  if(event.sender!==window?.webContents||!['light','dark'].includes(theme))return;
  const dark=theme==='dark';window.setTitleBarOverlay({color:dark?'#212121':'#ffffff',symbolColor:dark?'#ececec':'#171717',height:36});window.setBackgroundColor(dark?'#212121':'#ffffff');
});
ipcMain.handle('desktop-preferences:get',event=>{if(event.sender!==window?.webContents)throw new Error('窗口不可用');return desktopPreferences();});
ipcMain.handle('desktop-preferences:set',(event,value)=>{if(event.sender!==window?.webContents)throw new Error('窗口不可用');return saveCloseBehavior(value);});

if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',showWindow);
  app.on('before-quit',event=>{if(!quitting){event.preventDefault();requestQuit().catch(error=>dialog.showErrorBox('无法退出',error.message));}});
  app.on('activate',showWindow);
  app.whenReady().then(async()=>{
    ensureTray();
    try{await createWindow();await startBackend();if(!quitting){await window.webContents.session.clearCache();await window.loadURL(origin+'/');showWindow();}}
    catch(error){quitting=true;await stopBackend();dialog.showErrorBox('无法打开工作台',error.message);app.quit();}
  });
}
