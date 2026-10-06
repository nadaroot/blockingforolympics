const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lokedBrowser', {
  close: () => ipcRenderer.send('close-browser'),
  onMessage: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  }
});
