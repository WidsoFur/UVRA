const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * Discovers SteamVR tracked devices via the driver's HTTP API (GET /devices on port 52075).
 * This is the preferred method — works reliably as long as the driver is loaded.
 * Returns array of { id, serial, type, model, manufacturer, role, connected }
 */
function discoverDevicesFromAPI(logger) {
  const log = logger || { info() {}, warn() {}, error() {} };

  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: 52075,
      path: '/devices',
      timeout: 3000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const devices = JSON.parse(data);
          log.info(`API: получено ${devices.length} устройств`);
          // Add confirmed=true and filter out our own opengloves devices
          const result = devices.map(d => ({
            ...d,
            confirmed: d.connected,
            driver: d.manufacturer || 'unknown',
          })).filter(d => {
            // Skip our own UVRA/opengloves devices
            const isOurs = (d.serial || '').startsWith('UVRA-') || (d.manufacturer || '').toLowerCase() === 'uvra';
            if (isOurs) log.info(`  Пропускаю своё устройство: ${d.serial}`);
            return !isOurs;
          });
          for (const d of result) {
            log.info(`  [${d.id}] ${d.serial} | type=${d.type} model=${d.model} role=${d.role} connected=${d.connected}`);
          }
          resolve(result);
        } catch (e) {
          log.error(`API: ошибка парсинга ответа: ${e.message}`);
          resolve(null);
        }
      });
    });
    req.on('error', (err) => {
      log.warn(`API: драйвер не отвечает (${err.message}), fallback на лог`);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      log.warn('API: таймаут, fallback на лог');
      resolve(null);
    });
  });
}

/**
 * Main discovery function: tries API first, falls back to log parsing.
 */
async function discoverDevices(logger) {
  const log = logger || { info() {}, warn() {}, error() {} };

  // Try API first
  const apiResult = await discoverDevicesFromAPI(log);
  if (apiResult && apiResult.length > 0) {
    log.info('Устройства получены через API драйвера');
    return apiResult;
  }

  // Fallback to log parsing
  log.info('Fallback: парсинг vrserver.txt');
  return discoverDevicesFromLog(log);
}

/**
 * Discovers SteamVR tracked devices by parsing vrserver.txt log.
 * FALLBACK method — used when driver API is not available.
 * Returns array of { id, serial, driver, type, model, manufacturer, role }
 */
