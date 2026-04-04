import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Square, Hand, RotateCcw } from 'lucide-react';

const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const jointNames = ['MCP', 'PIP', 'DIP', 'Tip'];

function DevEmulator({ onLog }) {
  const [hand, setHand] = useState('left');
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoFps, setAutoFps] = useState(30);
  const [flexion, setFlexion] = useState([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const [splay, setSplay] = useState([0.5, 0.5, 0.5, 0.5, 0.5]);
  const [joyX, setJoyX] = useState(0);
  const [joyY, setJoyY] = useState(0);
  const [buttons, setButtons] = useState({
    joyButton: false,
    trgButton: false,
    aButton: false,
    bButton: false,
    grab: false,
    pinch: false,
    menu: false,
    calibrate: false,
  });
  const [triggerValue, setTriggerValue] = useState(0);

  const buildData = useCallback(() => ({
    hand,
    flexion,
    splay,
    joyX,
    joyY,
    ...buttons,
    triggerValue,
  }), [hand, flexion, splay, joyX, joyY, buttons, triggerValue]);

  const handleSendOnce = async () => {
    if (!window.uvra) return;
    await window.uvra.devEmulatorSend(buildData());
    onLog?.('info', `Dev: отправлен пакет (${hand})`);
  };

  const handleAutoStart = async () => {
    if (!window.uvra) return;
    await window.uvra.devEmulatorStart(hand, autoFps);
    setAutoRunning(true);
    onLog?.('success', `Dev: авто-эмуляция запущена (${hand}, ${autoFps} FPS)`);
  };

  const handleAutoStop = async () => {
    if (!window.uvra) return;
    await window.uvra.devEmulatorStop();
    setAutoRunning(false);
    onLog?.('info', 'Dev: авто-эмуляция остановлена');
  };

  const handleFlexionChange = (finger, joint, value) => {
    setFlexion(prev => {
      const next = prev.map(f => [...f]);
      next[finger][joint] = parseFloat(value);
      return next;
    });
  };

  const handleAllFlexion = (value) => {
    setFlexion(Array(5).fill(null).map(() => Array(4).fill(parseFloat(value))));
  };

  const handleSplayChange = (finger, value) => {
    setSplay(prev => {
      const next = [...prev];
      next[finger] = parseFloat(value);
      return next;
    });
  };

  const toggleButton = (key) => {
    setButtons(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleReset = () => {
    setFlexion(Array(5).fill(null).map(() => Array(4).fill(0)));
    setSplay([0.5, 0.5, 0.5, 0.5, 0.5]);
    setJoyX(0);
    setJoyY(0);
    setTriggerValue(0);
    setButtons({
      joyButton: false, trgButton: false,
      aButton: false, bButton: false,
      grab: false, pinch: false,
      menu: false, calibrate: false,
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (window.uvra) window.uvra.devEmulatorStop();
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          <button
            onClick={() => setHand('left')}
            className={`px-3 py-1.5 rounded-l-lg text-xs font-medium transition-colors ${
              hand === 'left'
                ? 'bg-uvra-accent/30 text-uvra-accent-light'
                : 'bg-uvra-border/50 text-uvra-text-dim hover:bg-uvra-border'
            }`}
          >
            Left
          </button>
          <button
            onClick={() => setHand('right')}
            className={`px-3 py-1.5 rounded-r-lg text-xs font-medium transition-colors ${
              hand === 'right'
                ? 'bg-uvra-accent/30 text-uvra-accent-light'
                : 'bg-uvra-border/50 text-uvra-text-dim hover:bg-uvra-border'
            }`}
          >
            Right
          </button>
        </div>

        <button
          onClick={handleSendOnce}
          className="px-3 py-1.5 bg-uvra-accent/20 text-uvra-accent-light rounded-lg text-xs font-medium hover:bg-uvra-accent/30 transition-colors"
        >
          Send Once
        </button>

        <button
          onClick={handleReset}
          className="px-3 py-1.5 bg-uvra-border/50 text-uvra-text-dim rounded-lg text-xs font-medium hover:bg-uvra-border transition-colors"
        >
          <RotateCcw size={12} className="inline mr-1" />
          Reset
        </button>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-[10px] text-uvra-text-dim">FPS:</label>
          <input
            type="number"
            value={autoFps}
            onChange={(e) => setAutoFps(parseInt(e.target.value) || 30)}
            min={1}
            max={120}
            className="w-14 bg-uvra-bg border border-uvra-border rounded px-2 py-1 text-xs text-uvra-text focus:border-uvra-accent focus:outline-none"
          />
          <button
            onClick={autoRunning ? handleAutoStop : handleAutoStart}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
              autoRunning
                ? 'bg-uvra-danger/20 text-uvra-danger hover:bg-uvra-danger/30'
                : 'bg-uvra-success/20 text-uvra-success hover:bg-uvra-success/30'
            }`}
          >
            {autoRunning ? <Square size={10} /> : <Play size={10} />}
            {autoRunning ? 'Stop' : 'Auto'}
          </button>
        </div>
      </div>

      {/* Flexion Sliders */}
      <div className="bg-uvra-bg rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-uvra-text font-medium">Flexion</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-uvra-text-dim">All:</span>
            <input
              type="range"
              min="0" max="1" step="0.01"
              defaultValue="0"
              onChange={(e) => handleAllFlexion(e.target.value)}
              className="w-20 h-1 accent-uvra-accent"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          {fingerNames.map((name, fi) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-[10px] text-uvra-text-dim w-12 shrink-0">{name}</span>
              {jointNames.map((jn, ji) => (
                <div key={ji} className="flex-1 flex items-center gap-1">
                  <input
                    type="range"
                    min="0" max="1" step="0.01"
                    value={flexion[fi][ji]}
                    onChange={(e) => handleFlexionChange(fi, ji, e.target.value)}
                    className="w-full h-1 accent-uvra-accent"
                  />
                  <span className="text-[9px] text-uvra-text-dim w-6 text-right">{flexion[fi][ji].toFixed(1)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Splay Sliders */}
      <div className="bg-uvra-bg rounded-lg p-3">
        <span className="text-[11px] text-uvra-text font-medium block mb-2">Splay</span>
        <div className="space-y-1.5">
          {fingerNames.map((name, i) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-[10px] text-uvra-text-dim w-12 shrink-0">{name}</span>
              <input
                type="range"
                min="0" max="1" step="0.01"
                value={splay[i]}
                onChange={(e) => handleSplayChange(i, e.target.value)}
                className="flex-1 h-1 accent-uvra-accent"
              />
              <span className="text-[9px] text-uvra-text-dim w-6 text-right">{splay[i].toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Joystick & Trigger */}
      <div className="flex gap-3">
        <div className="flex-1 bg-uvra-bg rounded-lg p-3">
          <span className="text-[11px] text-uvra-text font-medium block mb-2">Joystick</span>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-uvra-text-dim w-5">X</span>
              <input
                type="range" min="-1" max="1" step="0.01"
                value={joyX}
                onChange={(e) => setJoyX(parseFloat(e.target.value))}
                className="flex-1 h-1 accent-uvra-accent"
              />
              <span className="text-[9px] text-uvra-text-dim w-8 text-right">{joyX.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-uvra-text-dim w-5">Y</span>
              <input
                type="range" min="-1" max="1" step="0.01"
                value={joyY}
                onChange={(e) => setJoyY(parseFloat(e.target.value))}
                className="flex-1 h-1 accent-uvra-accent"
              />
              <span className="text-[9px] text-uvra-text-dim w-8 text-right">{joyY.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-uvra-bg rounded-lg p-3">
          <span className="text-[11px] text-uvra-text font-medium block mb-2">Trigger</span>
          <div className="flex items-center gap-2">
            <input
              type="range" min="0" max="1" step="0.01"
              value={triggerValue}
              onChange={(e) => setTriggerValue(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-uvra-accent"
            />
            <span className="text-[9px] text-uvra-text-dim w-8 text-right">{(triggerValue * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="bg-uvra-bg rounded-lg p-3">
        <span className="text-[11px] text-uvra-text font-medium block mb-2">Buttons</span>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(buttons).map(([key, val]) => (
            <button
              key={key}
              onClick={() => toggleButton(key)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                val
                  ? 'bg-uvra-accent/30 text-uvra-accent-light'
                  : 'bg-uvra-border/50 text-uvra-text-dim hover:bg-uvra-border'
              }`}
            >
              {key.replace('Button', '')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DevEmulator;
