const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const UDPServer = require('./udp-server');
const NamedPipeClient = require('./named-pipe-client');
const DriverManager = require('./driver-manager');
const DeviceStore = require('./device-store');
const { discoverDevices, discoverDevicesFromLog, postTrackingReference, setControllerOverride, getDriverSettings, getVRSettingsPath, readPoseOffsets, writePoseOffsets, pushPoseOffsetsToDriver, loadPosePresets, savePosePreset, deletePosePreset } = require('./steamvr-devices');
const { appLogger, rawLogger } = require('./logger');

let mainWindow;
let udpServer;
let leftPipe;
let rightPipe;
let driverManager;
let deviceStore;
let devEmulatorInterval = null;
let isQuitting = false;

const isDev = !app.isPackaged;

function safeSend(channel, data) {
  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      gracefulShutdown();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initServices() {
  leftPipe = new NamedPipeClient('left');
  rightPipe = new NamedPipeClient('right');

  // Handle pipe errors gracefully to prevent unhandled exceptions
  leftPipe.on('error', (err) => {
    console.error('[NamedPipe] Left pipe error:', err.error || err);
    appLogger.error('Left pipe error', { error: err.error || err });
    safeSend('pipe-error', { hand: 'left', error: err.error || err });
  });
  rightPipe.on('error', (err) => {
    console.error('[NamedPipe] Right pipe error:', err.error || err);
    appLogger.error('Right pipe error', { error: err.error || err });
    safeSend('pipe-error', { hand: 'right', error: err.error || err });
  });

  // Forward calibration events to renderer
  for (const pipe of [leftPipe, rightPipe]) {
    pipe.on('calibrationStart', (info) => {
      appLogger.event('Calibration started', info);
      safeSend('calibration-start', info);
    });
    pipe.on('calibrationPhase', (info) => {
      safeSend('calibration-phase', info);
    });
    pipe.on('calibrationEnd', (info) => {
      appLogger.event('Calibration ended', info);
      safeSend('calibration-end', info);
    });
  }

  udpServer = new UDPServer();
  driverManager = new DriverManager();
  deviceStore = new DeviceStore();

  // Forward driver manager events to renderer
  driverManager.on('log', (type, message) => {
    if (type === 'error') appLogger.error(`Driver: ${message}`);
    else appLogger.info(`Driver: ${message}`);
    safeSend('driver-log', { type, message });
  });

  driverManager.on('status', (status) => {
    appLogger.event('Driver status changed', status);
    safeSend('driver-status', status);
  });

  driverManager.on('downloadProgress', (percent) => {
    safeSend('driver-download-progress', percent);
  });

  // Auto-check driver on startup
  driverManager.findSteamVR();
  driverManager.checkInstalled();

  // When a device is discovered via broadcast, notify the renderer
  const _discoveredMacs = new Set();
  udpServer.on('deviceDiscovered', (info) => {
    if (!_discoveredMacs.has(info.mac)) {
      _discoveredMacs.add(info.mac);
      appLogger.event('Device discovered', { mac: info.mac, address: info.address });
    }
    const storedDevice = deviceStore.getDevice(info.mac);
    safeSend('device-discovered', {
      mac: info.mac,
      address: info.address,
      hand: storedDevice ? storedDevice.hand : null,
      name: storedDevice ? storedDevice.name : null,
    });
  });

  udpServer.on('gloveData', (data) => {
    // Log raw sensor data
    rawLogger.logPacket(data.hand, data);

    // If device has a MAC and a stored hand assignment, override the hand from firmware
    if (data.mac) {
      const storedHand = deviceStore.getHand(data.mac);
      if (storedHand) {
        data.hand = storedHand;
      }
      deviceStore.touch(data.mac);
    }

    const pipe = data.hand === 'left' ? leftPipe : rightPipe;

    // Debug heartbeat: one short line every ~50s (500 × 0.1s × ~1 hand).
    if (!pipe._debugCounter) pipe._debugCounter = 0;
    if (pipe._debugCounter++ % 5000 === 0) {
      appLogger.debug(`[${data.hand}] pipe connected=${pipe.connected} calibrating=${pipe.calibrating}`);
    }

    pipe.sendData(data);

    safeSend('glove-data', data);
  });

  udpServer.on('gloveConnected', (info) => {
    appLogger.event('Glove connected', { mac: info.mac, hand: info.hand, address: info.address });
    // If MAC is known, override hand from store
    if (info.mac) {
      const storedHand = deviceStore.getHand(info.mac);
      if (storedHand) {
        info.hand = storedHand;
      }
    }
    safeSend('glove-connected', info);
  });

  udpServer.on('gloveDisconnected', (info) => {
    appLogger.event('Glove disconnected', { hand: info.hand, address: info.address });
    safeSend('glove-disconnected', info);
  });

  udpServer.on('error', (err) => {
    appLogger.error('UDP server error', { error: err.message });
    safeSend('server-error', err.message);
  });

  // Auto-start UDP server on launch
  udpServer.start(7777).then(() => {
    appLogger.info('UDP server auto-started on port 7777');
    safeSend('server-auto-started', { port: 7777 });
  }).catch((err) => {
    appLogger.error('UDP server auto-start failed', { error: err.message });
  });
}

function setupIPC() {
  ipcMain.handle('start-server', async (_, port) => {
    try {
      await udpServer.start(port || 7777);
      appLogger.info('UDP server started', { port: udpServer.port });
      return { success: true, port: udpServer.port };
    } catch (err) {
      appLogger.error('UDP server start failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('stop-server', async () => {
    try {
      udpServer.stop();
      leftPipe.disconnect();
      rightPipe.disconnect();
      appLogger.info('UDP server stopped, pipes disconnected');
      return { success: true };
    } catch (err) {
      appLogger.error('Stop server failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('connect-pipe', async (_, hand) => {
    try {
      const pipe = hand === 'left' ? leftPipe : rightPipe;
      await pipe.connect();
      appLogger.info(`Pipe connected: ${hand}`);
      return { success: true, hand };
    } catch (err) {
      appLogger.error(`Pipe connect failed: ${hand}`, { error: err.message });
      return { success: false, error: err.message, hand };
    }
  });

  ipcMain.handle('disconnect-pipe', async (_, hand) => {
    try {
      const pipe = hand === 'left' ? leftPipe : rightPipe;
      pipe.disconnect();
      appLogger.info(`Pipe disconnected: ${hand}`);
      return { success: true, hand };
    } catch (err) {
      appLogger.error(`Pipe disconnect failed: ${hand}`, { error: err.message });
      return { success: false, error: err.message, hand };
    }
  });

  ipcMain.handle('get-status', () => {
    return {
      serverRunning: udpServer ? udpServer.running : false,
      serverPort: udpServer ? udpServer.port : null,
      leftPipeConnected: leftPipe ? leftPipe.connected : false,
      rightPipeConnected: rightPipe ? rightPipe.connected : false,
      connectedGloves: udpServer ? udpServer.getConnectedGloves() : [],
    };
  });

  ipcMain.handle('calibrate', async (_, { hand, duration }) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (!pipe) return { success: false, error: 'pipe not found' };
    appLogger.event(`Calibration requested: ${hand}`, { duration: duration || 10000 });
    pipe.startCalibration(duration || 10000);
    return { success: true };
  });

  ipcMain.handle('calibrate-cancel', async (_, hand) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (pipe) pipe.cancelCalibration();
    return { success: true };
  });

  ipcMain.handle('calibration-get', (_, hand) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (!pipe) return { success: false };
    return { success: true, calibration: pipe.getCalibration(), calibrating: pipe.calibrating };
  });

  ipcMain.handle('calibration-set', (_, { hand, calibration }) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (!pipe) return { success: false };
    pipe.setCalibration(calibration);
    return { success: true };
  });

  ipcMain.handle('smoothing-set', (_, { hand, alpha }) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (!pipe) return { success: false };
    pipe.setSmoothingAlpha(alpha);
    pipe._saveCalibration();
    return { success: true };
  });

  ipcMain.handle('deadzone-set', (_, { hand, deadzone }) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (!pipe) return { success: false };
    pipe.setDeadzone(deadzone);
    pipe._saveCalibration();
    return { success: true };
  });

  ipcMain.handle('flex-gain-set', (_, { hand, gain }) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (!pipe) return { success: false };
    pipe.setFlexGain(gain);
    pipe._saveCalibration();
    return { success: true, gain: pipe.flexGain };
  });

  ipcMain.handle('one-euro-set', (_, { hand, minCutoff, beta }) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (!pipe) return { success: false };
    pipe.setOneEuroParams(minCutoff, beta);
    pipe._saveCalibration();
    return { success: true };
  });

  // Raw data log controls — off by default to keep disk usage low.
  ipcMain.handle('raw-log-set-enabled', (_, { enabled }) => {
    rawLogger.setEnabled(!!enabled);
    appLogger.info(`Raw data logging ${enabled ? 'enabled' : 'disabled'}`);
    return { success: true, enabled: !!enabled };
  });

  ipcMain.handle('raw-log-set-rate', (_, { everyN }) => {
    rawLogger.setSampleRate(everyN);
    appLogger.info(`Raw data log rate: every ${everyN} packets`);
    return { success: true };
  });

  ipcMain.handle('raw-log-get-status', () => {
    return {
      enabled: rawLogger._enabled,
      everyN: rawLogger._logEveryN,
    };
  });

  // Driver management IPC
  ipcMain.handle('driver-get-status', () => {
    return driverManager ? driverManager.getStatus() : { status: 'unknown' };
  });

  ipcMain.handle('driver-install', async () => {
    try {
      await driverManager.install();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('driver-uninstall', async () => {
    try {
      const result = driverManager.uninstall();
      return { success: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('driver-check', () => {
    driverManager.findSteamVR();
    return {
      installed: driverManager.checkInstalled(),
      ...driverManager.getStatus(),
    };
  });

  // Device store IPC
  ipcMain.handle('device-get-all', () => {
    return deviceStore ? deviceStore.getAllDevices() : {};
  });

  ipcMain.handle('device-set', (_, { mac, hand, name }) => {
    if (deviceStore) {
      deviceStore.setDevice(mac, hand, name);
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('device-remove', (_, mac) => {
    if (deviceStore) {
      deviceStore.removeDevice(mac);
      return { success: true };
    }
    return { success: false };
  });

  // Dev mode emulator — send fake glove data to pipe and UI
  ipcMain.handle('dev-emulator-send', (_, data) => {
    const pipe = data.hand === 'left' ? leftPipe : rightPipe;
    pipe.sendData(data);

    safeSend('glove-data', data);
    return { success: true };
  });

  ipcMain.handle('dev-emulator-start', (_, { hand, fps }) => {
    if (devEmulatorInterval) clearInterval(devEmulatorInterval);

    let t = 0;
    devEmulatorInterval = setInterval(() => {
      t += 0.05;
      const wave = (offset) => (Math.sin(t + offset) + 1) / 2;

      const data = {
        hand,
        flexion: [
          [wave(0), wave(0.2), wave(0.4), wave(0.6)],
          [wave(1), wave(1.2), wave(1.4), wave(1.6)],
          [wave(2), wave(2.2), wave(2.4), wave(2.6)],
          [wave(3), wave(3.2), wave(3.4), wave(3.6)],
          [wave(4), wave(4.2), wave(4.4), wave(4.6)],
        ],
        splay: [wave(0.5), wave(1.5), wave(2.5), wave(3.5), wave(4.5)],
        joyX: Math.sin(t) * 0.5,
        joyY: Math.cos(t) * 0.5,
        joyButton: false,
        trgButton: false,
        aButton: false,
        bButton: false,
        grab: wave(0) > 0.8,
        pinch: wave(1) > 0.8,
        menu: false,
        calibrate: false,
        triggerValue: wave(2),
      };

      const pipe = hand === 'left' ? leftPipe : rightPipe;
      pipe.sendData(data);

      safeSend('glove-data', data);
    }, 1000 / (fps || 30));

    return { success: true };
  });

  ipcMain.handle('dev-emulator-stop', () => {
    if (devEmulatorInterval) {
      clearInterval(devEmulatorInterval);
      devEmulatorInterval = null;
    }
    return { success: true };
  });

  // Tracking reference — discover SteamVR devices from vrserver log
  ipcMain.handle('tracking-get-devices', async () => {
    try {
      const devices = await discoverDevices(appLogger);
      // Also check if the OpenGloves driver is reachable
      const driverSettings = await getDriverSettings();
      return {
        success: true,
        devices,
        driverRunning: driverSettings.success,
        currentOverride: driverSettings.success ? {
          enabled: driverSettings.settings?.pose_settings?.controller_override || false,
          left: driverSettings.settings?.pose_settings?.controller_override_left,
          right: driverSettings.settings?.pose_settings?.controller_override_right,
        } : null,
      };
    } catch (err) {
      return { success: false, devices: [], error: err.message };
    }
  });

  ipcMain.handle('tracking-bind', async (_, { hand, deviceId }) => {
    try {
      appLogger.info(`Tracking bind: hand=${hand}, deviceId=${deviceId}`);
      const role = hand === 'left' ? 1 : 2; // TrackedControllerRole_LeftHand=1, RightHand=2

      // POST to internal server (port 52076) for immediate effect
      const postResult = await postTrackingReference(deviceId, role);
      appLogger.info(`Tracking reference POST result: ${JSON.stringify(postResult)}`);

      return {
        success: postResult.success,
        hand,
        deviceId,
      };
    } catch (err) {
      appLogger.error(`Tracking bind error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Pose offset management
  ipcMain.handle('pose-offsets-get', async () => {
    try {
      const offsets = readPoseOffsets();
      if (!offsets) return { success: false, error: 'vrsettings not found' };
      return { success: true, offsets };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('pose-offsets-set', async (_, offsets) => {
    try {
      const result = await writePoseOffsets(offsets);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Live positioning: push offsets to running driver WITHOUT writing to disk.
  // Used by the "Режим позиционирования" toggle to preview offset changes in
  // real time without persisting them until the user hits "Сохранить".
  ipcMain.handle('pose-offsets-push-live', async (_, offsets) => {
    try {
      const result = await pushPoseOffsetsToDriver(offsets);
      return { success: result.success };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Pose presets
  ipcMain.handle('pose-presets-list', () => {
    return { success: true, presets: loadPosePresets() };
  });

  ipcMain.handle('pose-presets-save', (_, { name, offsets }) => {
    const ok = savePosePreset(name, offsets);
    return { success: ok, presets: ok ? loadPosePresets() : null };
  });

  ipcMain.handle('pose-presets-delete', (_, { name }) => {
    const ok = deletePosePreset(name);
    return { success: ok, presets: ok ? loadPosePresets() : null };
  });

  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow?.close());
}

function gracefulShutdown() {
  if (isQuitting) return;
  isQuitting = true;
  appLogger.info('Graceful shutdown initiated');

  // 1. Stop dev emulator
  if (devEmulatorInterval) {
    clearInterval(devEmulatorInterval);
    devEmulatorInterval = null;
  }

  // 2. Remove all event listeners from services to prevent writes to destroyed window
  if (udpServer) udpServer.removeAllListeners();
  if (leftPipe) leftPipe.removeAllListeners();
  if (rightPipe) rightPipe.removeAllListeners();
  if (driverManager) driverManager.removeAllListeners();

  // 3. Stop UDP server (closes sockets)
  try { if (udpServer) udpServer.stop(); } catch (e) {}

  // 4. Disconnect pipes
  try { if (leftPipe) leftPipe.disconnect(); } catch (e) {}
  try { if (rightPipe) rightPipe.disconnect(); } catch (e) {}

  // 5. Close loggers
  appLogger.info('Graceful shutdown complete');
  appLogger.close();
  rawLogger.close();

  // 6. Destroy window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }

  // 7. Force-kill the process after a short grace period
  //    This guarantees no lingering Node handles keep the process alive
  app.quit();
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

app.whenReady().then(() => {
  appLogger.info('App ready, creating window and initializing services');
  createWindow();
  initServices();
  setupIPC();
});

app.on('before-quit', () => {
  isQuitting = true;
  appLogger.info('App before-quit signal received');
});

app.on('window-all-closed', () => {
  gracefulShutdown();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
