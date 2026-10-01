const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soundDesktop', {
  isDesktop: true,
  openProject: () => ipcRenderer.invoke('sound:open-project'),
  saveProject: payload => ipcRenderer.invoke('sound:save-project', payload),
  setBusy: busy => ipcRenderer.send('sound:busy', busy === true),
  onCommand: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('sound:command', listener);
    return () => ipcRenderer.removeListener('sound:command', listener);
  },
});
