import { ViewportPreviewQueue } from './thumbnail-queue.js';
import { SettingsAutosave } from './settings-autosave.js';
const $ = id => document.getElementById(id);
const key = document.querySelector('meta[name="workbench-key"]').content;
const icons = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const typeNames = {private:'联系人',channel:'频道',group:'群组',saved:'收藏',unknown:'会话'};
const statusNames = {queued:'等待中',running:'下载中',succeeded:'已完成',failed:'未完成',cancelled:'已取消'};
const kindNames = {video:'视频',image:'图片',audio:'音频',archive:'压缩包',file:'文件'};
let state = {settings:{},tasks:[],accounts:[]}, chats = [], selectedChat = null, currentScan = null;
let selectedIds = new Set(), tab = 'chat', scanning = false, refreshing = false, switching = false, toastTimer;
let lastTasks = '', lastAccounts = '', lastGoodPoll = Date.now(), scanGeneration = 0, pendingScan = null;
let pickerId = null, loginId = null, loginVersion = '', lastChatRefresh = 0, loginPhase = '';
let pinBusy = false, pinVersion = 0;
let accountActionBusy=false,reloginAccountId=null;
let proxyTestVersion=0,connectionTimer=null;
let thumbnailObserver=null,autoPreviewTimer=null,thumbnailFrame=null;
let cacheClearing=false,cacheInfo=null,previewGeneration=0;
let downloadFolderBusy=false,settingsInitialized=false;
let historyAnchor=null;
const autoPreviewFailures=new Map();
const thumbnailQueue=new ViewportPreviewQueue({load:loadPreview,onError:previewFailed,onSettled:queueVisibleThumbnails});
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const settingsAutosave=new SettingsAutosave({save:patch=>api('/api/settings',patch),onSaved:applySavedSettings,onState:renderAutosaveStatus});
window.flushWorkbenchSettings=()=>settingsAutosave.flush();
function renderAutosaveStatus(status){
  const element=$('settings-autosave-status');if(!element)return;
  element.textContent=status.errors[0]||(status.pending?'正在自动保存…':status.saved?'已自动保存':'更改后自动保存');
  element.className='settings-save-status'+(status.errors.length?' error':'');
}
function applySavedSettings(result,patch={}){
  state.settings={...state.settings,...result};renderDefault();
  if(patch.defaultDirectory!==undefined)$('download-directory').value=result.defaultDirectory;
  if(patch.proxyMode!==undefined||patch.customProxy!==undefined){autoPreviewFailures.clear();queueVisibleThumbnails();connection();}
}
function invalidSetting(field,message){$(field).setAttribute('aria-invalid','true');throw new Error(message);}
function settingsPatch(group){
  if(group==='directory'){
    const value=$('settings-directory').value.trim();
    if(!/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value)||/[\x00-\x1f<>"|?*]/.test(value)||value.slice(2).includes(':'))invalidSetting('settings-directory','请填写完整有效的下载文件夹路径');
    return {defaultDirectory:value};
  }
  if(group==='speed'){
    const field=$('settings-speed'),downloadLimitBps=Math.round(Number(field.value)*Number($('settings-speed-unit').value));
    if(!field.value.trim()||!field.validity.valid||!Number.isSafeInteger(downloadLimitBps)||downloadLimitBps<0||downloadLimitBps>1073741824)invalidSetting('settings-speed','请填写有效限速，范围为 0 到 1024 MB/s');
    return {downloadLimitBps};
  }
  const proxyMode=$('settings-proxy-mode').value;if(proxyMode!=='custom')return {proxyMode};
  const customProxy=$('settings-proxy').value.trim();let url;
  try{url=new URL(customProxy);}catch{invalidSetting('settings-proxy','请填写完整代理地址，例如 http://127.0.0.1:7897');}
  if(!['http:','https:','socks5:'].includes(url.protocol)||!url.hostname||url.search||url.hash||!['','/'].includes(url.pathname))invalidSetting('settings-proxy','代理地址应为 HTTP、HTTPS 或 SOCKS5 地址');
  return {proxyMode,customProxy};
}
function scheduleSettings(group,immediate=false){
  for(const id of group==='directory'?['settings-directory']:group==='speed'?['settings-speed']:['settings-proxy'])$(id).removeAttribute('aria-invalid');
  return settingsAutosave.schedule(group,()=>settingsPatch(group),{immediate});
}
async function api(url,input,signal) {
  const response = await fetch(url,input === undefined ? {cache:'no-store',signal} : {method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Key':key},body:JSON.stringify(input),signal});
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作失败，请重试'); return result;
}
function toast(message,error=false) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').className=error?'error':''; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:3200); }
function guard(fn) { return async event => { try { await fn(event); } catch(error) { if(error.message!=='stale') toast(error.message,true); } }; }
function switchTab(value) { tab=value; for(const name of ['chat','links']) { $(`tab-${name}`).classList.toggle('active',name===value); $(`tab-${name}`).setAttribute('aria-selected',String(name===value)); $(`source-${name}`).hidden=name!==value; } updateDownloadButton();queueVisibleThumbnails(); }
function renderAccounts() {
  const signature=JSON.stringify([state.account,state.accounts,accountActionBusy]); if(signature===lastAccounts)return; lastAccounts=signature;
  $('account-select').innerHTML=state.accounts.map(a=>`<option value="${escape(a.id)}" ${a.id===state.account.id?'selected':''} ${a.status!=='ready'?'disabled':''}>${escape(a.label)}${a.status==='logged_out'?'（已退出）':a.status==='logging_out'?'（正在退出）':''}</option>`).join('');
  $('account-select').disabled=accountActionBusy||!state.accounts.some(a=>a.status==='ready');
  $('refresh-chats').disabled=accountActionBusy||state.account.status!=='ready'||refreshing;
  $('login-top').textContent=state.account.status==='ready'?'账号管理':'登录账号';
  $('account-list').innerHTML=state.accounts.map(a=>{
    const ready=a.status==='ready',busy=accountActionBusy||a.status==='logging_out';
    return `<div class="account-row"><div class="avatar">${escape([...a.label][0]||'T')}</div><div><strong>${escape(a.label)}</strong><small>${a.status==='logged_out'?'已退出登录':a.status==='logging_out'?'正在退出…':escape(a.username?'@'+a.username:a.userId||'已有 Telegram 登录')}</small></div><div class="account-actions">${ready?`<button class="button ${a.id===state.account.id?'quiet':'secondary'}" data-account="${escape(a.id)}" ${busy||a.id===state.account.id?'disabled':''}>${a.id===state.account.id?'当前账号':'切换'}</button><button class="button account-logout" data-logout="${escape(a.id)}" ${busy?'disabled':''}>退出登录</button>`:`<button class="button secondary" data-relogin="${escape(a.id)}" ${busy?'disabled':''}>${a.status==='logging_out'?'正在退出…':'重新扫码登录'}</button>`}</div></div>`;
  }).join('');
  updateDownloadButton();
}
function renderChats() {
  if(state.account?.status!=='ready'){$('chat-status').textContent=state.account?.status==='logging_out'?'账号正在退出…':'尚未登录';$('chat-list').innerHTML='<p class="sidebar-note">点击上方“登录账号”或加号，扫码后浏览会话。</p>';return;}
  const query=$('chat-search').value.trim().toLowerCase();
  const pins=new Map((state.account?.pinnedChatIds||[]).map((id,index)=>[String(id),index]));
  const rank=c=>String(c.id)==='saved'?-1:(pins.get(String(c.id))??Infinity);
  const visible=chats.filter(c=>`${c.visible_name||''} ${c.username||''} ${c.id}`.toLowerCase().includes(query)).sort((a,b)=>(rank(a)-rank(b))||0);
  $('chat-status').textContent=refreshing?'正在读取 Telegram 会话…':`${visible.length} 个会话${query?'匹配搜索':' · 点击自动读取'}`;
  $('chat-list').innerHTML=visible.map(c=>{const name=c.visible_name||c.username||`会话 ${c.id}`,pinned=pins.has(String(c.id)),action=pinned?'取消置顶':'置顶会话';return `<div class="chat-row ${pinned?'pinned':''}"><button class="chat-item ${String(c.id)===String(selectedChat?.id)?'active':''}" data-chat="${escape(c.id)}"><span class="avatar">${escape([...name][0])}</span><span class="chat-item-text"><strong title="${escape(name)}">${escape(name)}</strong><small>${pinned?'已置顶 · ':''}${escape(typeNames[c.type]||'会话')}${c.topics?.length?` · ${c.topics.length} 个话题`:''}</small></span></button>${String(c.id)==='saved'?'':`<button class="chat-pin" data-pin="${escape(c.id)}" title="${action}" aria-label="${action}：${escape(name)}" aria-pressed="${pinned}" ${pinBusy?'disabled':''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-4 2-3 5-2-2-5 5-1-1 5-5-2-2 5-3z"/></svg></button>`}</div>`;}).join('')||(!refreshing?'<p class="sidebar-note">没有找到会话，可以点击上方刷新。</p>':'');
}
async function toggleChatPin(id) {
  if(pinBusy||switching)return;
  const accountId=state.account.id,pinned=!(state.account.pinnedChatIds||[]).includes(String(id));
  pinBusy=true;pinVersion++;renderChats();
  try{
    const result=await api('/api/chats/pin',{accountId,chatId:id,pinned});
    if(state.account.id===accountId){state.account.pinnedChatIds=result.pinnedChatIds;toast(pinned?'会话已置顶':'已取消置顶');}
  }finally{pinBusy=false;pinVersion++;renderChats();}
}
function resetConversation() {
  previewGeneration++;thumbnailQueue.update([]);clearTimeout(autoPreviewTimer);
  thumbnailObserver?.disconnect();autoPreviewFailures.clear();
  cancelDragSelection();
  for(const id of ['date-range-open','date-filter-clear','scan-topic','date-from','date-to'])$(id).disabled=false;
  scanGeneration++; if(pendingScan)api(`/api/operations/${pendingScan}/cancel`,{}).catch(()=>{});
  pendingScan=null; scanning=false; selectedChat=null; currentScan=null; selectedIds.clear();
  historyAnchor=null;$('return-latest').hidden=true;$('date-jump-open').disabled=true;
  $('selected-chat-title').textContent='选择一个会话'; $('selected-chat-description').textContent='点击左侧会话，自动读取最近消息，按时间排列。';
  $('media-list').innerHTML=`<div class="empty-state"><div class="empty-icon">${icons('chat')}</div><h3>从左侧选择一个会话</h3><p>自动读取文字、文件与小预览图。</p></div>`;
  $('scan-button').disabled=true; $('load-older').hidden=true; $('topic-field').hidden=true; $('timeline-status').textContent='选择会话后自动读取'; updateSelection();
}
async function chooseChat(id) {
  resetConversation(); selectedChat=chats.find(c=>String(c.id)===String(id)); if(!selectedChat)return;
  switchTab('chat'); $('media-search').value=''; $('date-filter-enabled').value='0';document.dispatchEvent(new Event('workbench-date-reset'));
  $('selected-chat-title').textContent=selectedChat.visible_name||`会话 ${selectedChat.id}`;
  $('selected-chat-description').textContent='按时间显示消息 · 每 30 秒检查当前会话的新消息'; $('chat-type').textContent=typeNames[selectedChat.type]||'会话';
  const topics=selectedChat.topics||[]; $('topic-field').hidden=!topics.length;
  $('scan-topic').innerHTML='<option value="">全部会话</option>'+topics.map(t=>`<option value="${escape(t.id)}">${escape(t.title)}</option>`).join('');
  $('scan-button').disabled=false;$('date-jump-open').disabled=false; renderChats(); await scanMessages();
}
function visibleMessages() {const q=$('media-search').value.trim().toLowerCase();return(currentScan?.messages||[]).filter(m=>`${m.file} ${m.text} ${m.id} ${m.sender}`.toLowerCase().includes(q));}
function visibleMedia(){return visibleMessages().filter(m=>m.hasMedia);}
function formatBytes(bytes){if(!bytes)return '';if(bytes<1024)return `${bytes} B`;if(bytes<1024**2)return `${(bytes/1024).toFixed(1)} KB`;if(bytes<1024**3)return `${(bytes/1024**2).toFixed(1)} MB`;return `${(bytes/1024**3).toFixed(2)} GB`;}
function duration(seconds){return seconds?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'';}
function messageTime(seconds){return seconds?new Date(seconds*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'';}
function dayLabel(seconds){return seconds?new Date(seconds*1000).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'}):'日期未知';}
function renderMessages(scrollMode='keep') {
  if(!currentScan)return;
  const container=$('media-list'),oldHeight=container.scrollHeight,oldTop=container.scrollTop,bottom=oldHeight-oldTop-container.clientHeight<60;
  let lastDay=''; const visible=visibleMessages();
  container.innerHTML=`<div id="history-top" class="history-top" role="status">${currentScan.hasMore?'继续向上滚动，加载更早消息':'已经到最早的消息'}</div>`+visible.map(m=>{
    const day=dayLabel(m.date),separator=day!==lastDay?`<div class="day-separator"><span>${escape(day)}</span></div>`:'';lastDay=day;
    const icon=m.kind==='video'?'video':m.kind==='image'?'image':'file', selected=selectedIds.has(m.id);
    const preview=m.hasMedia&&['image','video'].includes(m.kind)?`<div class="message-preview ${m.kind} ${m.clearPreview?'clear-preview':''}" data-preview="${m.id}"><img src="${m.clearPreview||m.thumbnail||'/favicon.svg'}" alt="${escape(m.file)}的预览图" loading="lazy">${m.duration?`<span class="duration-badge">${duration(m.duration)}</span>`:''}</div>`:'';
    const file=m.hasMedia?`<div class="message-file"><label class="file-selector" title="勾选此文件"><input type="checkbox" aria-label="选择下载 ${escape(m.file)}" data-media="${m.id}" ${selected?'checked':''}><span class="file-icon ${icon}">${icons(icon)}</span></label><div class="file-info"><span class="file-name" title="${escape(m.file)}">${escape(m.file)}</span><span class="file-description">${escape([kindNames[m.kind]||'文件',formatBytes(m.size)].filter(Boolean).join(' · '))}</span></div><button class="icon-button inline-download" data-download="${m.id}" title="下载这个文件" aria-label="下载 ${escape(m.file)}">${icons('download')}</button></div>`:'';
    return `${separator}<article data-message-id="${m.id}" class="message-row ${m.outgoing?'outgoing':''}"><div class="message-bubble ${selected?'selected':''}"><div class="message-sender">${escape(m.sender||currentScan.title)}</div>${preview}${file}${m.text?`<div class="message-text">${escape(m.text)}</div>`:''}<div class="message-stamp"><span>#${m.id}</span><time datetime="${new Date((m.date||0)*1000).toISOString()}">${messageTime(m.date)}</time></div></div></article>`;
  }).join('')||`<div class="empty-state"><div class="empty-icon">${icons('search')}</div><h3>${currentScan.messages.length?'没有匹配的消息':'这个范围内没有找到消息'}</h3><p>可以调整日期或话题。</p></div>`;
  if(currentScan.hasMoreNewer)container.insertAdjacentHTML('beforeend','<div id="history-bottom" class="history-top" role="status">继续向下滚动，加载后续消息</div>');
  if(scrollMode==='bottom'||(scrollMode==='refresh'&&bottom))container.scrollTop=container.scrollHeight;
  else if(scrollMode==='older')container.scrollTop=oldTop+container.scrollHeight-oldHeight;else container.scrollTop=oldTop;
  $('load-older').hidden=true;
  $('timeline-status').textContent=`更新于 ${new Date().toLocaleTimeString('zh-CN',{hour12:false})} · 从旧到新`;updateSelection();
  observeThumbnails();requestAnimationFrame(queueVisibleThumbnails);
}
function scheduleAutomaticPreview(wait=500){clearTimeout(autoPreviewTimer);autoPreviewTimer=setTimeout(()=>{queueVisibleThumbnails();},Math.max(100,wait));}
function queueVisibleThumbnails(){
  clearTimeout(autoPreviewTimer);
  if(!currentScan||document.hidden||tab!=='chat'||cacheClearing||$('settings-dialog').open||$('login-dialog').open||accountActionBusy){thumbnailQueue.update([]);return;}
  if(scanning||switching||(state.active&&state.active.kind!=='preview')){thumbnailQueue.update([]);scheduleAutomaticPreview();return;}
  const bounds=$('media-list').getBoundingClientRect(),top=Math.max(0,bounds.top),bottom=Math.min(innerHeight,bounds.bottom);
  if(!bounds.height||bottom<=top){thumbnailQueue.update([]);return;}
  const messages=new Map(currentScan.messages.map(message=>[message.id,message])),items=[];let nextRetry=Infinity;
  for(const element of $('media-list').querySelectorAll('[data-preview]')){
    const box=element.getBoundingClientRect();if(!box.height||box.bottom<=top||box.top>=bottom||box.right<=0||box.left>=innerWidth)continue;
    const id=Number(element.dataset.preview),message=messages.get(id);if(!message||message.clearPreview)continue;
    const key=`${state.account.id}:${currentScan.chatId}:${id}`,failure=autoPreviewFailures.get(key);
    if(failure?.attempts>=3)continue;
    if(failure?.retryAt>Date.now()){nextRetry=Math.min(nextRetry,failure.retryAt);continue;}
    items.push({id,key,account:state.account.id,chat:currentScan.chatId,scanId:currentScan.scanId,generation:previewGeneration,distance:Math.abs((box.top+box.bottom-top-bottom)/2)});
  }
  items.sort((a,b)=>a.distance-b.distance);thumbnailQueue.update(items);
  if(Number.isFinite(nextRetry))scheduleAutomaticPreview(nextRetry-Date.now());
}
function observeThumbnails(){
  thumbnailObserver?.disconnect();
  thumbnailObserver=new IntersectionObserver(queueVisibleThumbnails,{root:$('media-list'),threshold:0.01});
  for(const element of $('media-list').querySelectorAll('[data-preview]'))thumbnailObserver.observe(element);
}
function previewFailed(error,item){
  if(error.message==='stale')return;
  const attempts=(autoPreviewFailures.get(item.key)?.attempts||0)+1,permanent=/没有提供独立缩略图|没有可下载|下载后可从本地|不再提供独立缩略图/.test(error.message);
  autoPreviewFailures.set(item.key,{attempts:permanent?3:attempts,retryAt:Date.now()+(attempts===1?2000:8000)});
}
function updateClearThumbnail(id,url){
  const element=$('media-list').querySelector(`[data-preview="${id}"]`);
  if(!element){renderMessages();return;}
  element.querySelector('img').src=url;element.classList.add('clear-preview');thumbnailObserver?.unobserve(element);
}
function updateSelection(){const media=visibleMedia();$('select-all').disabled=!media.length||scanning;$('select-all').checked=media.length>0&&media.every(m=>selectedIds.has(m.id));$('select-all').indeterminate=media.some(m=>selectedIds.has(m.id))&&!$('select-all').checked;$('clear-selection').disabled=!selectedIds.size;$('selection-count').textContent=currentScan?`${currentScan.messages.length} 条消息 · 已选 ${selectedIds.size} 个文件`:'尚未读取消息';updateDownloadButton();}
function updateDownloadButton(){$('download-button').querySelector('span').textContent=tab==='links'?'添加下载任务':selectedIds.size?`下载所选 ${selectedIds.size} 个文件`:'下载所选文件';$('download-button').disabled=accountActionBusy||state.account?.status!=='ready'||switching||(tab==='chat'&&(!selectedIds.size||scanning));}
async function awaitOperation(id,onStatus,valid=()=>true,signal){for(;;){if(!valid())throw new Error('stale');const op=await api(`/api/operations/${id}`,undefined,signal);if(!valid())throw new Error('stale');if(op.status==='succeeded')return op.result;if(['failed','cancelled'].includes(op.status))throw new Error(op.error||'读取已取消');onStatus?.(op);await delay(signal?150:600);}}
async function refreshChats(){
  if(refreshing||switching||state.account.status!=='ready')return;const account=state.account.id;refreshing=true;$('refresh-chats').disabled=true;renderChats();
  try{const op=await api('/api/chats/refresh',{accountId:account});await awaitOperation(op.id,op=>$('chat-status').textContent=op.status==='queued'?'等待当前下载结束后读取会话…':'正在读取 Telegram 会话…',()=>state.account.id===account);const result=await api('/api/chats');if(state.account.id!==account)return;chats=result.chats;if(selectedChat)selectedChat=chats.find(c=>String(c.id)===String(selectedChat.id))||null;}
  catch(error){if(error.message!=='stale')toast(`读取会话失败：${error.message}`,true);}finally{if(state.account.id===account){refreshing=false;$('refresh-chats').disabled=state.account.status!=='ready';renderChats();}}
}
async function scanMessages({automatic=false,older=false,newer=false,jumpAt=null,jumpDate=''}={}){
  if(!selectedChat||scanning||switching)return;if(automatic&&(document.hidden||state.active||tab!=='chat'||$('date-filter-enabled').value==='1'||currentScan?.hasMoreNewer))return;
  const generation=++scanGeneration,account=state.account.id,input={accountId:account,chatId:selectedChat.id,mode:$('date-filter-enabled').value==='1'?'time':'last',topic:$('scan-topic').value,includeText:true};
  if(input.mode==='time'){const from=new Date($('date-from').value+'T00:00:00'),to=new Date($('date-to').value+'T23:59:59');if(!Number.isFinite(+from)||!Number.isFinite(+to)||from>to)throw new Error('请选择有效的起止日期');input.from=Math.floor(+from/1000);input.to=Math.floor(+to/1000);}
  const scope=JSON.stringify([input.chatId,input.mode,input.topic,input.from,input.to]);
  const previous=!jumpAt&&currentScan?.scope===scope?currentScan:null;
  if(older&&(!previous?.hasMore||!previous.cursor))return;
  if(newer&&(!previous?.hasMoreNewer||!previous.newerCursor))return;
  if(previous)input.historyId=previous.scanId;
  if(older)input.cursor=previous.cursor;
  if(jumpAt){input.mode='jump';input.timestamp=jumpAt;}
  if(newer){input.mode='newer';input.cursor=previous.newerCursor;}
  if(!previous){currentScan=null;selectedIds.clear();}
  scanning=true;thumbnailQueue.update([]);$('scan-button').disabled=true;for(const id of ['date-range-open','date-filter-clear','date-jump-open','return-latest','scan-topic','date-from','date-to'])$(id).disabled=true;updateSelection();
  if(!previous)$('media-list').innerHTML='<div class="empty-state"><div class="spinner"></div><h3 id="scan-status">正在读取会话内容…</h3><p>文字和文件记录正在加载。</p></div>';
  if(older&&$('history-top'))$('history-top').textContent='正在加载更早的消息…';
  if(newer&&$('history-bottom'))$('history-bottom').textContent='正在加载后续消息…';
  $('timeline-status').textContent=jumpAt?'正在定位日期…':automatic?'正在检查新消息…':'正在读取消息…';
  try{
    const op=await api('/api/media/scan',input);if(generation!==scanGeneration||state.account.id!==account){api(`/api/operations/${op.id}/cancel`,{}).catch(()=>{});throw new Error('stale');}pendingScan=op.id;
    const result=await awaitOperation(op.id,op=>{if($('scan-status'))$('scan-status').textContent=op.status==='queued'?'等待当前任务结束后读取消息…':'正在读取会话内容…';},()=>generation===scanGeneration&&state.account.id===account);
    if(previous){const merged=new Map(previous.messages.map(message=>[message.id,message]));for(const message of result.messages){const cached=merged.get(message.id)?.clearPreview;merged.set(message.id,{...message,clearPreview:message.clearPreview||cached});}currentScan={...result,scope,messages:[...merged.values()].sort((a,b)=>a.date-b.date||a.id-b.id),hasMore:older?result.hasMore:previous.hasMore,cursor:older?result.cursor:previous.cursor,hasMoreNewer:newer?result.hasMoreNewer:previous.hasMoreNewer,newerCursor:newer?result.newerCursor:previous.newerCursor};}
    else currentScan={...result,scope};
    const available=new Set(currentScan.messages.filter(m=>m.hasMedia).map(m=>m.id));selectedIds=new Set([...selectedIds].filter(id=>available.has(id)));renderMessages(jumpAt?'keep':!previous?'bottom':older?'older':newer?'keep':'refresh');lastChatRefresh=Date.now();
    if(jumpAt){
      historyAnchor={timestamp:jumpAt,date:jumpDate};$('return-latest').hidden=false;
      const container=$('media-list'),target=container.querySelector(`[data-message-id="${result.targetId}"]`);
      if(target){container.scrollTop+=target.getBoundingClientRect().top-container.getBoundingClientRect().top-12;target.classList.add('jump-target');setTimeout(()=>target.classList.remove('jump-target'),3000);}
      else container.scrollTop=0;
      toast(result.messages.length?`已定位到 ${jumpDate} 附近的消息`:'这个会话暂时没有可定位的消息');
    }
  }
  catch(error){if(generation!==scanGeneration||state.account.id!==account||error.message==='stale')return;if(!previous)$('media-list').innerHTML=`<div class="empty-state"><div class="empty-icon">${icons('refresh')}</div><h3>会话暂时没有读取成功</h3><p>${escape(error.message.slice(-500))}</p></div>`;$('timeline-status').textContent='读取失败，可以点击刷新重试';if(!automatic)throw error;}
  finally{if(generation===scanGeneration&&state.account.id===account){pendingScan=null;scanning=false;$('scan-button').disabled=!selectedChat;for(const id of ['date-range-open','date-filter-clear','date-jump-open','return-latest','scan-topic','date-from','date-to'])$(id).disabled=false;updateSelection();queueVisibleThumbnails();}}
}
function renderDefault(){$('default-hint').textContent=`默认位置：${state.settings.defaultDirectory||'尚未设置'}`;}
async function pickDirectory(initial,button,forCache=false){
  if(downloadFolderBusy)return;
  if(pickerId){toast('请在 Windows 窗口中完成选择，或点击「取消选择窗口」');return;}
  const original=button.innerHTML;$('browse-folder').disabled=true;$('settings-browse').disabled=true;$('cache-browse').disabled=true;$('settings-download-reset').disabled=true;$('settings-download-open').disabled=true;button.textContent='请在 Windows 窗口中选择…';
  try{const result=await api('/api/folder/pick',{directory:initial});pickerId=result.id;if(cacheInfo)renderCacheInfo(cacheInfo);$('folder-cancel').hidden=forCache;$('settings-picker-cancel').hidden=forCache;$('cache-picker-cancel').hidden=!forCache;for(;;){const item=await api(`/api/folder/pickers/${pickerId}`);if(item.status==='selected')return item.directory;if(item.status==='cancelled')return null;if(item.status==='failed')throw new Error(item.error||'选择窗口打开失败');await delay(300);}}
  finally{pickerId=null;$('browse-folder').disabled=false;$('settings-browse').disabled=false;$('settings-download-reset').disabled=downloadFolderBusy;$('settings-download-open').disabled=downloadFolderBusy;button.innerHTML=original;$('folder-cancel').hidden=true;$('settings-picker-cancel').hidden=true;$('cache-picker-cancel').hidden=true;if(cacheInfo)renderCacheInfo(cacheInfo);}
}
async function chooseFolder(target,button){const folder=await pickDirectory($(target).value,button);if(folder){$(target).value=folder;if(target==='settings-directory')await scheduleSettings('directory',true);else toast('已选择保存位置');}}
async function cancelPicker(){if(pickerId)await api('/api/folder/cancel',{id:pickerId});}
function timeLabel(value){return value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';}
function renderTasks(){
  const serialized=JSON.stringify([state.account?.id,state.tasks]);if(serialized===lastTasks)return;
  const opened=new Set([...document.querySelectorAll('.task-details[open]')].map(e=>e.dataset.task));const scrolls=new Map([...document.querySelectorAll('.task-details pre')].map(e=>[e.dataset.log,{top:e.scrollTop,bottom:e.scrollHeight-e.scrollTop-e.clientHeight<30}]));
  lastTasks=serialized;$('task-count').textContent=state.tasks.length;$('clear-records').disabled=!state.tasks.some(t=>!['running','queued'].includes(t.status));
  if(!state.tasks.length){$('task-list').innerHTML=`<div class="task-empty">${icons('download')}<span>还没有下载记录。选择文件后开始下载。</span></div>`;return;}
  $('task-list').innerHTML=state.tasks.map(t=>{const live=['running','queued'].includes(t.status);const progress=t.status==='running'?`<div class="progress ${t.progress?'':'indeterminate'}"><div style="width:${Math.min(100,t.progress)}%"></div></div>`:'';return `<article class="task-row"><div class="task-main"><span class="file-icon">${icons('download')}</span><div class="task-info"><div class="task-title" title="${escape(t.title)}">${escape(t.title)}</div><div class="task-directory">${escape(t.directory)}</div><div class="task-time">${timeLabel(t.createdAt)} · ${t.count} ${t.source==='media'?'个文件':'条链接'}</div></div><span class="status ${t.status}">${statusNames[t.status]||t.status}${t.status==='running'&&t.progress?` ${Math.round(t.progress)}%`:''}</span><div class="task-actions"><button class="button secondary" data-action="open" data-task="${t.id}" title="打开文件夹">${icons('folder')}</button>${live?`<button class="button secondary" data-action="cancel" data-task="${t.id}">取消</button>`:t.status!=='succeeded'?`<button class="button secondary" data-action="retry" data-task="${t.id}">重试</button>`:''}</div></div>${progress}${t.error?`<div class="task-error">${escape(t.error)}</div>`:''}<details class="task-details" data-task="${t.id}" ${opened.has(t.id)?'open':''}><summary>查看运行记录</summary><pre data-log="${t.id}">${escape(t.log||(t.status==='queued'?'任务已加入队列，等待执行。':'正在连接 Telegram…'))}</pre></details></article>`;}).join('');
  for(const e of document.querySelectorAll('.task-details pre')){const prev=scrolls.get(e.dataset.log);e.scrollTop=!prev||prev.bottom?e.scrollHeight:prev.top;}
}
async function submitDownload(ids){const input={accountId:state.account.id,directory:$('download-directory').value,group:$('group-option').checked,skipSame:$('skip-option').checked};if(ids||tab==='chat'){const messages=ids||[...selectedIds];if(!currentScan||!messages.length)throw new Error('请先勾选需要下载的文件');Object.assign(input,{source:'media',scanId:currentScan.scanId,messageIds:messages});}else Object.assign(input,{source:'links',links:$('message-links').value.trim()});await api('/api/tasks',input);toast('已添加下载任务');state=await api('/api/state');renderTasks();}
async function switchAccount(id){
  if(switching||id===state.account.id)return;switching=true;resetConversation();refreshing=false;chats=[];renderChats();$('account-select').disabled=true;
  try{await api('/api/accounts/switch',{accountId:id});state=await api('/api/state');$('chat-search').value='';renderAccounts();renderTasks();chats=(await api('/api/chats')).chats;renderChats();$('login-dialog').close();}
  finally{switching=false;$('account-select').disabled=false;updateDownloadButton();}if(state.account.status==='ready'&&!state.chatsUpdated)refreshChats();
}
async function pollState(){
  try{const version=pinVersion,next=await api('/api/state'),pinsBefore=JSON.stringify(state.account?.pinnedChatIds||[]);if(version!==pinVersion&&state.account?.id===next.account.id)next.account.pinnedChatIds=state.account.pinnedChatIds;if(!switching&&state.account&&(state.account.id!==next.account.id||state.account.status!==next.account.status)){resetConversation();chats=[];refreshing=false;state=next;$('chat-search').value='';chats=(await api('/api/chats')).chats;renderChats();if(state.account.status==='ready'&&!state.chatsUpdated)refreshChats();}else{state=next;if(pinsBefore!==JSON.stringify(state.account.pinnedChatIds||[]))renderChats();}renderAccounts();renderTasks();renderDefault();lastGoodPoll=Date.now();if(selectedChat&&Date.now()-lastChatRefresh>=30000)scanMessages({automatic:true}).catch(()=>{});}
  catch{if(Date.now()-lastGoodPoll>8000){$('connection').className='connection error';$('connection').innerHTML='<i></i> 工作台连接中断';}}finally{setTimeout(pollState,state.active?1200:2500);}
}
async function connection(){clearTimeout(connectionTimer);try{const r=await api('/api/connection');$('connection').className=`connection ${r.proxy&&r.tdl?'ok':'error'}`;$('connection').innerHTML=`<i></i> ${!r.tdl?'未找到 tdl':!r.proxy?'代理未连接':r.mode==='none'?'本机运行 · 直连':r.mode==='system'?'本机运行 · 跟随系统':'本机运行 · 代理可用'}`;}catch{}connectionTimer=setTimeout(connection,30000);}
function setPasswordStep(session){
  const ready=session.status==='password';$('login-password-form').hidden=false;$('login-password').disabled=!ready;$('login-password-submit').disabled=!ready;
  $('login-password-hint').textContent=ready?'请输入你在 Telegram 设置的二步验证密码，然后点击提交。':session.status==='verifying'?'密码正在验证，请稍候。':'扫码确认后，如账号启用了二步验证，此输入框会自动启用。';
  $('login-qr-wrap').classList.toggle('verified',['password','verifying'].includes(session.status));
  if(ready&&loginPhase!=='password'){$('login-password').focus({preventScroll:true});$('login-password-form').scrollIntoView({behavior:'smooth',block:'center'});}
  loginPhase=session.status;
}
async function pollLogin(id){
  while(loginId===id&&$('login-dialog').open){const s=await api(`/api/auth/${id}`);if(loginId!==id)return;setPasswordStep(s);$('login-retry').hidden=!['failed','cancelled'].includes(s.status);
    if(s.status==='qr'&&s.qrVersion!==loginVersion){loginVersion=s.qrVersion;$('login-qr-wrap').innerHTML=`<img src="/api/auth/${id}/qr.svg?v=${s.qrVersion}" alt="Telegram 登录二维码">`;}
    const descriptions={starting:'正在连接 Telegram…',qr:'请使用手机 Telegram 扫码确认登录',password:'扫码已确认，请输入二步验证密码',verifying:'正在验证密码…',success:'登录成功',cancelled:'本次登录已取消',failed:s.error||'登录失败，请重试'};$('login-status').textContent=descriptions[s.status]||'正在登录…';
    if(s.status==='password')$('login-qr-wrap').innerHTML=`<div class="auth-done">${icons('check')}</div>`;
    if(['failed','cancelled'].includes(s.status)){$('login-qr-wrap').innerHTML=`<div class="empty-icon">${icons('refresh')}</div>`;loginId=null;return;}
    if(s.status==='success'){loginId=null;resetConversation();chats=[];state=await api('/api/state');renderAccounts();renderTasks();$('chat-search').value='';renderChats();$('login-dialog').close();toast('新账号登录成功，已切换');refreshChats();return;}await delay(600);
  }
}
async function startLogin(){if(loginId)await api(`/api/auth/${loginId}/cancel`,{});$('login-setup').hidden=true;$('login-progress').hidden=false;$('login-retry').hidden=true;setPasswordStep({status:'starting'});$('login-status').textContent='正在连接 Telegram…';$('login-qr-wrap').innerHTML='<div class="spinner"></div>';loginVersion='';const s=await api('/api/auth/start',{label:$('login-label').value,replaceAccountId:reloginAccountId});loginId=s.id;pollLogin(s.id).catch(e=>{$('login-status').textContent=e.message;$('login-retry').hidden=false;});}
async function closeLogin(){const id=loginId;loginId=null;$('login-password').value='';if(id)await api(`/api/auth/${id}/cancel`,{});$('login-dialog').close();}
function showLogin(){reloginAccountId=state.account.status==='logged_out'?state.account.id:null;renderAccounts();$('login-setup').hidden=false;$('login-progress').hidden=true;$('login-password').value='';$('login-dialog').showModal();queueVisibleThumbnails();}
async function loadPreview(item,signal){
  if(signal.aborted)return;
  const valid=()=>!signal.aborted&&item.generation===previewGeneration&&state.account.id===item.account&&currentScan?.chatId===item.chat;
  // Let creation return its ID even if the viewport changes, so that request can be cancelled.
  const op=await api('/api/media/preview',{accountId:item.account,scanId:item.scanId,messageId:item.id});
  const cancel=()=>{api(`/api/operations/${op.id}/cancel`,{}).catch(()=>{});};
  if(!valid()){cancel();return;}
  signal.addEventListener('abort',cancel,{once:true});
  try{
    const result=await awaitOperation(op.id,null,valid,signal);
    if(!valid())return;
    const current=currentScan.messages.find(message=>message.id===item.id);
    if(current){current.clearPreview=result.url;updateClearThumbnail(item.id,result.url);}
    autoPreviewFailures.delete(item.key);
  }finally{signal.removeEventListener('abort',cancel);}
}

$('tab-chat').onclick=()=>switchTab('chat');$('tab-links').onclick=()=>switchTab('links');$('chat-search').oninput=renderChats;
$('chat-list').onclick=guard(async e=>{const pin=e.target.closest('[data-pin]');if(pin){await toggleChatPin(pin.dataset.pin);return;}const item=e.target.closest('[data-chat]');if(item)await chooseChat(item.dataset.chat);});$('refresh-chats').onclick=refreshChats;
$('scan-button').onclick=guard(()=>scanMessages(historyAnchor?{jumpAt:historyAnchor.timestamp,jumpDate:historyAnchor.date}:{}));
document.addEventListener('workbench-date-filter',guard(async()=>{historyAnchor=null;$('return-latest').hidden=true;if(selectedChat)await scanMessages();}));
document.addEventListener('workbench-date-jump',guard(async event=>{if(!selectedChat||scanning)return;$('date-filter-enabled').value='0';document.dispatchEvent(new Event('workbench-date-reset'));$('media-search').value='';await scanMessages({jumpAt:event.detail.timestamp,jumpDate:event.detail.date});}));
$('return-latest').onclick=guard(async()=>{historyAnchor=null;$('return-latest').hidden=true;currentScan=null;$('media-search').value='';await scanMessages();});
$('scan-topic').onchange=guard(()=>{historyAnchor=null;$('return-latest').hidden=true;currentScan=null;selectedIds.clear();return scanMessages();});$('load-older').onclick=guard(()=>scanMessages({older:true}));$('media-search').oninput=()=>renderMessages();
$('media-list').onchange=e=>{const input=e.target.closest('[data-media]');if(!input)return;const id=Number(input.dataset.media);input.checked?selectedIds.add(id):selectedIds.delete(id);input.closest('.message-bubble').classList.toggle('selected',input.checked);updateSelection();};
$('media-list').onclick=guard(async e=>{const button=e.target.closest('[data-download]');if(button){button.disabled=true;try{await submitDownload([Number(button.dataset.download)]);}finally{button.disabled=false;}}});
$('select-all').onchange=()=>{for(const m of visibleMedia())$('select-all').checked?selectedIds.add(m.id):selectedIds.delete(m.id);renderMessages();};
$('clear-selection').onclick=()=>{cancelDragSelection();selectedIds.clear();syncSelectedRows();};
$('browse-folder').onclick=guard(()=>chooseFolder('download-directory',$('browse-folder')));$('settings-browse').onclick=guard(()=>chooseFolder('settings-directory',$('settings-browse')));$('folder-cancel').onclick=guard(cancelPicker);$('settings-picker-cancel').onclick=guard(cancelPicker);
$('save-default').onclick=guard(async()=>{
  const button=$('save-default');if(button.disabled)return;button.disabled=true;
  settingsAutosave.cancel('directory');
  try{const directory=$('download-directory').value;const result=await settingsAutosave.write(()=>api('/api/settings',{defaultDirectory:directory}));applySavedSettings(result,{defaultDirectory:directory});$('settings-directory').value=result.defaultDirectory;$('settings-directory').removeAttribute('aria-invalid');toast('已设为默认下载位置');}
  finally{button.disabled=false;}
});
$('download-button').onclick=guard(async()=>{$('download-button').disabled=true;try{await submitDownload();}finally{updateDownloadButton();}});
$('task-list').onclick=guard(async e=>{const b=e.target.closest('[data-action]');if(!b)return;const t=state.tasks.find(t=>t.id===b.dataset.task);if(!t)return;b.disabled=true;try{if(b.dataset.action==='open')await api('/api/folder/open',{directory:t.directory});else{await api(`/api/tasks/${t.id}/${b.dataset.action}`,{});state=await api('/api/state');renderTasks();}}finally{b.disabled=false;}});
$('clear-records').onclick=guard(async()=>{const count=state.tasks.filter(t=>!['queued','running'].includes(t.status)).length;if(!count||!confirm(`清除当前账号的 ${count} 条已结束下载记录？\n下载文件会保留，正在下载和等待中的任务也会保留。`))return;const r=await api('/api/tasks/clear',{accountId:state.account.id});state=await api('/api/state');renderTasks();toast(`已清除 ${r.cleared} 条记录`);});
async function downloadFolderAction(button,label,run){
  if(downloadFolderBusy||pickerId)return;
  downloadFolderBusy=true;const original=button.textContent;
  for(const id of ['settings-download-reset','settings-download-open','settings-browse','settings-directory'])$(id).disabled=true;
  button.textContent=label;
  try{await run();}finally{downloadFolderBusy=false;button.textContent=original;for(const id of ['settings-download-reset','settings-download-open','settings-browse','settings-directory'])$(id).disabled=false;}
}
$('settings-download-reset').onclick=guard(()=>downloadFolderAction($('settings-download-reset'),'正在恢复…',async()=>{
  settingsAutosave.cancel('directory');const result=await settingsAutosave.write(()=>api('/api/downloads/reset',{}));state.settings={...state.settings,...result};$('settings-directory').removeAttribute('aria-invalid');
  $('settings-directory').value=result.defaultDirectory;$('download-directory').value=result.defaultDirectory;renderDefault();toast('已恢复为系统下载文件夹，并保存');
}));
$('settings-download-open').onclick=guard(()=>downloadFolderAction($('settings-download-open'),'正在打开…',()=>api('/api/folder/open',{directory:$('settings-directory').value.trim()||state.settings.defaultDirectory})));
function updateProxyFields(){const mode=$('settings-proxy-mode').value,custom=mode==='custom';$('settings-proxy-field').hidden=!custom;$('settings-proxy').disabled=!custom;$('settings-proxy').required=custom;$('proxy-mode-hint').textContent=mode==='none'?'直接连接 Telegram，不使用代理。':mode==='system'?'读取 Windows 系统代理，桌面版支持自动代理脚本。':'支持 HTTP、HTTPS 和 SOCKS5 代理。更改后自动保存，测试使用当前填写的设置。';proxyTestVersion++;$('proxy-test-result').textContent='';$('proxy-test-result').className='connection-test-result';}
function renderCacheInfo(info){cacheInfo=info;const busy=cacheClearing||!!pickerId;$('cache-directory').textContent=info.directory;$('cache-size').textContent=`${formatBytes(info.bytes)||'0 B'} · ${info.files} 个文件`;$('cache-open').disabled=busy;$('cache-browse').disabled=busy;$('cache-reset').disabled=busy||info.isDefault;$('cache-clear').disabled=busy||!info.files;}
async function refreshCacheInfo(){try{renderCacheInfo(await api('/api/cache'));}catch(error){$('cache-size').textContent='统计失败';$('cache-result').textContent=error.message;}}
function showSettings(){
  const status=settingsAutosave.state();
  if(!settingsInitialized||(!status.pending&&!status.errors.length)){
    $('settings-directory').value=state.settings.defaultDirectory;$('settings-proxy').value=state.settings.customProxy??state.settings.proxy??'';$('settings-proxy-mode').value=state.settings.proxyMode||'custom';
    const speed=Number(state.settings.downloadLimitBps)||0,unit=speed&&speed<1048576?1024:1048576;$('settings-speed-unit').value=String(unit);$('settings-speed').value=String(speed/unit);$('settings-speed').max=String(1073741824/unit);updateProxyFields();settingsInitialized=true;
  }
  renderAutosaveStatus(status);$('settings-dialog').showModal();queueVisibleThumbnails();
  if(!cacheClearing){$('cache-result').textContent='';refreshCacheInfo();}
}
function closeSettings(){settingsAutosave.flush().then(ok=>{if(!ok)toast(settingsAutosave.state().errors[0]+'，该项未保存',true);});$('settings-dialog').close();}
$('settings-open').onclick=showSettings;$('settings-top').onclick=showSettings;$('settings-close').onclick=closeSettings;
document.addEventListener('workbench-open-appearance',()=>{if(!$('settings-dialog').open)showSettings();document.querySelector('.settings-body').scrollTop=0;document.querySelector('[data-theme-choice][aria-pressed="true"]')?.focus({preventScroll:true});});
$('settings-dialog').addEventListener('cancel',e=>{e.preventDefault();closeSettings();});
$('settings-dialog').addEventListener('close',()=>{settingsAutosave.flush();if(!cacheClearing)queueVisibleThumbnails();});
$('cache-open').onclick=guard(async()=>{
  const button=$('cache-open');button.disabled=true;button.textContent='正在打开…';
  try{await api('/api/cache/open',{});toast('已打开缓存文件夹');}finally{button.textContent='打开缓存文件夹';if(cacheInfo)renderCacheInfo(cacheInfo);}
});
async function changeCacheLocation(input){
  if(cacheClearing)return;
  cacheClearing=true;previewGeneration++;thumbnailQueue.update([]);clearTimeout(autoPreviewTimer);
  if(cacheInfo)renderCacheInfo(cacheInfo);$('cache-browse').textContent='正在迁移…';$('cache-result').textContent='正在迁移缓存，请稍候…';
  try{const result=await api('/api/cache/location',input);renderCacheInfo(result);autoPreviewFailures.clear();$('cache-result').textContent=result.warning||'缓存位置已更改，已有缩略图已迁移。';toast(result.warning||'缓存位置已保存');}
  catch(error){$('cache-result').textContent=error.message;throw error;}
  finally{cacheClearing=false;$('cache-browse').textContent='更改位置';await refreshCacheInfo();if(!$('settings-dialog').open)queueVisibleThumbnails();}
}
$('cache-browse').onclick=guard(async()=>{if(cacheClearing||!cacheInfo)return;const folder=await pickDirectory(cacheInfo.selectionDirectory||cacheInfo.directory,$('cache-browse'),true);if(folder)await changeCacheLocation({directory:folder});});
$('cache-reset').onclick=guard(()=>changeCacheLocation({useDefault:true}));
$('cache-picker-cancel').onclick=guard(cancelPicker);
$('cache-clear').onclick=guard(async()=>{
  if(cacheClearing)return;
  cacheClearing=true;previewGeneration++;clearTimeout(autoPreviewTimer);thumbnailQueue.update([]);
  if(cacheInfo)renderCacheInfo(cacheInfo);$('cache-clear').textContent='正在清理…';$('cache-result').textContent='正在停止预览加载并清理缓存…';
  try{
    const result=await api('/api/cache/clear',{});
    if(currentScan)for(const message of currentScan.messages)delete message.clearPreview;
    autoPreviewFailures.clear();renderMessages();renderCacheInfo(result);
    $('cache-result').textContent=`已清理 ${result.clearedFiles} 个文件，释放 ${formatBytes(result.clearedBytes)||'0 B'}。`;
    toast('缩略图缓存已清理');
  }catch(error){$('cache-result').textContent=error.message;throw error;}
  finally{cacheClearing=false;$('cache-clear').textContent='清理缓存';await refreshCacheInfo();if(!$('settings-dialog').open)queueVisibleThumbnails();}
});
$('settings-proxy-mode').onchange=()=>{updateProxyFields();scheduleSettings('proxy',true);};
$('settings-proxy').oninput=()=>{proxyTestVersion++;$('proxy-test-result').textContent='';scheduleSettings('proxy');};
$('settings-proxy').onchange=()=>scheduleSettings('proxy',true);
$('settings-directory').oninput=()=>scheduleSettings('directory');$('settings-directory').onchange=()=>scheduleSettings('directory',true);
$('settings-speed').oninput=()=>scheduleSettings('speed');$('settings-speed').onchange=()=>scheduleSettings('speed',true);
$('settings-speed-unit').onchange=()=>{$('settings-speed').max=String(1073741824/Number($('settings-speed-unit').value));scheduleSettings('speed',true);};
$('proxy-test').onclick=guard(async()=>{const version=++proxyTestVersion,button=$('proxy-test');button.disabled=true;button.textContent='正在测试…';$('proxy-test-result').textContent='正在连接 Telegram 网站，请稍候…';$('proxy-test-result').className='connection-test-result';try{const result=await api('/api/proxy/test',{proxyMode:$('settings-proxy-mode').value,customProxy:$('settings-proxy').value.trim()});if(version!==proxyTestVersion)return;$('proxy-test-result').textContent=result.message+(result.ok?` · ${result.latencyMs} ms`:'');$('proxy-test-result').className=`connection-test-result ${result.ok?'success':'error'}`;}catch(error){if(version===proxyTestVersion){$('proxy-test-result').textContent=error.message;$('proxy-test-result').className='connection-test-result error';}}finally{button.disabled=false;button.textContent='测试连接';}});
$('settings-form').onsubmit=e=>{e.preventDefault();settingsAutosave.flush();};
$('account-select').onchange=guard(e=>switchAccount(e.target.value));$('account-add').onclick=showLogin;$('login-top').onclick=showLogin;
$('account-list').onclick=guard(async e=>{
  if(accountActionBusy)return;
  const logout=e.target.closest('[data-logout]'),relogin=e.target.closest('[data-relogin]'),button=e.target.closest('[data-account]');
  if(logout){
    const account=state.accounts.find(a=>a.id===logout.dataset.logout);if(!account)return;
    if(!confirm(`退出“${account.label}”的登录？\n\n本软件及共用同一 tdl 登录的工具会退出此会话，手机和其他 Telegram 设备不受影响。已下载文件和记录保留，之后需要重新扫码。`))return;
    accountActionBusy=true;switching=true;renderAccounts();thumbnailQueue.update([]);
    try{
      const op=await api('/api/accounts/logout',{accountId:account.id});
      const result=await awaitOperation(op.id);resetConversation();state=await api('/api/state');chats=(await api('/api/chats')).chats;
      renderAccounts();renderChats();renderTasks();toast(result.warning||'账号已退出，可以重新扫码登录');
    }finally{accountActionBusy=false;switching=false;state=await api('/api/state');renderAccounts();renderChats();updateDownloadButton();}
  }else if(relogin){
    const account=state.accounts.find(a=>a.id===relogin.dataset.relogin);if(!account)return;reloginAccountId=account.id;$('login-label').value=account.label;await startLogin();
  }else if(button)await switchAccount(button.dataset.account);
});
$('login-dialog').addEventListener('close',()=>queueVisibleThumbnails());
$('login-start').onclick=guard(startLogin);$('login-retry').onclick=guard(startLogin);$('login-close').onclick=guard(closeLogin);$('login-cancel').onclick=guard(closeLogin);
$('login-dialog').addEventListener('cancel',e=>{e.preventDefault();closeLogin().catch(()=>$('login-dialog').close());});
$('login-password-form').onsubmit=guard(async e=>{e.preventDefault();const password=$('login-password').value;$('login-password').value='';await api(`/api/auth/${loginId}/input`,{password});setPasswordStep({status:'verifying'});$('login-status').textContent='正在验证密码…';});
let historyScrollTimer;
function updateViewportPreviews(){if(thumbnailFrame===null)thumbnailFrame=requestAnimationFrame(()=>{thumbnailFrame=null;queueVisibleThumbnails();});}
$('media-list').addEventListener('scroll',()=>{updateViewportPreviews();clearTimeout(historyScrollTimer);historyScrollTimer=setTimeout(()=>{const list=$('media-list');if(scanning||$('media-search').value.trim())return;if(list.scrollTop<100&&currentScan?.hasMore)scanMessages({older:true}).catch(error=>toast(error.message,true));else if(list.scrollHeight-list.scrollTop-list.clientHeight<100&&currentScan?.hasMoreNewer)scanMessages({newer:true}).catch(error=>toast(error.message,true));},120);},{passive:true});
window.addEventListener('scroll',updateViewportPreviews,{passive:true});window.addEventListener('resize',updateViewportPreviews);
document.addEventListener('visibilitychange',queueVisibleThumbnails);
let dragSelection=null,dragFrame=null,suppressSelectionClick=false;
function syncSelectedRows(){for(const input of $('media-list').querySelectorAll('[data-media]')){const selected=selectedIds.has(Number(input.dataset.media));input.checked=selected;input.closest('.message-bubble').classList.toggle('selected',selected);}updateSelection();}
function cancelDragSelection(restore=false){if(!dragSelection)return;const drag=dragSelection;dragSelection=null;cancelAnimationFrame(dragFrame);dragFrame=null;$('media-list').classList.remove('is-drag-selecting');if($('media-list').hasPointerCapture(drag.pointer))$('media-list').releasePointerCapture(drag.pointer);if(restore&&drag.active){selectedIds=new Set(drag.original);syncSelectedRows();}}
function applyDragRange(){
  const drag=dragSelection;if(!drag?.active)return;
  const root=$('media-list'),bounds=root.getBoundingClientRect(),x=Math.max(bounds.left+5,Math.min(bounds.right-5,drag.x)),y=Math.max(bounds.top+3,Math.min(bounds.bottom-3,drag.y));
  const rows=[...root.querySelectorAll('.message-file')];let closest=null,distance=Infinity;
  for(const row of rows){const box=row.getBoundingClientRect();if(box.bottom<bounds.top||box.top>bounds.bottom)continue;const gap=y<box.top?box.top-y:y>box.bottom?y-box.bottom:0;if(gap<distance){distance=gap;closest=row;}}
  const hit=document.elementFromPoint(x,y)?.closest('.message-bubble')?.querySelector('[data-media]')||closest?.querySelector('[data-media]');if(!hit)return;
  const list=visibleMedia().map(message=>message.id),start=list.indexOf(drag.start),end=list.indexOf(Number(hit.dataset.media));if(start<0||end<0)return;
  selectedIds=new Set(drag.original);for(const id of list.slice(Math.min(start,end),Math.max(start,end)+1))drag.select?selectedIds.add(id):selectedIds.delete(id);syncSelectedRows();
}
function tickDragScroll(){
  const drag=dragSelection;if(!drag?.active)return;const root=$('media-list'),box=root.getBoundingClientRect(),edge=52;
  const direction=drag.y<box.top+edge?-Math.min(1,(box.top+edge-drag.y)/edge):drag.y>box.bottom-edge?Math.min(1,(drag.y-box.bottom+edge)/edge):0;
  if(direction){root.scrollTop+=direction*13;applyDragRange();}dragFrame=requestAnimationFrame(tickDragScroll);
}
$('media-list').addEventListener('pointerdown',event=>{
  if(event.button!==0||event.pointerType==='touch'||!currentScan||scanning||event.target.closest('button,a,.message-text')||event.target.closest('input:not([data-media]),textarea,select'))return;
  const root=$('media-list'),bubble=event.target.closest('.message-bubble');
  let input=(event.target.closest('.message-file')||bubble)?.querySelector('[data-media]');
  const blank=!bubble;
  if(!input){
    const bounds=root.getBoundingClientRect();let distance=Infinity;
    for(const file of root.querySelectorAll('.message-file')){const box=file.getBoundingClientRect();if(box.bottom<bounds.top||box.top>bounds.bottom)continue;const gap=event.clientY<box.top?box.top-event.clientY:event.clientY>box.bottom?event.clientY-box.bottom:0;if(gap<distance){distance=gap;input=file.querySelector('[data-media]');}}
  }
  if(!input)return;
  dragSelection={pointer:event.pointerId,x:event.clientX,y:event.clientY,firstX:event.clientX,firstY:event.clientY,start:Number(input.dataset.media),select:blank||!selectedIds.has(Number(input.dataset.media)),original:new Set(selectedIds),active:false};
});
document.addEventListener('pointermove',event=>{
  const drag=dragSelection;if(!drag||event.pointerId!==drag.pointer)return;drag.x=event.clientX;drag.y=event.clientY;
  if(!drag.active&&Math.hypot(drag.x-drag.firstX,drag.y-drag.firstY)<6)return;
  if(!drag.active){drag.active=true;$('media-list').classList.add('is-drag-selecting');$('media-list').setPointerCapture(drag.pointer);dragFrame=requestAnimationFrame(tickDragScroll);}
  event.preventDefault();applyDragRange();
},{passive:false});
document.addEventListener('pointerup',event=>{if(!dragSelection||event.pointerId!==dragSelection.pointer)return;if(dragSelection.active){event.preventDefault();suppressSelectionClick=true;setTimeout(()=>suppressSelectionClick=false,0);}cancelDragSelection();});
document.addEventListener('pointercancel',()=>cancelDragSelection(true));window.addEventListener('blur',()=>cancelDragSelection(true));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dragSelection?.active){event.preventDefault();cancelDragSelection(true);}});
$('media-list').addEventListener('click',event=>{if(suppressSelectionClick){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
window.addEventListener('pagehide',()=>{if(pickerId)fetch('/api/folder/cancel',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Workbench-Key':key},body:JSON.stringify({id:pickerId})}).catch(()=>{});});
async function init(){const today=new Date(),week=new Date(Date.now()-6*86400000);const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;$('date-from').value=localDate(week);$('date-to').value=localDate(today);state=await api('/api/state');$('download-directory').value=state.settings.defaultDirectory;renderAccounts();renderDefault();renderTasks();updateDownloadButton();chats=(await api('/api/chats')).chats;renderChats();if(state.account.status==='ready'&&!state.chatsUpdated)refreshChats();pollState();connection();}
init().catch(e=>toast(`工作台启动失败，请刷新页面：${e.message}`,true));
