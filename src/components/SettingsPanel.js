import React, { useState } from 'react';
import { Wifi, Save, RotateCcw, Info, Server, Plug } from 'lucide-react';

function SettingsPanel({ serverPort, onPortChange, serverRunning, onStartServer, onStopServer }) {
  const [localPort, setLocalPort] = useState(serverPort);

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