function discoverDevicesFromLog(logger) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const logPath = getSteamVRLogPath(log);
  if (!logPath || !fs.existsSync(logPath)) {
    log.warn('vrserver.txt не найден — невозможно обнаружить устройства');
    return [];
  }
  log.info(`Читаю лог SteamVR: ${logPath}`);

  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');

  // Track device activations in order — the activation index = device ID
  // Device 0 is always HMD. IDs are assigned sequentially as devices activate.
  const devices = [];
  const activationOrder = []; // serial numbers in activation order

  // Pass 1: Find all device activations and their serial numbers
  for (const line of lines) {
    // Pattern: Driver 'driverName' started activation of tracked device with serial number 'SERIAL'
    const activationMatch = line.match(
      /Driver '(\w+)' started activation of tracked device with serial number '([^']+)'/
    );
    if (activationMatch) {
      const driver = activationMatch[1];
      const serial = activationMatch[2];
      // Check if this serial already exists (duplicates in log)
      if (!activationOrder.find(d => d.serial === serial)) {
        activationOrder.push({ serial, driver });
      }
    }
  }

  // Pass 2: Extract properties for each device
  for (let i = 0; i < activationOrder.length; i++) {
    const { serial, driver } = activationOrder[i];
    const device = {
      id: i,
      serial,
      driver,
      type: 'unknown',
      model: '',
      manufacturer: '',
      role: null, // 'left_hand', 'right_hand', 'hmd', or null
    };

    // Determine device type from context in log
    // Look for properties set right after activation
    let foundActivation = false;
    for (const line of lines) {
      if (line.includes(`started activation of tracked device with serial number '${serial}'`)) {
        foundActivation = true;
        continue;
      }
      if (foundActivation) {
        // Stop at next activation or after a reasonable window
        if (line.includes('started activation of tracked device') && !line.includes(serial)) {
          break;
        }
        if (line.includes('finished adding tracked device') && !line.includes(serial)) {
          break;
        }

        // Extract manufacturer
        const mfgMatch = line.match(/ManufacturerName\s+(.+)/);
        if (mfgMatch) device.manufacturer = mfgMatch[1].trim();

        // Extract model
        const modelMatch = line.match(/ModelNumber\s+(.+)/);
        if (modelMatch) device.model = modelMatch[1].trim();

        // Detect controller activation with index
        const controllerIdxMatch = line.match(/Activating controller on TrackedDeviceIndex_t (\d+)/);
        if (controllerIdxMatch) device.id = parseInt(controllerIdxMatch[1]);
      }
    }

    // Classify type and role (case-insensitive)
    const serialLower = serial.toLowerCase();
    const modelLower = device.model.toLowerCase();

    if (serialLower.includes('hmd') || serialLower.includes('headset') || modelLower.includes('quest')) {
      device.type = 'hmd';
    }

    if (serialLower.includes('controller') || modelLower.includes('controller')) {
      device.type = 'controller';
    }

    // Detect hand from serial or model
    const serialAndModel = (serial + ' ' + device.model).toLowerCase();
    if (serialAndModel.includes('left')) {
      device.role = 'left_hand';
    } else if (serialAndModel.includes('right')) {
      device.role = 'right_hand';
    }

    // Lighthouse base stations (LHB-*) vs trackers (LHR-*)
    if (serialLower.startsWith('lhb-')) {
      device.type = 'base_station';
    } else if (serialLower.startsWith('lhr-')) {
      device.type = 'tracker';
    }

    // Skip OpenGloves own devices
    if (driver === 'opengloves') {
      device.type = 'opengloves';
    }

    // Classify standable/slimevr as trackers
    if (driver === 'standable' || driver === 'slimevr') {
      device.type = 'tracker';
    }

    devices.push(device);
  }

  // Look for "finished adding tracked device" to mark confirmed devices
  const confirmedSerials = new Set();
  for (const line of lines) {
    const finishMatch = line.match(/finished adding tracked device with serial number '([^']+)'/);
    if (finishMatch) {
      confirmedSerials.add(finishMatch[1]);
    }
  }

  // Assign sequential IDs to all activated devices (not just confirmed ones)
  // SteamVR assigns IDs in activation order; devices that started activation
  // are valid even without "finished adding" in the log
  let nextId = 0;
  for (const device of devices) {
    device.id = nextId++;
    device.confirmed = confirmedSerials.has(device.serial) || true;
  }

  log.info(`Найдено устройств: ${devices.length} (подтверждённых: ${confirmedSerials.size})`);
  for (const d of devices) {
    log.info(`  [${d.id}] ${d.serial} | driver=${d.driver} type=${d.type} role=${d.role} confirmed=${d.confirmed}`);
  }

  return devices;
}

/**
 * Get SteamVR vrserver.txt log path
 */
function getSteamVRLogPath(logger) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const os = require('os');
  const candidates = [];

  // 1. Try to find Steam path via openvrpaths.vrpath (most reliable)
  const vrpathFile = path.join(os.homedir(), 'AppData', 'Local', 'openvr', 'openvrpaths.vrpath');
  log.info(`Проверяю openvrpaths: ${vrpathFile} (exists: ${fs.existsSync(vrpathFile)})`);

  try {
    if (fs.existsSync(vrpathFile)) {
      const text = fs.readFileSync(vrpathFile, 'utf8').replace(/^\uFEFF/, '');
      const data = JSON.parse(text);
      log.info(`openvrpaths содержимое: ${JSON.stringify(data, null, 2)}`);

      // runtime paths point to SteamVR, Steam logs are two levels up
      if (data.runtime) {
        for (const runtimePath of data.runtime) {
          const normalized = runtimePath.replace(/\\\\/g, '\\').replace(/\//g, '\\');
          const steamRoot = path.resolve(normalized, '..', '..', '..', '..');
          const candidate = path.join(steamRoot, 'logs', 'vrserver.txt');
          log.info(`runtime → steamRoot: ${steamRoot} → candidate: ${candidate}`);
          candidates.push(candidate);
        }
      }
      // log paths directly from openvrpaths
      if (data.log) {
        for (const logDir of data.log) {
          const normalized = logDir.replace(/\\\\/g, '\\').replace(/\//g, '\\');
          const candidate = path.join(normalized, 'vrserver.txt');
          log.info(`log dir → candidate: ${candidate}`);
          candidates.push(candidate);
        }
      }
    }
  } catch (e) {
    log.error(`Ошибка чтения openvrpaths: ${e.message}`);
  }

  // 2. Common hardcoded paths as fallback
  candidates.push(
    path.join('C:', 'Program Files (x86)', 'Steam', 'logs', 'vrserver.txt'),
    path.join('D:', 'Program Files (x86)', 'Steam', 'logs', 'vrserver.txt'),
    path.join('D:', 'Steam', 'logs', 'vrserver.txt'),
    path.join(os.homedir(), 'Steam', 'logs', 'vrserver.txt'),
  );

  log.info(`Всего кандидатов: ${candidates.length}`);
  for (const p of candidates) {
    const exists = fs.existsSync(p);
    log.info(`  ${exists ? '✓' : '✗'} ${p}`);
    if (exists) return p;
  }

  log.warn('vrserver.txt не найден ни по одному из путей');
  return null;
}

/**
 * POST tracking reference to the OpenGloves internal server (port 52076).
 * Returns true if successful.
 */
function postTrackingReference(deviceId, role) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ openvr_id: deviceId, openvr_role: role });

    const req = http.request({
      hostname: '127.0.0.1',
      port: 52076,
      path: '/tracking_reference',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ success: res.statusCode === 200, body: data }));
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
    req.write(postData);
    req.end();
  });
}

