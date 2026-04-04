import React, { useState, useEffect, useCallback, useRef } from 'react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import GlovePanel from './components/GlovePanel';
import StatusBar from './components/StatusBar';
import SettingsPanel from './components/SettingsPanel';
import LogPanel from './components/LogPanel';
import DriverPanel from './components/DriverPanel';

const defaultGloveData = {
  flexion: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  splay: [0.5, 0.5, 0.5, 0.5, 0.5],
  joyX: 0, joyY: 0,
  joyButton: false, trgButton: false,
  aButton: false, bButton: false,
  grab: false, pinch: false,
  menu: false, calibrate: false,
  triggerValue: 0,
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [serverRunning, setServerRunning] = useState(false);
  const [serverPort, setServerPort] = useState(7777);
  const [leftConnected, setLeftConnected] = useState(false);
  const [rightConnected, setRightConnected] = useState(false);
  const [leftPipeConnected, setLeftPipeConnected] = useState(false);
  const [rightPipeConnected, setRightPipeConnected] = useState(false);
  const [leftData, setLeftData] = useState(defaultGloveData);
  const [rightData, setRightData] = useState(defaultGloveData);
  const [logs, setLogs] = useState([]);
  const [fps, setFps] = useState({ left: 0, right: 0 });

  const fpsCounterRef = useRef({ left: 0, right: 0 });

  const addLog = useCallback((type, message) => {
    const entry = {
      id: Date.now() + Math.random(),
      type,
      message,
      time: new Date().toLocaleTimeString(),
    };
    setLogs(prev => [entry, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    if (!window.uvra) return;

    const unsubs = [];

    unsubs.push(window.uvra.onGloveData((data) => {
      if (data.hand === 'left') {
        setLeftData(data);
        fpsCounterRef.current.left++;
      } else {
        setRightData(data);
        fpsCounterRef.current.right++;
      }
    }));

    unsubs.push(window.uvra.onGloveConnected((info) => {
      if (info.hand === 'left') setLeftConnected(true);
      else setRightConnected(true);
      addLog('success', `${info.hand === 'left' ? 'Левая' : 'Правая'} перчатка подключена (${info.address})`);
    }));

    unsubs.push(window.uvra.onGloveDisconnected((info) => {
      if (info.hand === 'left') setLeftConnected(false);
      else setRightConnected(false);
      addLog('warning', `${info.hand === 'left' ? 'Левая' : 'Правая'} перчатка отключена`);
    }));

    unsubs.push(window.uvra.onServerError((err) => {
      addLog('error', `Ошибка сервера: ${err}`);
    }));

    const fpsInterval = setInterval(() => {
      setFps({
        left: fpsCounterRef.current.left,
        right: fpsCounterRef.current.right,
      });
      fpsCounterRef.current = { left: 0, right: 0 };
    }, 1000);

    return () => {
      unsubs.forEach(fn => fn && fn());
      clearInterval(fpsInterval);
    };
  }, [addLog]);

  const handleStartServer = async () => {
    if (!window.uvra) {
      addLog('info', 'Режим разработки — сервер эмулируется');
      setServerRunning(true);
      return;
    }
    const result = await window.uvra.startServer(serverPort);
    if (result.success) {
      setServerRunning(true);
      addLog('success', `UDP сервер запущен на порту ${result.port}`);
    } else {
      addLog('error', `Не удалось запустить сервер: ${result.error}`);
    }
  };

  const handleStopServer = async () => {
    if (!window.uvra) {
      setServerRunning(false);
      setLeftConnected(false);
      setRightConnected(false);
      return;
    }
    const result = await window.uvra.stopServer();
    if (result.success) {
      setServerRunning(false);
      setLeftConnected(false);
      setRightConnected(false);
      setLeftPipeConnected(false);
      setRightPipeConnected(false);
      addLog('info', 'Сервер остановлен');
    }
  };

  const handleConnectPipe = async (hand) => {
    if (!window.uvra) {
      if (hand === 'left') setLeftPipeConnected(true);
      else setRightPipeConnected(true);
      addLog('info', `OpenGloves pipe (${hand}) — эмуляция`);
      return;
    }
    const result = await window.uvra.connectPipe(hand);
    if (result.success) {
      if (hand === 'left') setLeftPipeConnected(true);
      else setRightPipeConnected(true);
      addLog('success', `OpenGloves pipe (${hand}) подключен`);
    } else {
      addLog('error', `Pipe (${hand}): ${result.error}`);
    }
  };

  const handleCalibrate = async (hand) => {
    if (window.uvra) {
      await window.uvra.calibrate(hand);
    }
    addLog('info', `Калибровка ${hand === 'left' ? 'левой' : 'правой'} перчатки`);
  };

  return (
    <div className="h-screen flex flex-col bg-uvra-bg overflow-hidden">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 overflow-hidden p-4">
          {activeTab === 'dashboard' && (
            <div className="h-full flex flex-col gap-4">
              <div className="flex gap-4 flex-1 min-h-0">
                <GlovePanel
                  hand="left"
                  data={leftData}
                  connected={leftConnected}
                  pipeConnected={leftPipeConnected}
                  fps={fps.left}
                  onConnectPipe={() => handleConnectPipe('left')}
                  onCalibrate={() => handleCalibrate('left')}
                />
                <GlovePanel
                  hand="right"
                  data={rightData}
                  connected={rightConnected}
                  pipeConnected={rightPipeConnected}
                  fps={fps.right}
                  onConnectPipe={() => handleConnectPipe('right')}
                  onCalibrate={() => handleCalibrate('right')}
                />
              </div>
              <LogPanel logs={logs} />
            </div>
          )}

          {activeTab === 'driver' && (
            <DriverPanel onLog={addLog} />
          )}

          {activeTab === 'settings' && (
            <SettingsPanel
              serverPort={serverPort}
              onPortChange={setServerPort}
              serverRunning={serverRunning}
              onStartServer={handleStartServer}
              onStopServer={handleStopServer}
              onLog={addLog}
            />
          )}
        </main>
      </div>

      <StatusBar
        serverRunning={serverRunning}
        serverPort={serverPort}
        leftConnected={leftConnected}
        rightConnected={rightConnected}
        leftPipeConnected={leftPipeConnected}
        rightPipeConnected={rightPipeConnected}
        onStartServer={handleStartServer}
        onStopServer={handleStopServer}
      />
    </div>
  );
}

export default App;
