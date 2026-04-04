import React from 'react';
import { Minus, Square, X } from 'lucide-react';

function TitleBar() {
  const minimize = () => window.uvra?.windowMinimize();
  const maximize = () => window.uvra?.windowMaximize();
  const close = () => window.uvra?.windowClose();

  return (
    <div className="titlebar-drag h-10 bg-uvra-bg border-b border-uvra-border flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-uvra-accent to-purple-400 flex items-center justify-center">
          <span className="text-white text-xs font-bold">U</span>
        </div>
        <span className="text-sm font-semibold text-uvra-text tracking-wide">UVRA Gloves</span>
        <span className="text-xs text-uvra-text-dim ml-2">v1.0</span>
      </div>

      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={minimize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-uvra-border transition-colors"
        >
          <Minus size={14} className="text-uvra-text-dim" />
        </button>
        <button
          onClick={maximize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-uvra-border transition-colors"
        >
          <Square size={12} className="text-uvra-text-dim" />
        </button>
        <button
          onClick={close}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors"
        >
          <X size={14} className="text-uvra-text-dim hover:text-red-400" />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
