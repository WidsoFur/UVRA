import React, { useState, useEffect, useCallback } from 'react';
import { Wifi, Save, RotateCcw, Info, Server, Plug, Cpu, Trash2, Hand } from 'lucide-react';

function SettingsPanel({ serverPort, onPortChange, serverRunning, onStartServer, onStopServer }) {
  const [localPort, setLocalPort] = useState(serverPort);
  const [devices, setDevices] = useState({});
  const [discoveredDevices, setDiscoveredDevices] = useState(new Map());

  // Load saved devices on mount
  useEffect(() => {
    if (!window.uvra) return;
    window.uvra.deviceGetAll().then(setDevices);
  }, []);

  // Listen for newly discovered devices
  useEffect(() => {
    if (!window.uvra) return;
    const unsub = window.uvra.onDeviceDiscovered((info) => {
      setDiscoveredDevices(prev => {
        const next = new Map(prev);
        next.set(info.mac, info);
        return next;
      });
    });
    return () => unsub && unsub();
  }, []);

  const handleAssignHand = async (mac, hand) => {
    if (!window.uvra) return;
    const existing = devices[mac];
    await window.uvra.deviceSet(mac, hand, existing?.name || mac);
    const updated = await window.uvra.deviceGetAll();
    setDevices(updated);
  };

  const handleRenameDevice = async (mac, name) => {
    if (!window.uvra) return;
    const existing = devices[mac];
    if (!existing) return;
    await window.uvra.deviceSet(mac, existing.hand, name);
    const updated = await window.uvra.deviceGetAll();
    setDevices(updated);
  };

  const handleRemoveDevice = async (mac) => {
    if (!window.uvra) return;
    await window.uvra.deviceRemove(mac);
    const updated = await window.uvra.deviceGetAll();
    setDevices(updated);
  };

  // Merge saved + discovered devices for display
  const allMacs = new Set([
    ...Object.keys(devices),
    ...discoveredDevices.keys(),
  ]);

  const handleSave = () => {
    const port = parseInt(localPort);
    if (port >= 1024 && port <= 65535) {
      onPortChange(port);
    }
  };

  return (
    <div className="h-full overflow-auto pr-2">
      <h1 className="text-lg font-semibold text-uvra-text mb-6">Настройки</h1>

      <div className="space-y-6 max-w-2xl">
        {/* Network Settings */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server size={16} className="text-uvra-accent" />
            <h2 className="text-sm font-semibold text-uvra-text">Сеть</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-uvra-text-dim mb-1.5">UDP Порт</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={localPort}
                  onChange={(e) => setLocalPort(e.target.value)}
                  min={1024}
                  max={65535}
                  className="flex-1 bg-uvra-bg border border-uvra-border rounded-lg px-3 py-2 text-sm text-uvra-text focus:border-uvra-accent focus:outline-none transition-colors"
                />
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-uvra-accent/20 text-uvra-accent-light rounded-lg text-sm font-medium hover:bg-uvra-accent/30 transition-colors"
                >
                  <Save size={14} className="inline mr-1" />
                  Сохранить
                </button>
              </div>
              <p className="text-[11px] text-uvra-text-dim mt-1">
                Порт для приёма данных от перчаток по WiFi (1024-65535)
              </p>
            </div>

            <div>
              <label className="block text-xs text-uvra-text-dim mb-1.5">Статус сервера</label>
              <button
                onClick={serverRunning ? onStopServer : onStartServer}
                className={`
                  w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2
                  ${serverRunning
                    ? 'bg-uvra-danger/20 text-uvra-danger hover:bg-uvra-danger/30'
                    : 'bg-uvra-success/20 text-uvra-success hover:bg-uvra-success/30'
                  }
                `}
              >
                <Wifi size={14} />
                {serverRunning ? 'Остановить сервер' : 'Запустить сервер'}
              </button>
            </div>
          </div>
        </div>

        {/* Device Management */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Cpu size={16} className="text-uvra-accent" />
            <h2 className="text-sm font-semibold text-uvra-text">Устройства</h2>
          </div>

          {allMacs.size === 0 ? (
            <div className="text-xs text-uvra-text-dim p-3 bg-uvra-bg rounded-lg">
              Устройства не обнаружены. Запустите сервер и включите перчатку — она найдётся автоматически.
            </div>
          ) : (
            <div className="space-y-2">
              {[...allMacs].map(mac => {
                const saved = devices[mac];
                const discovered = discoveredDevices.get(mac);
                const isOnline = !!discovered;
                const hand = saved?.hand || discovered?.hand || null;
                const name = saved?.name || mac;

                return (
                  <div key={mac} className="p-3 bg-uvra-bg rounded-lg flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-uvra-success' : 'bg-uvra-text-dim'}`} />

                    <div className="flex-1 min-w-0">
                      <input
                        className="text-xs font-medium text-uvra-text bg-transparent border-b border-transparent hover:border-uvra-border focus:border-uvra-accent outline-none w-full truncate"
                        value={name}
                        onChange={(e) => {
                          // Update local state immediately
                          setDevices(prev => ({
                            ...prev,
                            [mac]: { ...prev[mac], name: e.target.value, hand: hand || 'left' },
                          }));
                        }}
                        onBlur={(e) => handleRenameDevice(mac, e.target.value)}
                      />
                      <div className="text-[10px] text-uvra-text-dim font-mono mt-0.5">
                        {mac}
                        {discovered?.address && <span className="ml-2">{discovered.address}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleAssignHand(mac, 'left')}
                        className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                          hand === 'left'
                            ? 'bg-uvra-accent/30 text-uvra-accent-light'
                            : 'bg-uvra-border/50 text-uvra-text-dim hover:bg-uvra-border'
                        }`}
                      >
                        L
                      </button>
                      <button
                        onClick={() => handleAssignHand(mac, 'right')}
                        className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                          hand === 'right'
                            ? 'bg-uvra-accent/30 text-uvra-accent-light'
                            : 'bg-uvra-border/50 text-uvra-text-dim hover:bg-uvra-border'
                        }`}
                      >
                        R
                      </button>
                      <button
                        onClick={() => handleRemoveDevice(mac)}
                        className="p-1 rounded text-uvra-text-dim hover:text-uvra-danger hover:bg-uvra-danger/10 transition-colors ml-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-uvra-text-dim mt-3">
            Перчатки находятся автоматически по UDP broadcast. Назначьте руку (L/R) для каждого устройства —
            привязка сохраняется по MAC-адресу.
          </p>
        </div>

        {/* OpenGloves Settings */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Plug size={16} className="text-uvra-accent" />
            <h2 className="text-sm font-semibold text-uvra-text">OpenGloves</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-uvra-bg rounded-lg">
              <Info size={14} className="text-uvra-accent mt-0.5 shrink-0" />
              <div className="text-xs text-uvra-text-dim leading-relaxed">
                <p className="mb-2">
                  Для работы необходим установленный драйвер <strong className="text-uvra-text">OpenGloves</strong> из Steam.
                </p>
                <p className="mb-2">
                  Программа подключается к драйверу через Named Pipes (v2 протокол) и передаёт данные о сгибании пальцев,
                  положении джойстика и состоянии кнопок.
                </p>
                <p>
                  <strong className="text-uvra-text">Pipe путь:</strong><br />
                  <code className="text-uvra-accent text-[10px]">\\.\pipe\vrapplication\input\glove\v2\left|right</code>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* WiFi Protocol Info */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Info size={16} className="text-uvra-accent" />
            <h2 className="text-sm font-semibold text-uvra-text">Протокол WiFi</h2>
          </div>

          <div className="text-xs text-uvra-text-dim leading-relaxed space-y-3">
            <p>Программа принимает данные по UDP в нескольких форматах:</p>

            <div className="p-3 bg-uvra-bg rounded-lg">
              <p className="text-uvra-text font-medium mb-1">JSON формат (рекомендуется)</p>
              <pre className="text-[10px] text-uvra-accent overflow-x-auto whitespace-pre">
{`{
  "hand": "left",
  "fingers": {
    "thumb":  [0.0, 0.2, 0.3, 0.0],
    "index":  [0.0, 0.5, 0.6, 0.4],
    "middle": [0.0, 0.7, 0.8, 0.6],
    "ring":   [0.0, 0.3, 0.4, 0.2],
    "pinky":  [0.0, 0.1, 0.2, 0.1]
  },
  "splay": [0.5, 0.5, 0.5, 0.5, 0.5],
  "joystick": { "x": 0.0, "y": 0.0 },
  "buttons": {
    "trigger": false, "A": false,
    "B": false, "grab": false
  },
  "triggerValue": 0.0
}`}
              </pre>
            </div>

            <div className="p-3 bg-uvra-bg rounded-lg">
              <p className="text-uvra-text font-medium mb-1">Простой строковый формат</p>
              <pre className="text-[10px] text-uvra-accent">
{`hand:left,max:4095,A:2048,B:1024,C:512,D:3000,E:100`}
              </pre>
            </div>

            <div className="p-3 bg-uvra-bg rounded-lg">
              <p className="text-uvra-text font-medium mb-1">Бинарный формат (114 байт)</p>
              <p className="text-[10px]">
                1 байт (hand) + 80 байт (flexion) + 20 байт (splay) + 8 байт (joy) + 1 байт (buttons) + 4 байт (trigger)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
