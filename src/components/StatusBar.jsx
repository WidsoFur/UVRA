import React from 'react';
import { Wifi, WifiOff, Play, Square, Link2, Unlink } from 'lucide-react';

function StatusBar({
  serverRunning, serverPort,
  leftConnected, rightConnected,
  leftPipeConnected, rightPipeConnected,
  onStartServer, onStopServer,
}) {
  return (
    <div className="h-8 bg-uvra-card border-t border-uvra-border flex items-center px-4 gap-4 text-[11px] shrink-0">
      {/* Server status */}
      <button
        onClick={serverRunning ? onStopServer : onStartServer}
        className={`
          flex items-center gap-1.5 px-2 py-0.5 rounded transition-all
          ${serverRunning
            ? 'text-uvra-success hover:bg-uvra-success/10'
            : 'text-uvra-text-dim hover:bg-uvra-border'
          }
        `}
      >
        {serverRunning ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-uvra-success status-pulse" />
            <span>UDP :{serverPort}</span>
            <Square size={10} className="ml-1 opacity-0 group-hover:opacity-100" />
          </>
        ) : (
          <>
            <Play size={10} />
            <span>Запустить сервер</span>
          </>
        )}
      </button>

      <div className="w-px h-4 bg-uvra-border" />

      {/* Left glove */}
      <div className="flex items-center gap-1.5">
        {leftConnected ? (
          <Wifi size={10} className="text-uvra-success" />
        ) : (
          <WifiOff size={10} className="text-uvra-text-dim" />
        )}
        <span className={leftConnected ? 'text-uvra-text' : 'text-uvra-text-dim'}>
          Левая
        </span>
        {leftPipeConnected && (
          <Link2 size={10} className="text-uvra-accent" />
        )}
      </div>

      <div className="w-px h-4 bg-uvra-border" />

      {/* Right glove */}
      <div className="flex items-center gap-1.5">
        {rightConnected ? (
          <Wifi size={10} className="text-uvra-success" />
        ) : (
          <WifiOff size={10} className="text-uvra-text-dim" />
        )}
        <span className={rightConnected ? 'text-uvra-text' : 'text-uvra-text-dim'}>
          Правая
        </span>
        {rightPipeConnected && (
          <Link2 size={10} className="text-uvra-accent" />
        )}
      </div>

      <div className="flex-1" />

      <span className="text-uvra-text-dim">OpenGloves v2</span>
    </div>
  );
}

export default StatusBar;
