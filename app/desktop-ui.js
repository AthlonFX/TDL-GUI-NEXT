(() => {
  document.documentElement.classList.add('desktop-shell');
  if(!document.querySelector('.desktop-titlebar')){
    const title=document.createElement('div');title.className='desktop-titlebar';title.innerHTML='<span>TDL-GUI-NEXT</span>';document.body.prepend(title);
  }
  const sync=()=>window.tdlDesktop?.setAppearance(document.documentElement.dataset.theme||'light');
  new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});sync();
  const breadcrumb=document.querySelector('.breadcrumb');if(breadcrumb)breadcrumb.textContent='Telegram';
  const description=document.querySelector('.destination-footnote');if(description)description.textContent='文件保存在电脑本机。';
  if(!document.getElementById('desktop-close-behavior')){
    const section=document.createElement('section');section.className='desktop-window-settings';
    section.innerHTML='<h3>窗口与托盘</h3><label class="settings-field">点击窗口关闭按钮时<select id="desktop-close-behavior"><option value="ask">每次询问</option><option value="tray">最小化到右下角托盘</option><option value="quit">退出软件</option></select></label><p class="muted small">立即保存。托盘图标随软件启动，单击可打开窗口，右键可退出。最小化到托盘时下载继续运行。</p><p id="desktop-close-status" class="muted small" role="status"></p>';
    document.querySelector('.about-settings')?.before(section);
    const field=section.querySelector('select'),status=section.querySelector('#desktop-close-status');
    let saved='ask';
    const syncPreferences=()=>window.tdlDesktop.getPreferences().then(value=>{saved=value.closeBehavior;field.value=saved;}).catch(()=>{status.textContent='关闭行为读取失败，请重新打开软件';});
    field.addEventListener('change',async()=>{field.disabled=true;try{const value=await window.tdlDesktop.setCloseBehavior(field.value);saved=value.closeBehavior;status.textContent='关闭行为已保存';}catch(error){field.value=saved;status.textContent=error.message;}finally{field.disabled=false;}});
    new MutationObserver(()=>{if(document.getElementById('settings-dialog').open)syncPreferences();}).observe(document.getElementById('settings-dialog'),{attributes:true,attributeFilter:['open']});
    syncPreferences();
  }
})();
