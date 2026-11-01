(() => {
  const el=id=>document.getElementById(id);
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function parse(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d,12);
    return y>=1970&&y<=9998&&iso(date)===value?date:null;
  }
  const utcDay=value=>{const [y,m,d]=value.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;};
  let from='',to='',phase='start',month=new Date(),mode='range',jumpValue='';
  function rangeSummary(){
    const active=el('date-filter-enabled').value==='1';
    el('date-range-label').textContent=active?`${el('date-from').value} → ${el('date-to').value}`:'不限日期';
    el('date-filter-clear').hidden=!active;el('date-range-open').classList.toggle('filter-active',active);
    document.querySelectorAll('[data-date-shortcut]').forEach(button=>{const [a,b]=preset(button.dataset.dateShortcut);button.setAttribute('aria-pressed',String(a===el('date-from').value&&b===el('date-to').value));});
  }
  function preset(key){
    const end=new Date();end.setHours(12,0,0,0);let start=new Date(end);
    if(key==='yesterday'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1);}
    else if(key==='7'||key==='30')start.setDate(start.getDate()-Number(key)+1);
    else if(key==='month')start.setDate(1);
    else if(key==='previous'){end.setDate(0);start=new Date(end.getFullYear(),end.getMonth(),1,12);}
    return [iso(start),iso(end)];
  }
  function calendarMonth(date){
    const year=date.getFullYear(),number=date.getMonth(),first=new Date(year,number,1,12),days=new Date(year,number+1,0,12).getDate(),offset=(first.getDay()+6)%7;
    const low=from<to?from:to,high=from>to?from:to;
    let html=`<section class="calendar-month" aria-label="${year}年${number+1}月"><h3>${year} 年 ${number+1} 月</h3><div class="calendar-weekdays" aria-hidden="true">${['一','二','三','四','五','六','日'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-days">`;
    html+='<span class="calendar-blank"></span>'.repeat(offset);
    for(let day=1;day<=days;day++){
      const value=iso(new Date(year,number,day,12)),edge=mode==='jump'?value===jumpValue:value===from||value===to,inside=mode==='range'&&!!low&&value>=low&&value<=high,today=value===iso(new Date());
      html+=`<button type="button" data-date="${value}" class="calendar-day ${edge?'range-edge':''} ${inside?'in-range':''} ${today?'is-today':''}" aria-label="${year}年${number+1}月${day}日" aria-pressed="${edge}" ${today?'aria-current="date"':''}>${day}</button>`;
    }
    return html+'</div></section>';
  }
  function draw(syncInputs=true){
    el('calendar-year').value=month.getFullYear();el('calendar-month').value=month.getMonth();
    el('calendar-months').innerHTML=calendarMonth(month)+calendarMonth(new Date(month.getFullYear(),month.getMonth()+1,1,12));
    if(syncInputs){el('calendar-from').value=from;el('calendar-to').value=to;el('calendar-jump').value=jumpValue;}
    const valid=mode==='jump'?!!parse(jumpValue):!!parse(from)&&!!parse(to)&&from<=to;
    el('date-apply').disabled=!valid;
    el('calendar-summary').textContent=mode==='jump'?(valid?`跳转到 ${jumpValue}`:'请选择有效日期'):valid?`${from} → ${to} · ${utcDay(to)-utcDay(from)+1} 天`:'请选择有效的开始和结束日期';
    el('calendar-instruction').textContent=mode==='jump'?'选择一天，点击「跳转」。':phase==='end'?'再选结束日期（也可以选择更早的一天）。':phase==='done'?'范围已选好，点击「应用日期」。':'先选开始日期，再选结束日期。';
    document.querySelectorAll('[data-date-preset]').forEach(button=>{const [a,b]=preset(button.dataset.datePreset);button.setAttribute('aria-pressed',String(a===from&&b===to));});
    el('calendar-prev').disabled=month.getFullYear()===1970&&month.getMonth()===0;
    el('calendar-next').disabled=month.getFullYear()>=9998&&month.getMonth()>=10;
  }
  function applyRange(a,b){
    if(el('date-from').disabled)return;
    el('date-from').value=a;el('date-to').value=b;el('date-filter-enabled').value='1';rangeSummary();
    el('date-from').dispatchEvent(new Event('change',{bubbles:true}));el('date-to').dispatchEvent(new Event('change',{bubbles:true}));
    document.dispatchEvent(new Event('workbench-date-filter'));
  }
  function open(nextMode='range'){
    if(el('date-from').disabled)return;
    mode=nextMode;
    from=el('date-from').value;to=el('date-to').value;phase='start';
    jumpValue=jumpValue||iso(new Date());
    el('date-dialog-title').textContent=mode==='jump'?'跳转到日期':'选择日期范围';
    el('date-dialog-eyebrow').textContent=mode==='jump'?'GO TO DATE':'DATE RANGE';
    el('calendar-range-fields').hidden=mode==='jump';el('calendar-presets').hidden=mode==='jump';
    el('calendar-jump-field').hidden=mode!=='jump';el('calendar-jump-presets').hidden=mode!=='jump';el('date-jump-hint').hidden=mode!=='jump';
    el('date-apply').textContent=mode==='jump'?'跳转':'应用日期';
    const initial=parse(mode==='jump'?jumpValue:from)||new Date();month=new Date(initial.getFullYear(),initial.getMonth(),1,12);
    ensureYear(month.getFullYear());draw();el('date-dialog').showModal();
  }
  function ensureYear(year){if(!Array.from(el('calendar-year').options).some(o=>Number(o.value)===year))el('calendar-year').add(new Option(`${year} 年`,year));}
  document.addEventListener('DOMContentLoaded',()=>{
    const year=new Date().getFullYear();el('calendar-year').innerHTML=Array.from({length:year-1970+2},(_,i)=>`<option value="${1970+i}">${1970+i} 年</option>`).join('');
    el('calendar-month').innerHTML=Array.from({length:12},(_,i)=>`<option value="${i}">${i+1} 月</option>`).join('');
    el('date-range-open').onclick=()=>open('range');el('date-jump-open').onclick=()=>open('jump');
    el('date-filter-clear').onclick=()=>{el('date-filter-enabled').value='0';rangeSummary();document.dispatchEvent(new Event('workbench-date-filter'));};
    document.addEventListener('workbench-date-reset',rangeSummary);
    el('date-close').onclick=el('date-cancel').onclick=()=>el('date-dialog').close();
    el('date-apply').onclick=()=>{
      if(mode==='jump'){
        if(!parse(jumpValue))return;
        document.dispatchEvent(new CustomEvent('workbench-date-jump',{detail:{date:jumpValue,timestamp:Math.floor(+new Date(jumpValue+'T00:00:00')/1000)}}));
      }else{if(!parse(from)||!parse(to)||from>to)return;applyRange(from,to);}
      el('date-dialog').close();
    };
    document.querySelectorAll('[data-jump-preset]').forEach(button=>button.onclick=()=>{const date=new Date();date.setDate(date.getDate()-Number(button.dataset.jumpPreset));jumpValue=iso(date);month=new Date(date.getFullYear(),date.getMonth(),1,12);ensureYear(month.getFullYear());draw();});
    document.querySelectorAll('[data-date-shortcut]').forEach(button=>button.onclick=()=>applyRange(...preset(button.dataset.dateShortcut)));
    document.querySelectorAll('[data-date-preset]').forEach(button=>button.onclick=()=>{[from,to]=preset(button.dataset.datePreset);phase='done';const date=parse(from);month=new Date(date.getFullYear(),date.getMonth(),1,12);draw();});
    el('calendar-months').onclick=event=>{
      const button=event.target.closest('[data-date]');if(!button)return;
      const value=button.dataset.date;
      if(mode==='jump'){jumpValue=value;draw();el('calendar-months').querySelector(`[data-date="${value}"]`)?.focus();return;}
      if(phase!=='end'){from=value;to=value;phase='end';}
      else{to=value;if(to<from)[from,to]=[to,from];phase='done';}
      draw();el('calendar-months').querySelector(`[data-date="${value}"]`)?.focus();
    };
    function navigate(delta){month=new Date(month.getFullYear(),month.getMonth()+delta,1,12);ensureYear(month.getFullYear());draw();}
    el('calendar-prev').onclick=()=>navigate(-1);el('calendar-next').onclick=()=>navigate(1);
    const jump=()=>{month=new Date(Number(el('calendar-year').value),Number(el('calendar-month').value),1,12);draw();};
    el('calendar-year').onchange=jump;el('calendar-month').onchange=jump;
    for(const id of ['calendar-from','calendar-to']){
      el(id).addEventListener('input',()=>{from=el('calendar-from').value;to=el('calendar-to').value;phase='done';draw(false);});
      el(id).addEventListener('change',()=>{const date=parse(el(id).value);if(date){month=new Date(date.getFullYear(),date.getMonth(),1,12);ensureYear(month.getFullYear());draw(false);}});
      el(id).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(!el('date-apply').disabled)el('date-apply').click();}});
    }
    el('calendar-jump').addEventListener('input',()=>{jumpValue=el('calendar-jump').value;draw(false);});
    el('calendar-jump').addEventListener('change',()=>{const date=parse(jumpValue);if(date){month=new Date(date.getFullYear(),date.getMonth(),1,12);ensureYear(month.getFullYear());draw(false);}});
    el('calendar-jump').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(!el('date-apply').disabled)el('date-apply').click();}});
    el('calendar-months').addEventListener('keydown',event=>{
      const button=event.target.closest('[data-date]');if(!button)return;
      const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};if(!(event.key in offsets))return;
      event.preventDefault();const next=parse(button.dataset.date);next.setDate(next.getDate()+offsets[event.key]);if(next.getFullYear()<1970||next.getFullYear()>9998)return;
      if(!el('calendar-months').querySelector(`[data-date="${iso(next)}"]`)){month=new Date(next.getFullYear(),next.getMonth(),1,12);ensureYear(month.getFullYear());draw();}
      el('calendar-months').querySelector(`[data-date="${iso(next)}"]`)?.focus();
    });
    new MutationObserver(()=>{const disabled=el('date-from').disabled;el('date-range-open').disabled=disabled;document.querySelectorAll('[data-date-shortcut]').forEach(button=>button.disabled=disabled);if(disabled&&el('date-dialog').open)el('date-dialog').close();}).observe(el('date-from'),{attributes:true,attributeFilter:['disabled']});
    rangeSummary();
  });
})();
