import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Link, LinkIcon, RotateCcw, Activity, Sliders } from 'lucide-react';
import FingerVisualizer from './FingerVisualizer';
import JoystickVisualizer from './JoystickVisualizer';
import ButtonIndicator from './ButtonIndicator';

const FINGER_NAMES = ['Большой', 'Указательный', 'Средний', 'Безымянный', 'Мизинец'];
const FINGER_NAMES_SHORT = ['Б', 'У', 'С', 'Б', 'М'];

function GlovePanel({ hand, data, connected, pipeConnected, fps, calibrating, onConnectPipe, onCalibrate }) {
  const isLeft = hand === 'left';
  const title = isLeft ? 'Левая перчатка' : 'Правая перчатка';
  const [showSettings, setShowSettings] = useState(false);
  const [smoothing, setSmoothing] = useState(0.4);
  const [deadzone, setDeadzone] = useState(0.03);

  // Load calibration settings on mount
  useEffect(() => {
    if (!window.uvra) return;
    window.uvra.calibrationGet(hand).then((result) => {
      if (result.success) {
        setSmoothing(result.calibration.smoothingAlpha);
        setDeadzone(result.calibration.deadzone);
      }
    });
  }, [hand]);

  const handleSmoothingChange = (val) => {
    const alpha = parseFloat(val);
    setSmoothing(alpha);
    if (window.uvra) window.uvra.smoothingSet(hand, alpha);
  };

  const handleDeadzoneChange = (val) => {
    const dz = parseFloat(val);
    setDeadzone(dz);
    if (window.uvra) window.uvra.deadzoneSet(hand, dz);
  };

  const avgCurl = data.flexion
    ? data.flexion.reduce((sum, f) => sum + f.reduce((s, v) => s + v, 0) / f.length, 0) / 5
    : 0;

  return (
    <div className={`
      flex-1 bg-uvra-card rounded-2xl border transition-all duration-300 overflow-hidden flex flex-col
      ${connected ? 'border-uvra-accent/30 glow-accent' : 'border-uvra-border'}
    `}>
      {/* Header */}
      <div className="p-4 border-b border-uvra-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className={`
            w-10 h-10 rounded-xl flex items-center justify-center
            ${connected ? 'bg-uvra-success/20' : 'bg-uvra-border'}
          `}>
            {connected ? (
              <Wifi size={18} className="text-uvra-success" />
            ) : (
              <WifiOff size={18} className="text-uvra-text-dim" />
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-uvra-text">{title}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs ${connected ? 'text-uvra-success' : 'text-uvra-text-dim'}`}>
                {connected ? 'Подключена' : 'Не подключена'}
              </span>
              {connected && (
                <span className="text-xs text-uvra-text-dim flex items-center gap-1">
                  <Activity size={10} /> {fps} Гц
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`p-1.5 rounded-lg text-uvra-text-dim hover:text-uvra-accent hover:bg-uvra-accent/10 transition-colors ${showSettings ? 'bg-uvra-accent/10 text-uvra-accent' : ''}`}
            title="Настройки сглаживания"
          >
            <Sliders size={13} />
          </button>
          <button
            onClick={onCalibrate}
            disabled={!connected || calibrating}
            className={`
              px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${calibrating
                ? 'bg-uvra-warning/20 text-uvra-warning animate-pulse'
                : connected
                  ? 'bg-uvra-border hover:bg-uvra-accent/20 text-uvra-text'
                  : 'bg-uvra-border/50 text-uvra-text-dim cursor-not-allowed'
              }
            `}
          >
            <RotateCcw size={12} className={`inline mr-1 ${calibrating ? 'animate-spin' : ''}`} />
            {calibrating ? 'Калибровка...' : 'Калибровка'}
          </button>
          <button
            onClick={onConnectPipe}
            disabled={!connected}
            className={`
              px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${pipeConnected
                ? 'bg-uvra-success/20 text-uvra-success'
                : connected
                  ? 'bg-uvra-accent/20 hover:bg-uvra-accent/30 text-uvra-accent-light'
                  : 'bg-uvra-border/50 text-uvra-text-dim cursor-not-allowed'
              }
            `}
          >
            <LinkIcon size={12} className="inline mr-1" />
            {pipeConnected ? 'SteamVR ✓' : 'SteamVR'}
          </button>
        </div>
      </div>

      {/* Settings panel (smoothing/deadzone) */}
      {showSettings && connected && (
        <div className="px-4 py-3 border-b border-uvra-border bg-uvra-bg/50 space-y-3 shrink-0">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-uvra-text-dim">Сглаживание (EMA)</span>
              <span className="text-[10px] text-uvra-accent font-mono">{smoothing.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1.0"
              step="0.05"
              value={smoothing}
              onChange={(e) => handleSmoothingChange(e.target.value)}
              className="w-full h-1.5 bg-uvra-border rounded-full appearance-none cursor-pointer accent-uvra-accent"
            />
            <div className="flex justify-between text-[9px] text-uvra-text-dim mt-0.5">
              <span>Плавно</span>
              <span>Быстро</span>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-uvra-text-dim">Мёртвая зона</span>
              <span className="text-[10px] text-uvra-accent font-mono">{(deadzone * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.15"
              step="0.01"
              value={deadzone}
              onChange={(e) => handleDeadzoneChange(e.target.value)}
              className="w-full h-1.5 bg-uvra-border rounded-full appearance-none cursor-pointer accent-uvra-accent"
            />
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 p-4 overflow-auto min-h-0">
        {connected ? (
          <div className="h-full flex flex-col gap-4">
            {/* Finger Bars */}
            <div className="flex-1 min-h-0">
              <div className="text-xs text-uvra-text-dim mb-2 font-medium">Сгибание пальцев</div>
              <div className="flex gap-3 h-[calc(100%-24px)] items-end">
                {data.flexion.map((joints, i) => (
                  <FingerVisualizer
                    key={i}
                    joints={joints}
                    name={FINGER_NAMES[i]}
                    shortName={FINGER_NAMES_SHORT[i]}
                  />
                ))}
              </div>
            </div>

            {/* Bottom row: Joystick + Buttons */}
            <div className="flex gap-4 shrink-0">
              <div className="flex-1">
                <div className="text-xs text-uvra-text-dim mb-2 font-medium">Джойстик</div>
                <JoystickVisualizer x={data.joyX} y={data.joyY} pressed={data.joyButton} />
              </div>
              <div className="flex-1">
                <div className="text-xs text-uvra-text-dim mb-2 font-medium">Кнопки</div>
                <div className="grid grid-cols-4 gap-2">
                  <ButtonIndicator label="A" active={data.aButton} />
                  <ButtonIndicator label="B" active={data.bButton} />
                  <ButtonIndicator label="Grab" active={data.grab} />
                  <ButtonIndicator label="Pinch" active={data.pinch} />
                  <ButtonIndicator label="Trigger" active={data.trgButton} />
                  <ButtonIndicator label="Menu" active={data.menu} />
                  <ButtonIndicator label="Joy" active={data.joyButton} />
                  <ButtonIndicator label="Cal" active={data.calibrate} />
                </div>
              </div>
            </div>

            {/* Trigger Value */}
            <div className="shrink-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-uvra-text-dim font-medium">Триггер</span>
                <span className="text-xs text-uvra-accent font-mono">{(data.triggerValue * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-uvra-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-uvra-accent to-purple-400 rounded-full transition-all duration-100"
                  style={{ width: `${data.triggerValue * 100}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-uvra-border/50 flex items-center justify-center mx-auto mb-4">
                <WifiOff size={24} className="text-uvra-text-dim" />
              </div>
              <p className="text-sm text-uvra-text-dim">Ожидание подключения</p>
              <p className="text-xs text-uvra-text-dim mt-1">
                {isLeft ? 'Левая' : 'Правая'} перчатка не обнаружена
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GlovePanel;