/**
 * Set controller_override settings via the OpenGloves external server (port 52075).
 * This is a persistent fallback — survives SteamVR restarts.
 */
function setControllerOverride(leftId, rightId) {
  return new Promise((resolve) => {
    const settings = {
      pose_settings: {
        controller_override: true,
        controller_override_left: leftId,
        controller_override_right: rightId,
      }
    };
    const postData = JSON.stringify(settings);

    const req = http.request({
      hostname: '127.0.0.1',
      port: 52075,
      path: '/settings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ success: res.statusCode === 200, body: data }));
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
    req.write(postData);
    req.end();
  });
}

/**
 * Get current OpenGloves driver settings from the external server (port 52075).
 */
function getDriverSettings() {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: 52075,
      path: '/settings',
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ success: true, settings: JSON.parse(data) });
        } catch (e) {
          resolve({ success: false, error: 'invalid json' });
        }
      });
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
  });
}

/**
 * Path to the OpenGloves default.vrsettings file.
 */
/**
 * Quick probe: is the OpenGloves driver currently loaded by SteamVR?
 * Detected by whether its HTTP control server on 52075 responds.
 * Used to decide whether writing to default.vrsettings is safe — SteamVR
 * reacts badly to the settings file being rewritten while it has the
 * driver loaded (can hang / crash vrserver).
 */
function isDriverRunning(timeoutMs = 400) {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: 52075,
      path: '/devices',
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Project-local data directory — always user-writable. Used as the primary
 * store for pose offsets and presets so saving never fails even when the
 * driver's default.vrsettings is in Program Files (admin-only).
 */
function getLocalDataDir() {
  const dir = path.join(__dirname, '..', 'data');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) { /* caller will handle */ }
  return dir;
}

function getLocalOffsetsPath() {
  return path.join(getLocalDataDir(), 'pose_offsets.json');
}

function getLocalPresetsPath() {
  return path.join(getLocalDataDir(), 'pose_presets.json');
}

