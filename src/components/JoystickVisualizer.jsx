import React from 'react';

function JoystickVisualizer({ x, y, pressed }) {
  const dotX = 50 + x * 40;
  const dotY = 50 - y * 40;

  return (
    <div className="relative w-full aspect-square max-w-[100px]">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {/* Background circle */}
        <circle cx="50" cy="50" r="45" fill="none" stroke="#1e1e2e" strokeWidth="2" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="#1e1e2e" strokeWidth="1" strokeDasharray="3 3" />

        {/* Crosshair */}
        <line x1="50" y1="10" x2="50" y2="90" stroke="#1e1e2e" strokeWidth="1" />
        <line x1="10" y1="50" x2="90" y2="50" stroke="#1e1e2e" strokeWidth="1" />

        {/* Position dot */}
        <circle
          cx={dotX}
          cy={dotY}
          r={pressed ? 8 : 6}
          fill={pressed ? '#6c5ce7' : '#a29bfe'}
          opacity={0.9}
        />
        <circle
          cx={dotX}
          cy={dotY}
          r={pressed ? 12 : 10}
          fill="none"
          stroke={pressed ? '#6c5ce7' : '#a29bfe'}
          strokeWidth="1"
          opacity={0.3}
        />
      </svg>

      <div className="absolute bottom-0 left-0 right-0 text-center">
        <span className="text-[9px] text-uvra-text-dim font-mono">
          {x.toFixed(2)}, {y.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export default JoystickVisualizer;
