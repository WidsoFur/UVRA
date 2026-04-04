import React, { useState, useEffect } from 'react';
import { Cpu, Download, CheckCircle, XCircle, AlertTriangle, Loader, Trash2, RefreshCw, FolderOpen } from 'lucide-react';

const STATUS_CONFIG = {
  unknown:   { color: 'text-uvra-text-dim', bg: 'bg-uvra-border/50',    icon: AlertTriangle, label: 'Не проверен' },
  not_found: { color: 'text-uvra-warning',  bg: 'bg-uvra-warning/10',   icon: XCircle,       label: 'Не установлен' },
  installed: { color: 'text-uvra-success',  bg: 'bg-uvra-success/10',   icon: CheckCircle,   label: 'Установлен' },
  configured:{ color: 'text-uvra-success',  bg: 'bg-uvra-success/10',   icon: CheckCircle,   label: 'Установлен и настроен' },
  installing:{ color: 'text-uvra-accent',   bg: 'bg-uvra-accent/10',    icon: Loader,        label: 'Установка...' },
  error:     { color: 'text-uvra-danger',   bg: 'bg-uvra-danger/10',    icon: XCircle,       label: 'Ошибка' },
};

function DriverPanel({ onLog }) {
  const [driverStatus, setDriverStatus] = useState('unknown');
  const [steamVRPath, setSteamVRPath] = useState(null);
  const [driverPath, setDriverPath] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [logs, setLogs] = useState([]);

  const addLog = (type, message) => {
    setLogs(prev => [{ id: Date.now() + Math.random(), type, message, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));
    if (onLog) onLog(type, message);
  };

  useEffect(() => {
    checkDriver();

    if (!window.uvra) return;

    const unsubs = [];
    unsubs.push(window.uvra.onDriverLog(({ type, message }) => {
      addLog(type, message);
    }));
    unsubs.push(window.uvra.onDriverStatus((status) => {
      setDriverStatus(status);
      if (status !== 'installing') setInstalling(false);
    }));
    unsubs.push(window.uvra.onDriverDownloadProgress((percent) => {
      setDownloadProgress(percent);
    }));

    return () => unsubs.forEach(fn => fn && fn());
  }, []);

  const checkDriver = async () => {
    if (!window.uvra) {
      addLog('info', 'Режим разработки — проверка драйвера эмулируется');
      setDriverStatus('not_found');
      return;
    }
    const result = await window.uvra.driverCheck();
    setDriverStatus(result.status);
    setSteamVRPath(result.steamVRPath);
    setDriverPath(result.driverPath);
  };

  const handleInstall = async () => {
    if (!window.uvra) {
      addLog('info', 'Эмуляция установки драйвера');
      setInstalling(true);
      setDriverStatus('installing');
      setTimeout(() => {
        setDriverStatus('configured');
        setInstalling(false);
      }, 2000);
      return;
    }

    setInstalling(true);
    setDriverStatus('installing');
    setDownloadProgress(0);

    const result = await window.uvra.driverInstall();
    if (result.success) {
      setDriverStatus('configured');
      await checkDriver();
    } else {
      setDriverStatus('error');
      addLog('error', result.error);
    }
    setInstalling(false);
  };

  const handleUninstall = async () => {
    if (!window.uvra) return;
    const result = await window.uvra.driverUninstall();
    if (result.success) {
      setDriverStatus('not_found');
      addLog('info', 'Драйвер удалён');
    }
  };

  const cfg = STATUS_CONFIG[driverStatus] || STATUS_CONFIG.unknown;
  const StatusIcon = cfg.icon;

  return (
    <div className="h-full overflow-auto pr-2">
      <h1 className="text-lg font-semibold text-uvra-text mb-6">Драйвер OpenGloves</h1>

      <div className="space-y-5 max-w-2xl">

        {/* Status Card */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${cfg.bg}`}>
              <StatusIcon
                size={22}
                className={`${cfg.color} ${driverStatus === 'installing' ? 'animate-spin' : ''}`}
              />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-uvra-text">OpenGloves SteamVR Driver</h2>
              <p className={`text-xs mt-0.5 ${cfg.color}`}>{cfg.label}</p>
            </div>
            <div className="flex-1" />
            <button
              onClick={checkDriver}
              className="p-2 rounded-lg hover:bg-uvra-border/50 text-uvra-text-dim hover:text-uvra-text transition-all"
              title="Проверить статус"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Paths info */}
          <div className="space-y-2 mb-5">
            <div className="flex items-center gap-2 text-xs">
              <FolderOpen size={12} className="text-uvra-text-dim shrink-0" />
              <span className="text-uvra-text-dim">SteamVR:</span>
              <span className="text-uvra-text font-mono text-[11px] truncate">
                {steamVRPath || 'Не найден'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Cpu size={12} className="text-uvra-text-dim shrink-0" />
              <span className="text-uvra-text-dim">Драйвер:</span>
              <span className="text-uvra-text font-mono text-[11px] truncate">
                {driverPath || '—'}
              </span>
            </div>
          </div>

          {/* Progress bar during installation */}
          {installing && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-uvra-text-dim">Скачивание и установка...</span>
                <span className="text-xs text-uvra-accent font-mono">{downloadProgress}%</span>
              </div>
              <div className="h-2 bg-uvra-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-uvra-accent to-purple-400 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {(driverStatus === 'not_found' || driverStatus === 'error' || driverStatus === 'unknown') && (
              <button
                onClick={handleInstall}
                disabled={installing}
                className={`
                  flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2
                  ${installing
                    ? 'bg-uvra-border text-uvra-text-dim cursor-wait'
                    : 'bg-uvra-accent/20 text-uvra-accent-light hover:bg-uvra-accent/30'
                  }
                `}
              >
                {installing ? (
                  <><Loader size={14} className="animate-spin" /> Установка...</>
                ) : (
                  <><Download size={14} /> Установить автоматически</>
                )}
              </button>
            )}

            {(driverStatus === 'installed' || driverStatus === 'configured') && (
              <>
                <div className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-uvra-success/10 text-uvra-success flex items-center justify-center gap-2">
                  <CheckCircle size={14} /> Драйвер готов к работе
                </div>
                <button
                  onClick={handleUninstall}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium bg-uvra-danger/10 text-uvra-danger hover:bg-uvra-danger/20 transition-all flex items-center gap-2"
                >
                  <Trash2 size={14} /> Удалить
                </button>
              </>
            )}
          </div>
        </div>

        {/* Driver log */}
        {logs.length > 0 && (
          <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
            <h3 className="text-sm font-semibold text-uvra-text mb-3">Лог установки</h3>
            <div className="max-h-40 overflow-auto space-y-1">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 text-[11px]">
                  <span className="text-uvra-text-dim font-mono shrink-0">{log.time}</span>
                  <span className={
                    log.type === 'success' ? 'text-uvra-success' :
                    log.type === 'error' ? 'text-uvra-danger' :
                    log.type === 'warning' ? 'text-uvra-warning' :
                    'text-uvra-accent-light'
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DriverPanel;
