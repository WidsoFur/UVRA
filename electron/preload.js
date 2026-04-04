const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uvra', {
  startServer: (port) => ipcRenderer.invoke('start-server', port),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  connectPipe: (hand) => ipcRenderer.invoke('connect-pipe', hand),
  disconnectPipe: (hand) => ipcRenderer.invoke('disconnect-pipe', hand),
  getStatus: () => ipcRenderer.invoke('get-status'),
  calibrate: (hand) => ipcRenderer.invoke('calibrate', hand),

  // Driver management
  driverGetStatus: () => ipcRenderer.invoke('driver-get-status'),
  driverInstall: () => ipcRenderer.invoke('driver-install'),
  driverUninstall: () => ipcRenderer.invoke('driver-uninstall'),
  driverCheck: () => ipcRenderer.invoke('driver-check'),

  onDriverLog: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('driver-log', listener);
    return () => ipcRenderer.removeListener('driver-log', listener);
  },
  onDriverStatus: (callback) => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on('driver-status', listener);
    return () => ipcRenderer.removeListener('driver-status', listener);
  },
  onDriverDownloadProgress: (callback) => {
    const listener = (_, percent) => callback(percent);
    ipcRenderer.on('driver-download-progress', listener);
    return () => ipcRenderer.removeListener('driver-download-progress', listener);
  },

  onGloveData: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('glove-data', listener);
    return () => ipcRenderer.removeListener('glove-data', listener);
  },
  onGloveConnected: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on('glove-connected', listener);
    return () => ipcRenderer.removeListener('glove-connected', listener);
  },
  onGloveDisconnected: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on('glove-disconnected', listener);
    return () => ipcRenderer.removeListener('glove-disconnected', listener);
  },
  onServerError: (callback) => {
    const listener = (_, err) => callback(err);
    ipcRenderer.on('server-error', listener);
    return () => ipcRenderer.removeListener('server-error', listener);
  },

  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
});
