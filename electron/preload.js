const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uvra', {
  startServer: (port) => ipcRenderer.invoke('start-server', port),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  connectPipe: (hand) => ipcRenderer.invoke('connect-pipe', hand),
  disconnectPipe: (hand) => ipcRenderer.invoke('disconnect-pipe', hand),
  getStatus: () => ipcRenderer.invoke('get-status'),
  calibrate: (hand, duration) => ipcRenderer.invoke('calibrate', { hand, duration }),
  calibrateCancel: (hand) => ipcRenderer.invoke('calibrate-cancel', hand),
  calibrationGet: (hand) => ipcRenderer.invoke('calibration-get', hand),
  calibrationSet: (hand, calibration) => ipcRenderer.invoke('calibration-set', { hand, calibration }),
  smoothingSet: (hand, alpha) => ipcRenderer.invoke('smoothing-set', { hand, alpha }),
  deadzoneSet: (hand, deadzone) => ipcRenderer.invoke('deadzone-set', { hand, deadzone }),
  flexGainSet: (hand, gain) => ipcRenderer.invoke('flex-gain-set', { hand, gain }),
  thumbGainSet: (hand, gain) => ipcRenderer.invoke('thumb-gain-set', { hand, gain }),
  oneEuroSet: (hand, minCutoff, beta) => ipcRenderer.invoke('one-euro-set', { hand, minCutoff, beta }),
  onCalibrationStart: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on('calibration-start', listener);
    return () => ipcRenderer.removeListener('calibration-start', listener);
  },
  onCalibrationPhase: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on('calibration-phase', listener);
    return () => ipcRenderer.removeListener('calibration-phase', listener);
  },
  onCalibrationEnd: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on('calibration-end', listener);
    return () => ipcRenderer.removeListener('calibration-end', listener);
  },

  // Device management (MAC-based)
  deviceGetAll: () => ipcRenderer.invoke('device-get-all'),
  deviceSet: (mac, hand, name) => ipcRenderer.invoke('device-set', { mac, hand, name }),
  deviceRemove: (mac) => ipcRenderer.invoke('device-remove', mac),
  onDeviceDiscovered: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on('device-discovered', listener);
    return () => ipcRenderer.removeListener('device-discovered', listener);
  },

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
  onServerAutoStarted: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on('server-auto-started', listener);
    return () => ipcRenderer.removeListener('server-auto-started', listener);
  },

  // Tracking reference
  trackingGetDevices: () => ipcRenderer.invoke('tracking-get-devices'),
  trackingBind: (hand, deviceId) => ipcRenderer.invoke('tracking-bind', { hand, deviceId }),

  // Pose offsets
  poseOffsetsGet: () => ipcRenderer.invoke('pose-offsets-get'),
  poseOffsetsSet: (offsets) => ipcRenderer.invoke('pose-offsets-set', offsets),
  poseOffsetsPushLive: (offsets) => ipcRenderer.invoke('pose-offsets-push-live', offsets),

  // Pose presets
  posePresetsList: () => ipcRenderer.invoke('pose-presets-list'),
  posePresetsSave: (name, offsets) => ipcRenderer.invoke('pose-presets-save', { name, offsets }),
  posePresetsDelete: (name) => ipcRenderer.invoke('pose-presets-delete', { name }),

  // Dev emulator
  devEmulatorSend: (data) => ipcRenderer.invoke('dev-emulator-send', data),
  devEmulatorStart: (hand, fps) => ipcRenderer.invoke('dev-emulator-start', { hand, fps }),
  devEmulatorStop: () => ipcRenderer.invoke('dev-emulator-stop'),

  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
});
