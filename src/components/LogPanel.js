import React, { useRef, useEffect } from 'react';
import { Terminal, Trash2 } from 'lucide-react';

const typeColors = {
  success: 'text-uvra-success',
  error: 'text-uvra-danger',
  warning: 'text-uvra-warning',
  info: 'text-uvra-accent-light',
};

const typeBadges = {
  success: 'bg-uvra-success/20 text-uvra-success',
  error: 'bg-uvra-danger/20 text-uvra-danger',
  warning: 'bg-uvra-warning/20 text-uvra-warning',
  info: 'bg-uvra-accent/20 text-uvra-accent-light',
};

function LogPanel({ logs }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs]);

  return (
    <div className="h-36 bg-uvra-card rounded-xl border border-uvra-border flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-uvra-border shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-uvra-accent" />
          <span className="text-xs font-medium text-uvra-text-dim">Журнал событий</span>
        </div>
        <span className="text-[10px] text-uvra-text-dim">{logs.length} записей</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-1">
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-uvra-text-dim">
            Нет событий
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 py-0.5 text-[11px]">
              <span className="text-uvra-text-dim font-mono shrink-0">{log.time}</span>
              <span className={`px-1.5 py-0 rounded text-[9px] font-medium shrink-0 ${typeBadges[log.type]}`}>
                {log.type.toUpperCase()}
              </span>
              <span className={typeColors[log.type]}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LogPanel;
