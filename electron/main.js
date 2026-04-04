const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const UDPServer = require('./udp-server');
const NamedPipeClient = require('./named-pipe-client');
const DriverManager = require('./driver-manager');

let mainWindow;
let udpServer;
let leftPipe;
let rightPipe;
let driverManager;

const isDev = !app.isPackaged;

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initServices() {
  leftPipe = new NamedPipeClient('left');
  rightPipe = new NamedPipeClient('right');
  udpServer = new UDPServer();
  driverManager = new DriverManager();

  // Forward driver manager events to renderer
  driverManager.on('log', (type, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('driver-log', { type, message });
    }
  });

  driverManager.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('driver-status', status);
    }
  });

  driverManager.on('downloadProgress', (percent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('driver-download-progress', percent);
    }
  });

  // Auto-check driver on startup
  driverManager.findSteamVR();
  driverManager.checkInstalled();

  udpServer.on('gloveData', (data) => {
    const pipe = data.hand === 'left' ? leftPipe : rightPipe;
    pipe.sendData(data);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('glove-data', data);
    }
  });

  udpServer.on('gloveConnected', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('glove-connected', info);
    }
  });

  udpServer.on('gloveDisconnected', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('glove-disconnected', info);
    }
  });

  udpServer.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-error', err.message);
    }
  });
}

function setupIPC() {
  ipcMain.handle('start-server', async (_, port) => {
    try {
      await udpServer.start(port || 7777);
      return { success: true, port: udpServer.port };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('stop-server', async () => {
    try {
      udpServer.stop();
      leftPipe.disconnect();
      rightPipe.disconnect();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('connect-pipe', async (_, hand) => {
    try {
      const pipe = hand === 'left' ? leftPipe : rightPipe;
      await pipe.connect();
      return { success: true, hand };
    } catch (err) {
      return { success: false, error: err.message, hand };
    }
  });

  ipcMain.handle('disconnect-pipe', async (_, hand) => {
    try {
      const pipe = hand === 'left' ? leftPipe : rightPipe;
      pipe.disconnect();
      return { success: true, hand };
    } catch (err) {
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

  ipcMain.handle('calibrate', async (_, hand) => {
    const pipe = hand === 'left' ? leftPipe : rightPipe;
    if (pipe) {
      pipe.calibrate();
    }
    return { success: true };
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

app.whenReady().then(() => {
  createWindow();
  initServices();
  setupIPC();
});

app.on('window-all-closed', () => {
  if (udpServer) udpServer.stop();
  if (leftPipe) leftPipe.disconnect();
  if (rightPipe) rightPipe.disconnect();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
