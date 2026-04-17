import React, { useState, useEffect, useCallback } from 'react';
import { Wifi, Save, Server, Cpu, Trash2, Code, Crosshair, RefreshCw, Move3d, Bookmark } from 'lucide-react';
import DevEmulator from './DevEmulator';

function SettingsPanel({ serverPort, onPortChange, serverRunning, onStartServer, onStopServer, onLog }) {
  const [localPort, setLocalPort] = useState(serverPort);
  const [devices, setDevices] = useState({});
  const [discoveredDevices, setDiscoveredDevices] = useState(new Map());
  const [steamvrDevices, setSteamvrDevices] = useState([]);
  const [selectedLeft, setSelectedLeft] = useState('');
  const [selectedRight, setSelectedRight] = useState('');
  const [bindingStatus, setBindingStatus] = useState({});
  const [driverRunning, setDriverRunning] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [poseOffsets, setPoseOffsets] = useState(null);
  const [savingOffsets, setSavingOffsets] = useState(false);
  const [offsetSaveStatus, setOffsetSaveStatus] = useState(null);
  const [presets, setPresets] = useState({});
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetName, setPresetName] = useState('');
  const [liveMode, setLiveMode] = useState(false);

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

  const loadSteamVRDevices = useCallback(async () => {
    if (!window.uvra) return;
    setLoadingDevices(true);
    try {
      const result = await window.uvra.trackingGetDevices();
      if (result.success) {
        setSteamvrDevices(result.devices || []);
        setDriverRunning(result.driverRunning || false);
        // Pre-select current override values if available
        if (result.currentOverride?.enabled) {
          if (result.currentOverride.left) setSelectedLeft(String(result.currentOverride.left));
          if (result.currentOverride.right) setSelectedRight(String(result.currentOverride.right));
        }
      }
    } catch (err) {
      onLog?.('error', `Ошибка загрузки устройств: ${err.message}`);
    }
    setLoadingDevices(false);
  }, [onLog]);

  // Load SteamVR devices on mount
  useEffect(() => {
    loadSteamVRDevices();
  }, [loadSteamVRDevices]);

  // Load pose offsets and presets on mount
  useEffect(() => {
    if (!window.uvra) return;
    window.uvra.poseOffsetsGet().then((result) => {
      if (result.success) setPoseOffsets(result.offsets);
    });
    window.uvra.posePresetsList().then((result) => {
      if (result.success) setPresets(result.presets || {});
    });
  }, []);

  const handleSelectPreset = (name) => {
    setSelectedPreset(name);
    if (name && presets[name]) {
      setPoseOffsets(JSON.parse(JSON.stringify(presets[name])));
      setPresetName(name);
    }
  };

  const handleSavePreset = async () => {
    if (!window.uvra || !poseOffsets || !presetName.trim()) return;
    const result = await window.uvra.posePresetsSave(presetName.trim(), poseOffsets);
    if (result.success) {
      setPresets(result.presets || {});
      setSelectedPreset(presetName.trim());
      onLog?.('success', `Пресет "${presetName.trim()}" сохранён`);
    }
  };

  const handleDeletePreset = async () => {
    if (!window.uvra || !selectedPreset) return;
    const result = await window.uvra.posePresetsDelete(selectedPreset);
    if (result.success) {
      setPresets(result.presets || {});
      setSelectedPreset('');
      setPresetName('');
      onLog?.('info', `Пресет "${selectedPreset}" удалён`);
    }
  };

  const updateOffset = (hand, group, axis, value) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setPoseOffsets(prev => {
      const next = {
        ...prev,
        [hand]: {
          ...prev[hand],
          [group]: {
            ...prev[hand][group],
            [axis]: num,
          },
        },
      };
      // Live mode: push to running driver immediately (no file write).
      if (liveMode && window.uvra?.poseOffsetsPushLive) {
        window.uvra.poseOffsetsPushLive(next);
      }
      return next;
    });
  };

  const handleSaveOffsets = async () => {
    if (!window.uvra || !poseOffsets) return;
    setSavingOffsets(true);
    setOffsetSaveStatus(null);
    try {
      const result = await window.uvra.poseOffsetsSet(poseOffsets);
      if (result.success) {
        setOffsetSaveStatus({ type: 'success', driverUpdated: result.driverUpdated });
        onLog?.('success', `Оффсеты сохранены${result.driverUpdated ? ' и применены к драйверу' : ' (драйвер не запущен)'}`);
      } else {
        setOffsetSaveStatus({ type: 'error', message: result.error });
        onLog?.('error', `Ошибка сохранения оффсетов: ${result.error}`);
      }
    } catch (err) {
      setOffsetSaveStatus({ type: 'error', message: err.message });
    }
    setSavingOffsets(false);
    setTimeout(() => setOffsetSaveStatus(null), 3000);
  };

  const handleTrackingBind = async (hand) => {
    if (!window.uvra) return;
    const id = parseInt(hand === 'left' ? selectedLeft : selectedRight);
    if (isNaN(id) || id < 0) {
      onLog?.('error', `Выберите устройство для ${hand === 'left' ? 'левой' : 'правой'} руки`);
      return;
    }
    const result = await window.uvra.trackingBind(hand, id);
    if (result.success) {
      setBindingStatus(prev => ({ ...prev, [hand]: id }));
      const methodInfo = result.methods?.internalServer ? 'напрямую' : 'через override';
      onLog?.('success', `${hand === 'left' ? 'Левая' : 'Правая'} рука привязана к устройству #${id} (${methodInfo})`);
    } else {
      onLog?.('error', `Ошибка привязки: ${result.error || 'драйвер не запущен'}`);
    }
  };

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

        </div>

        {/* Tracking Reference */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Crosshair size={16} className="text-uvra-accent" />
              <h2 className="text-sm font-semibold text-uvra-text">Привязка позиции</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${driverRunning ? 'bg-uvra-success/20 text-uvra-success' : 'bg-uvra-text-dim/20 text-uvra-text-dim'}`}>
                {driverRunning ? 'Драйвер активен' : 'Драйвер не найден'}
              </span>
              <button
                onClick={loadSteamVRDevices}
                disabled={loadingDevices}
                className="p-1.5 rounded-lg text-uvra-text-dim hover:text-uvra-accent hover:bg-uvra-accent/10 transition-colors"
                title="Обновить список устройств"
              >
                <RefreshCw size={13} className={loadingDevices ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {steamvrDevices.length === 0 ? (
            <div className="text-xs text-uvra-text-dim p-3 bg-uvra-bg rounded-lg">
              {loadingDevices
                ? 'Загрузка устройств...'
                : 'SteamVR устройства не найдены. Убедитесь что SteamVR запущен и шлем подключён.'}
            </div>
          ) : (
            <div className="space-y-3">
              {['left', 'right'].map((hand) => {
                const bindableDevices = steamvrDevices.filter(d =>
                  d.confirmed && d.type !== 'opengloves'
                );
                const selected = hand === 'left' ? selectedLeft : selectedRight;
                const setSelected = hand === 'left' ? setSelectedLeft : setSelectedRight;

                return (
                  <div key={hand} className="space-y-1.5">
                    <label className="text-xs text-uvra-text-dim">
                      {hand === 'left' ? 'Левая рука' : 'Правая рука'}
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                        className="flex-1 bg-uvra-bg border border-uvra-border rounded-lg px-3 py-2 text-sm text-uvra-text focus:border-uvra-accent focus:outline-none transition-colors appearance-none cursor-pointer"
                      >
                        <option value="">-- Выберите устройство --</option>
                        {bindableDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            #{d.id} — {d.model || d.serial} {d.role ? `(${d.role === 'left_hand' ? 'L' : d.role === 'right_hand' ? 'R' : ''})` : ''} [{d.driver}]
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleTrackingBind(hand)}
                        disabled={!selected}
                        className="px-3 py-2 bg-uvra-accent/20 text-uvra-accent-light rounded-lg text-xs font-medium hover:bg-uvra-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Привязать
                      </button>
                      {bindingStatus[hand] != null && (
                        <span className="text-[10px] text-uvra-success shrink-0">#{bindingStatus[hand]}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pose Offsets */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Move3d size={16} className="text-uvra-accent" />
              <h2 className="text-sm font-semibold text-uvra-text">Оффсеты позиции</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLiveMode(v => !v)}
                disabled={!poseOffsets}
                title="В этом режиме изменения мгновенно применяются к драйверу, но не записываются в файл. Нажмите «Сохранить» для записи."
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  liveMode
                    ? 'bg-uvra-success/20 text-uvra-success ring-1 ring-uvra-success/40 animate-pulse'
                    : 'bg-uvra-border/50 text-uvra-text-dim hover:bg-uvra-border'
                }`}
              >
                {liveMode ? '● Позиционирование: ВКЛ' : '○ Позиционирование'}
              </button>
              {offsetSaveStatus && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  offsetSaveStatus.type === 'success'
                    ? 'bg-uvra-success/20 text-uvra-success'
                    : 'bg-uvra-danger/20 text-uvra-danger'
                }`}>
                  {offsetSaveStatus.type === 'success'
                    ? (offsetSaveStatus.driverUpdated ? 'Применено' : 'Сохранено (перезапустите SteamVR)')
                    : 'Ошибка'}
                </span>
              )}
              <button
                onClick={handleSaveOffsets}
                disabled={!poseOffsets || savingOffsets}
                className="px-3 py-1.5 bg-uvra-accent/20 text-uvra-accent-light rounded-lg text-xs font-medium hover:bg-uvra-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Save size={12} className="inline mr-1" />
                {savingOffsets ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>

          {/* Preset selector */}
          <div className="mb-4 p-3 bg-uvra-bg rounded-lg space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Bookmark size={12} className="text-uvra-accent" />
              <span className="text-[10px] text-uvra-text-dim font-medium">Пресеты</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedPreset}
                onChange={(e) => handleSelectPreset(e.target.value)}
                className="flex-1 bg-uvra-card border border-uvra-border rounded-lg px-2.5 py-1.5 text-xs text-uvra-text focus:border-uvra-accent focus:outline-none transition-colors appearance-none cursor-pointer"
              >
                <option value="">-- Выбрать пресет --</option>
                {Object.keys(presets).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button
                onClick={handleDeletePreset}
                disabled={!selectedPreset}
                className="p-1.5 rounded-lg text-uvra-text-dim hover:text-uvra-danger hover:bg-uvra-danger/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Удалить пресет"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Название пресета..."
                className="flex-1 bg-uvra-card border border-uvra-border rounded-lg px-2.5 py-1.5 text-xs text-uvra-text focus:border-uvra-accent focus:outline-none transition-colors"
              />
              <button
                onClick={handleSavePreset}
                disabled={!poseOffsets || !presetName.trim()}
                className="px-3 py-1.5 bg-uvra-accent/20 text-uvra-accent-light rounded-lg text-[10px] font-medium hover:bg-uvra-accent/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Bookmark size={11} className="inline mr-1" />
                Сохранить пресет
              </button>
            </div>
          </div>

          {!poseOffsets ? (
            <div className="text-xs text-uvra-text-dim p-3 bg-uvra-bg rounded-lg">
              Файл настроек не найден. Убедитесь что драйвер установлен.
            </div>
          ) : (
            <div className="space-y-4">
              {['left', 'right'].map((hand) => (
                <div key={hand}>
                  <div className="text-xs text-uvra-text-dim mb-2 font-medium">
                    {hand === 'left' ? 'Левая рука' : 'Правая рука'}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-[10px] text-uvra-text-dim mb-1">Позиция (м)</div>
                      <div className="grid grid-cols-3 gap-2">
                        {['x', 'y', 'z'].map((axis) => (
                          <div key={axis}>
                            <label className="text-[10px] text-uvra-text-dim uppercase">{axis}</label>
                            <input
                              type="number"
                              step="0.001"
                              value={poseOffsets[hand].pos[axis]}
                              onChange={(e) => updateOffset(hand, 'pos', axis, e.target.value)}
                              className="w-full bg-uvra-bg border border-uvra-border rounded px-2 py-1.5 text-xs text-uvra-text font-mono focus:border-uvra-accent focus:outline-none transition-colors"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-uvra-text-dim mb-1">Вращение (°)</div>
                      <div className="grid grid-cols-3 gap-2">
                        {['x', 'y', 'z'].map((axis) => (
                          <div key={axis}>
                            <label className="text-[10px] text-uvra-text-dim uppercase">{axis}</label>
                            <input
                              type="number"
                              step="1"
                              value={poseOffsets[hand].rot[axis]}
                              onChange={(e) => updateOffset(hand, 'rot', axis, e.target.value)}
                              className="w-full bg-uvra-bg border border-uvra-border rounded px-2 py-1.5 text-xs text-uvra-text font-mono focus:border-uvra-accent focus:outline-none transition-colors"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dev Emulator */}
        <div className="bg-uvra-card rounded-xl border border-uvra-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Code size={16} className="text-uvra-warning" />
            <h2 className="text-sm font-semibold text-uvra-text">Dev Mode — Эмулятор</h2>
          </div>
          <DevEmulator onLog={onLog} />
        </div>

      </div>
    </div>
  );
}

export default SettingsPanel;
