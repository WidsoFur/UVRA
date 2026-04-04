import React from 'react';
import { Wifi, WifiOff, Link, LinkIcon, RotateCcw, Activity } from 'lucide-react';
import FingerVisualizer from './FingerVisualizer';
import JoystickVisualizer from './JoystickVisualizer';
import ButtonIndicator from './ButtonIndicator';

const FINGER_NAMES = ['Большой', 'Указательный', 'Средний', 'Безымянный', 'Мизинец'];
const FINGER_NAMES_SHORT = ['Б', 'У', 'С', 'Б', 'М'];

function GlovePanel({ hand, data, connected, pipeConnected, fps, onConnectPipe, onCalibrate }) {
  const isLeft = hand === 'left';
  const title = isLeft ? 'Левая перчатка' : 'Правая перчатка';

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
            onClick={onCalibrate}
            disabled={!connected}
            className={`
              px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${connected
                ? 'bg-uvra-border hover:bg-uvra-accent/20 text-uvra-text'
                : 'bg-uvra-border/50 text-uvra-text-dim cursor-not-allowed'
              }
            `}
          >
            <RotateCcw size={12} className="inline mr-1" />
            Калибровка
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