function getVRSettingsPath() {
  const candidates = [];

  // 1) Driver roots registered in openvrpaths.vrpath (external_drivers)
  try {
    const vrpath = path.join(process.env.LOCALAPPDATA || '', 'openvr', 'openvrpaths.vrpath');
    if (fs.existsSync(vrpath)) {
      const vp = JSON.parse(fs.readFileSync(vrpath, 'utf8'));

      if (Array.isArray(vp.external_drivers)) {
        for (const ext of vp.external_drivers) {
          if (ext) candidates.push(path.join(ext, 'resources', 'settings', 'default.vrsettings'));
        }
      }

      // 2) SteamVR runtime drivers/opengloves
      if (Array.isArray(vp.runtime)) {
        for (const rt of vp.runtime) {
          if (rt) candidates.push(path.join(rt, 'drivers', 'opengloves', 'resources', 'settings', 'default.vrsettings'));
        }
      }

      // 3) Steam's own install tree near logs[0]
      if (Array.isArray(vp.log)) {
        for (const lg of vp.log) {
          if (!lg) continue;
          const steamRoot = path.dirname(lg);
          candidates.push(path.join(steamRoot, 'steamapps', 'common', 'SteamVR', 'drivers', 'opengloves', 'resources', 'settings', 'default.vrsettings'));
        }
      }
    }
  } catch (e) {
    // fall through to static fallbacks
  }

  // 4) Common install paths
  const commonRoots = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'E:\\Steam',
  ];
  for (const root of commonRoots) {
    candidates.push(path.join(root, 'steamapps', 'common', 'SteamVR', 'drivers', 'opengloves', 'resources', 'settings', 'default.vrsettings'));
  }

  // 5) Project-local fallback (dev / bundled copy)
  candidates.push(path.join(__dirname, '..', 'opengloves', 'resources', 'settings', 'default.vrsettings'));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log(`[pose-offsets] using vrsettings: ${p}`);
        return p;
      }
    } catch (e) { /* skip */ }
  }
  console.warn('[pose-offsets] no vrsettings found in any candidate location');
  return null;
}

/**
 * Read pose offsets from default.vrsettings.
 * Returns { left: { pos: {x,y,z}, rot: {x,y,z} }, right: { pos: {x,y,z}, rot: {x,y,z} } }
 */
function readPoseOffsets() {
  // 1) Prefer local cached copy — guaranteed writable, survives driver reinstall.
  try {
    const localPath = getLocalOffsetsPath();
    if (fs.existsSync(localPath)) {
      const cached = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      if (cached && cached.left && cached.right) return cached;
    }
  } catch (e) { /* fall through */ }

  // 2) Fall back to the driver's vrsettings if no local cache.
  const settingsPath = getVRSettingsPath();
  if (!settingsPath) return null;

  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    const ps = settings.pose_settings || {};

    return {
      left: {
        pos: {
          x: ps.left_x_offset_position ?? 0,
          y: ps.left_y_offset_position ?? 0,
          z: ps.left_z_offset_position ?? 0,
        },
        rot: {
          x: ps.left_x_offset_degrees ?? 0,
          y: ps.left_y_offset_degrees ?? 0,
          z: ps.left_z_offset_degrees ?? 0,
        },
      },
      right: {
        pos: {
          x: ps.right_x_offset_position ?? 0,
          y: ps.right_y_offset_position ?? 0,
          z: ps.right_z_offset_position ?? 0,
        },
        rot: {
          x: ps.right_x_offset_degrees ?? 0,
          y: ps.right_y_offset_degrees ?? 0,
          z: ps.right_z_offset_degrees ?? 0,
        },
      },
    };
  } catch (e) {
    return null;
  }
}

/**
 * Write pose offsets to default.vrsettings and optionally push to running driver.
 * @param {{ left: { pos: {x,y,z}, rot: {x,y,z} }, right: { pos: {x,y,z}, rot: {x,y,z} } }} offsets
 */
async function writePoseOffsets(offsets) {
  // 1) Always save to local cache first — this must never fail.
  let localSaved = false;
  let localError = null;
  try {
    fs.writeFileSync(getLocalOffsetsPath(), JSON.stringify(offsets, null, 2), 'utf8');
    localSaved = true;
  } catch (e) {
    localError = e.message;
  }

  // 2) Best-effort: mirror into the driver's default.vrsettings so settings
  //    persist across SteamVR restarts even without our loader running.
  //    Skipped while SteamVR/driver is running — rewriting the live settings
  //    file has been observed to crash vrserver. In that case the running
  //    driver is updated via HTTP (step 3) and the file mirror happens on
  //    the next save when SteamVR is off.
  let vrsettingsSaved = false;
  let vrsettingsError = null;
  let vrsettingsSkipped = false;
  const driverLive = await isDriverRunning();
  try {
    if (driverLive) {
      vrsettingsSkipped = true;
      vrsettingsError = 'skipped: driver is running';
    } else {
    const settingsPath = getVRSettingsPath();
    if (settingsPath) {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(raw);
      if (!settings.pose_settings) settings.pose_settings = {};
      const ps = settings.pose_settings;

      ps.left_x_offset_position = offsets.left.pos.x;
      ps.left_y_offset_position = offsets.left.pos.y;
      ps.left_z_offset_position = offsets.left.pos.z;
      ps.left_x_offset_degrees  = offsets.left.rot.x;
      ps.left_y_offset_degrees  = offsets.left.rot.y;
      ps.left_z_offset_degrees  = offsets.left.rot.z;

      ps.right_x_offset_position = offsets.right.pos.x;
      ps.right_y_offset_position = offsets.right.pos.y;
      ps.right_z_offset_position = offsets.right.pos.z;
      ps.right_x_offset_degrees  = offsets.right.rot.x;
      ps.right_y_offset_degrees  = offsets.right.rot.y;
      ps.right_z_offset_degrees  = offsets.right.rot.z;

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      vrsettingsSaved = true;
    }
    }
  } catch (e) {
    vrsettingsError = e.message;
  }

  // 3) Push to the running driver so changes apply immediately.
  const driverResult = await pushPoseOffsetsToDriver(offsets);

  // Overall success = we saved SOMEWHERE we can read back.
  if (!localSaved && !vrsettingsSaved && !vrsettingsSkipped) {
    return {
      success: false,
      error: `local: ${localError || 'n/a'}; vrsettings: ${vrsettingsError || 'not found'}`,
    };
  }

  return {
    success: true,
    fileSaved: localSaved,
    vrsettingsSaved,
    vrsettingsSkipped,
    vrsettingsError,
    driverUpdated: driverResult.success,
  };
}

