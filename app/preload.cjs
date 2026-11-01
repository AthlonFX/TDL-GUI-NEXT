const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('tdlDesktop',Object.freeze({
  setAppearance(theme){if(theme==='light'||theme==='dark')ipcRenderer.send('desktop-appearance',theme);},
  getPreferences(){return ipcRenderer.invoke('desktop-preferences:get');},
  setCloseBehavior(value){if(!['ask','tray','quit'].includes(value))return Promise.reject(new Error('请选择有效的关闭行为'));return ipcRenderer.invoke('desktop-preferences:set',value);}
}));
