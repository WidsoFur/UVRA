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

    unsubs.push(window.uvra.onServerAutoStarted((info) => {
      setServerRunning(true);
      setServerPort(info.port);
      addLog('info', `Сервер автоматически запущен на порту ${info.port}`);
    }));

    // Poll initial status in case server already started before renderer loaded
    window.uvra.getStatus().then((status) => {
      if (status.serverRunning) {
        setServerRunning(true);
        if (status.serverPort) setServerPort(status.serverPort);
      }
      if (status.leftPipeConnected) setLeftPipeConnected(true);
      if (status.rightPipeConnected) setRightPipeConnected(true);
      if (status.connectedGloves) {
        for (const g of status.connectedGloves) {
          if (g.hand === 'left') setLeftConnected(true);
          else if (g.hand === 'right') setRightConnected(true);
        }
      }
    });

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

  const [calibrating, setCalibrating] = useState({ left: false, right: false });
  const [calibrationModal, setCalibrationModal] = useState(null); // null or 'left'/'right'
  const [calibrationPhase, setCalibrationPhase] = useState(null); // null, 'open', 'close'
  const [calibrationCountdown, setCalibrationCountdown] = useState(0);
  const calibrationIntervalRef = React.useRef(null);

  const handleCalibrate = (hand) => {
    setCalibrationModal(hand);
  };

  const confirmCalibration = async () => {
    const hand = calibrationModal;
    setCalibrationModal(null);
    if (window.uvra && hand) {
      setCalibrating(prev => ({ ...prev, [hand]: true }));
      setCalibrationPhase('open');
      setCalibrationCountdown(5);
      await window.uvra.calibrate(hand, 5000); // 5 сек на фазу
      addLog('info', `Калибровка ${hand === 'left' ? 'левой' : 'правой'} — раскройте ладонь...`);
    }
  };

  const cancelCalibration = () => {
    setCalibrationModal(null);
    setCalibrationPhase(null);
    setCalibrationCountdown(0);
    if (calibrationIntervalRef.current) {
      clearInterval(calibrationIntervalRef.current);
      calibrationIntervalRef.current = null;
    }
  };

  // Countdown timer for calibration phases
  useEffect(() => {
    if (calibrationPhase && calibrationCountdown > 0) {
      calibrationIntervalRef.current = setInterval(() => {
        setCalibrationCountdown(prev => {
          if (prev <= 1) {
            clearInterval(calibrationIntervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(calibrationIntervalRef.current);
    }
  }, [calibrationPhase, calibrationCountdown > 0]);

  useEffect(() => {
    if (!window.uvra) return;
    const unsubs = [];
    unsubs.push(window.uvra.onCalibrationPhase?.((info) => {
      setCalibrationPhase(info.phase);
      setCalibrationCountdown(Math.ceil(info.remaining / 1000));
      if (info.phase === 'close') {
        addLog('info', `Калибровка — теперь сожмите кулак...`);
      }
    }));
    unsubs.push(window.uvra.onCalibrationEnd((info) => {
      setCalibrating(prev => ({ ...prev, [info.hand]: false }));
      setCalibrationPhase(null);
      setCalibrationCountdown(0);
      addLog('success', `Калибровка ${info.hand === 'left' ? 'левой' : 'правой'} завершена`);
    }));
    return () => unsubs.forEach(fn => fn && fn());
  }, [addLog]);

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
                  calibrating={calibrating.left}
                  onConnectPipe={() => handleConnectPipe('left')}
                  onCalibrate={() => handleCalibrate('left')}
                />
                <GlovePanel
                  hand="right"
                  data={rightData}
                  connected={rightConnected}
                  pipeConnected={rightPipeConnected}
                  fps={fps.right}
                  calibrating={calibrating.right}
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

      {/* Calibration confirmation modal */}
      {calibrationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-uvra-card border border-uvra-border rounded-2xl shadow-2xl w-[420px] p-6 mx-4">
            <h3 className="text-base font-semibold text-uvra-text mb-1">
              Калибровка — {calibrationModal === 'left' ? 'левая' : 'правая'} рука
            </h3>
            <p className="text-xs text-uvra-text-dim mb-4">
              Калибровка состоит из двух фаз по 5 секунд:
            </p>

            <div className="space-y-2.5 mb-5">
              <div className="flex items-start gap-3 p-2.5 bg-uvra-bg rounded-lg">
                <span className="text-sm mt-0.5 shrink-0 w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center font-bold text-[10px]">1</span>
                <div>
                  <div className="text-xs font-medium text-uvra-text">Раскройте ладонь (5 сек)</div>
                  <div className="text-[11px] text-uvra-text-dim">Полностью выпрямите все пальцы и держите</div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2.5 bg-uvra-bg rounded-lg">
                <span className="text-sm mt-0.5 shrink-0 w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center font-bold text-[10px]">2</span>
                <div>
                  <div className="text-xs font-medium text-uvra-text">Сожмите кулак (5 сек)</div>
                  <div className="text-[11px] text-uvra-text-dim">Полностью согните все пальцы и держите</div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={cancelCalibration}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-uvra-border/50 text-uvra-text-dim hover:bg-uvra-border transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={confirmCalibration}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-uvra-accent/20 text-uvra-accent-light hover:bg-uvra-accent/30 transition-colors"
              >
                Начать калибровку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calibration phase overlay */}
      {calibrationPhase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <div className={`text-6xl font-bold mb-4 ${calibrationPhase === 'open' ? 'text-green-400' : 'text-orange-400'}`}>
              {calibrationCountdown}
            </div>
            <div className="text-xl font-semibold text-uvra-text mb-2">
              {calibrationPhase === 'open' ? 'Раскройте ладонь' : 'Сожмите кулак'}
            </div>
            <div className="text-sm text-uvra-text-dim">
              {calibrationPhase === 'open'
                ? 'Полностью выпрямите все пальцы и держите'
                : 'Полностью согните все пальцы и держите'
              }
            </div>
            <div className="mt-4 flex justify-center gap-2">
              <div className={`w-3 h-3 rounded-full ${calibrationPhase === 'open' ? 'bg-green-400 animate-pulse' : 'bg-green-400/30'}`} />
              <div className={`w-3 h-3 rounded-full ${calibrationPhase === 'close' ? 'bg-orange-400 animate-pulse' : 'bg-orange-400/30'}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
