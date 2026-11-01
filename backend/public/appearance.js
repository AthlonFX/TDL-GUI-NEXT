(() => {
  const storageKey = 'tdl-workbench-appearance';
  const presets = [ ['青绿','#087f76'], ['蓝色','#2563eb'], ['紫色','#7c3aed'], ['玫红','#db2777'], ['橙色','#c46512'], ['灰色','#596579'] ];
  const system = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let themeAnimationTimer;
  let preference = { mode:'system', accent:'#087f76' };
  try { const saved=JSON.parse(localStorage.getItem(storageKey)||'null'); if(saved&&['system','light','dark'].includes(saved.mode)&&/^#[0-9a-f]{6}$/i.test(saved.accent))preference=saved; } catch {}
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const luminance = channels => channels.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const contrast = (a,b) => (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  function apply(animate=false) {
    const root=document.documentElement;
    if(animate&&!reducedMotion.matches){clearTimeout(themeAnimationTimer);root.classList.add('theme-changing');themeAnimationTimer=setTimeout(()=>root.classList.remove('theme-changing'),280);}
    const dark=preference.mode==='dark'||preference.mode==='system'&&system.matches;
    const channels=rgb(preference.accent),background=luminance(dark?[26,33,43]:[255,255,255]);
    let text=channels.slice();
    for(let step=0;step<30&&contrast(luminance(text),background)<5.5;step++)text=text.map(v=>v+(dark?255-v:-v)*.1);
    root.dataset.theme=dark?'dark':'light';root.dataset.themeMode=preference.mode;
    root.style.colorScheme=dark?'dark':'light';
    root.style.setProperty('--accent-base',preference.accent);
    root.style.setProperty('--teal',`rgb(${text.map(Math.round).join(' ')})`);
    root.style.setProperty('--accent-on',contrast(luminance(channels),1)>=4.5?'#ffffff':'#000000');
    document.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===preference.mode)));
    document.querySelectorAll('[data-accent]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.accent===preference.accent.toLowerCase())));
    const select=document.getElementById('theme-mode');if(select)select.value=preference.mode;
    const custom=document.getElementById('accent-custom');if(custom)custom.value=preference.accent;
    const value=document.getElementById('accent-value');if(value)value.textContent=preference.accent.toUpperCase();
  }
  function save() {
    apply(true);let saved=true;
    try{localStorage.setItem(storageKey,JSON.stringify(preference));}catch{saved=false;}
    const status=document.getElementById('appearance-status');if(status)status.textContent=saved?'已自动保存':'当前浏览器无法保存外观设置';
  }
  apply();
  system.addEventListener('change',()=>{if(preference.mode==='system')apply(true);});
  reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches){clearTimeout(themeAnimationTimer);document.documentElement.classList.remove('theme-changing');}});
  window.addEventListener('storage',event=>{if(event.key!==storageKey)return;try{const next=JSON.parse(event.newValue);if(next&&['system','light','dark'].includes(next.mode)&&/^#[0-9a-f]{6}$/i.test(next.accent)){preference=next;apply(true);}}catch{}});
  document.addEventListener('DOMContentLoaded',()=>{
    const host=document.getElementById('accent-presets');
    host.innerHTML=presets.map(([name,color])=>`<button type="button" class="accent-option" data-accent="${color}" aria-label="${name}主题" aria-pressed="false" title="${name}"><span style="--swatch:${color}"></span><small>${name}</small></button>`).join('');
    document.querySelectorAll('[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>{preference.mode=button.dataset.themeChoice;save();}));
    host.addEventListener('click',event=>{const button=event.target.closest('[data-accent]');if(button){preference.accent=button.dataset.accent;save();}});
    document.getElementById('accent-custom').addEventListener('input',event=>{preference.accent=event.target.value;save();});
    const actions=document.querySelector('.topbar-actions');
    const button=document.createElement('button');button.type='button';button.id='theme-open';button.className='button quiet theme-settings-trigger';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','settings-dialog');button.innerHTML='<span aria-hidden="true">◐</span>主题';
    actions.prepend(button);button.addEventListener('click',()=>document.dispatchEvent(new Event('workbench-open-appearance')));
    apply();
  });
})();
