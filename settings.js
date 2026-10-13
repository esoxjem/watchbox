(async function () {
  document.getElementById('extension-version').textContent=`Watchbox ${browser.runtime.getManifest().version}`;
  const master=document.getElementById('hide-related');
  const status=document.getElementById('setting-status');
  const controls=new Map();
  for(const [title,options] of WatchboxPreferences.groups) {
    const section=document.createElement('fieldset');
    const legend=document.createElement('legend');legend.textContent=title;section.append(legend);
    for(const [key,label] of options) {
      const row=document.createElement('label'),input=document.createElement('input');
      input.type='checkbox';input.dataset.preference=key;input.disabled=true;
      row.append(input,document.createTextNode(label));section.append(row);controls.set(key,input);
    }
    if(title==='Inbox') {
      const row=document.createElement('label'),input=document.createElement('input'),hint=document.createElement('p');
      input.type='number';input.min='1';input.max='30';input.step='1';input.required=true;input.disabled=true;input.dataset.preference='inboxDays';
      hint.id='inbox-days-hint';hint.textContent='Default: 14 days. Choose 1–30 days. Older videos stay in Subscriptions. Videos you move to Inbox stay there.';
      input.setAttribute('aria-describedby',hint.id);
      row.append(document.createTextNode('Show the last '),input,document.createTextNode(' days'));section.append(row,hint);controls.set('inboxDays',input);
    }
    if(title==='Home') {const hint=document.createElement('p');hint.textContent='Redirect works when Home Feed is hidden and Subscriptions are visible.';section.append(hint);}
    if(title==='General') {const hint=document.createElement('p');hint.textContent='Dark mode changes this settings page. YouTube keeps its own theme.';section.append(hint);}
    document.getElementById('setting-groups').append(section);
  }
  let stored={},saving=false;
  function render() {
    const values=WatchboxPreferences.resolve(stored);
    for(const [key,input] of controls) {
      if(input.type==='number')input.value=values[key];else input.checked=values[key];
    }
    master.checked=WatchboxPreferences.related.every(key=>values[key]);
    master.indeterminate=!master.checked && WatchboxPreferences.related.some(key=>values[key]);
    if(typeof stored.darkMode==='boolean')document.documentElement.dataset.theme=stored.darkMode?'dark':'light';
    else delete document.documentElement.dataset.theme;
  }
  function disable(value) {master.disabled=value;for(const input of controls.values())input.disabled=value;}
  async function save(key,value) {
    if(saving)return;
    saving=true;disable(true);
    try {
      const data=await browser.storage.local.get('watchboxPreferences');
      const next={...data.watchboxPreferences};
      if(key==='hideRelated') {next.hideRelated=value;for(const child of WatchboxPreferences.related)delete next[child];}
      else {next[key]=value;if(key==='hideShorts')next.quiet=value;}
      await browser.storage.local.set({watchboxPreferences:next});stored=next;status.textContent='Saved';
    } catch {status.textContent='Could not save. Try again.';}
    finally {saving=false;render();disable(false);}
  }
  master.onchange=()=>save('hideRelated',master.checked);
  for(const [key,input] of controls)input.onchange=()=>{
    if(input.type==='number' && !input.checkValidity()) {status.textContent='Choose a whole number from 1 to 30.';return;}
    save(key,input.type==='number'?input.valueAsNumber:input.checked);
  };
  try {
    const data=await browser.storage.local.get('watchboxPreferences');stored=data.watchboxPreferences||{};render();disable(false);
  } catch {status.textContent='Could not load settings. Reload to try again.';return;}
  browser.storage.onChanged?.addListener((changes,area)=>{
    if(area==='local' && changes.watchboxPreferences) {stored=changes.watchboxPreferences.newValue||{};render();}
  });
})();