/**
 * Apply the last-saved local pose offsets to the running driver (if any).
 * Called on app startup so the user's saved positioning is restored without
 * needing to open the settings panel.
 */
async function applyLocalPoseOffsets() {
  try {
    const localPath = getLocalOffsetsPath();
    if (!fs.existsSync(localPath)) return { success: false, reason: 'no-local-file' };
    const offsets = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    if (!offsets?.left || !offsets?.right) return { success: false, reason: 'invalid-format' };
    const r = await pushPoseOffsetsToDriver(offsets);
    return { success: r.success, offsets };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Push pose offsets to the running OpenGloves driver via POST /functions/pose_offset/<hand>.
 * Updates in real-time without SteamVR restart.
 */
function pushPoseOffsetsToDriver(offsets) {
  const postForHand = (hand, pos, rot) => new Promise((resolve) => {
    const postData = JSON.stringify({
      x: pos.x, y: pos.y, z: pos.z,
      rx: rot.x, ry: rot.y, rz: rot.z,
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port: 52075,
      path: `/functions/pose_offset/${hand}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ success: res.statusCode === 200 }));
    });
    req.on('error', () => resolve({ success: false }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
    req.write(postData);
    req.end();
  });

  return Promise.all([
    postForHand('left', offsets.left.pos, offsets.left.rot),
    postForHand('right', offsets.right.pos, offsets.right.rot),
  ]).then(([left, right]) => ({
    success: left.success || right.success,
  }));
}

/**
 * Load all pose presets from local data/pose_presets.json.
 * Returns { [name]: { left: {pos,rot}, right: {pos,rot} } }
 */
function loadPosePresets() {
  const presetsPath = getLocalPresetsPath();
  try {
    if (!fs.existsSync(presetsPath)) return {};
    return JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
  } catch (e) {
    console.warn('[pose-presets] load failed:', e.message);
    return {};
  }
}

/**
 * Save a named preset to local data/pose_presets.json.
 */
function savePosePreset(name, offsets) {
  const presetsPath = getLocalPresetsPath();
  try {
    const presets = loadPosePresets();
    presets[name] = offsets;
    fs.writeFileSync(presetsPath, JSON.stringify(presets, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('[pose-presets] save failed:', e.message);
    return false;
  }
}

/**
 * Delete a named preset.
 */
function deletePosePreset(name) {
  const presetsPath = getLocalPresetsPath();
  try {
    const presets = loadPosePresets();
    delete presets[name];
    fs.writeFileSync(presetsPath, JSON.stringify(presets, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  discoverDevices,
  discoverDevicesFromLog,
  discoverDevicesFromAPI,
  getSteamVRLogPath,
  getVRSettingsPath,
  postTrackingReference,
  setControllerOverride,
  getDriverSettings,
  readPoseOffsets,
  writePoseOffsets,
  pushPoseOffsetsToDriver,
  applyLocalPoseOffsets,
  loadPosePresets,
  savePosePreset,
  deletePosePreset,
};
