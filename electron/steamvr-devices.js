const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * Discovers SteamVR tracked devices by parsing vrserver.txt log.
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

    // Classify type and role
    if (serial.includes('HMD') || serial.includes('Headset') || device.model.includes('Quest')) {
      if (serial.toLowerCase().includes('controller') || device.model.toLowerCase().includes('controller')) {
        device.type = 'controller';
      } else {
        device.type = 'hmd';
      }
    }

    if (serial.includes('Controller') || device.model.includes('Controller')) {
      device.type = 'controller';
    }

    // Detect hand from serial or model
    const serialAndModel = (serial + ' ' + device.model).toLowerCase();
    if (serialAndModel.includes('left')) {
      device.role = 'left_hand';
    } else if (serialAndModel.includes('right')) {
      device.role = 'right_hand';
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

  // Fix IDs: devices that didn't get a TrackedDeviceIndex from log
  // use sequential assignment. The first HMD that activates successfully = 0,
  // but failed activations don't get an ID. Let's use sequential order.
  // Actually, SteamVR assigns IDs sequentially for successfully added devices.
  // We need to filter out failed activations.
  
  // Look for "finished adding tracked device" to confirm successful activation
  const confirmedSerials = new Set();
  for (const line of lines) {
    const finishMatch = line.match(/finished adding tracked device with serial number '([^']+)'/);
    if (finishMatch) {
      confirmedSerials.add(finishMatch[1]);
    }
  }

  // Reassign IDs based on confirmed activation order
  let nextId = 0;
  for (const device of devices) {
    if (confirmedSerials.has(device.serial)) {
      device.id = nextId++;
      device.confirmed = true;
    } else {
      device.confirmed = false;
    }
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
 * POST tracking reference to the OpenGloves internal server (port 52071).
 * Returns true if successful.
 */
function postTrackingReference(deviceId, role) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ openvr_id: deviceId, openvr_role: role });

    const req = http.request({
      hostname: '127.0.0.1',
      port: 52071,
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
 * Set controller_override settings via the OpenGloves external server (port 52060).
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
      port: 52060,
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
 * Get current OpenGloves driver settings from the external server (port 52060).
 */
function getDriverSettings() {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: 52060,
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
function getVRSettingsPath() {
  const candidates = [
    path.join(__dirname, '..', 'opengloves', 'resources', 'settings', 'default.vrsettings'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Read pose offsets from default.vrsettings.
 * Returns { left: { pos: {x,y,z}, rot: {x,y,z} }, right: { pos: {x,y,z}, rot: {x,y,z} } }
 */
function readPoseOffsets() {
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
  const settingsPath = getVRSettingsPath();
  if (!settingsPath) return { success: false, error: 'vrsettings not found' };

  try {
    // Read, update, write back
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    if (!settings.pose_settings) settings.pose_settings = {};
    const ps = settings.pose_settings;

    ps.left_x_offset_position = offsets.left.pos.x;
    ps.left_y_offset_position = offsets.left.pos.y;
    ps.left_z_offset_position = offsets.left.pos.z;
    ps.left_x_offset_degrees = offsets.left.rot.x;
    ps.left_y_offset_degrees = offsets.left.rot.y;
    ps.left_z_offset_degrees = offsets.left.rot.z;

    ps.right_x_offset_position = offsets.right.pos.x;
    ps.right_y_offset_position = offsets.right.pos.y;
    ps.right_z_offset_position = offsets.right.pos.z;
    ps.right_x_offset_degrees = offsets.right.rot.x;
    ps.right_y_offset_degrees = offsets.right.rot.y;
    ps.right_z_offset_degrees = offsets.right.rot.z;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    // Also push to running driver via external server (port 52060)
    const driverResult = await pushPoseOffsetsToDriver(offsets);

    return { success: true, fileSaved: true, driverUpdated: driverResult.success };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Push pose offsets to the running OpenGloves driver via the external server POST /settings.
 */
function pushPoseOffsetsToDriver(offsets) {
  return new Promise((resolve) => {
    const settings = {
      pose_settings: {
        left_x_offset_position: offsets.left.pos.x,
        left_y_offset_position: offsets.left.pos.y,
        left_z_offset_position: offsets.left.pos.z,
        left_x_offset_degrees: offsets.left.rot.x,
        left_y_offset_degrees: offsets.left.rot.y,
        left_z_offset_degrees: offsets.left.rot.z,
        right_x_offset_position: offsets.right.pos.x,
        right_y_offset_position: offsets.right.pos.y,
        right_z_offset_position: offsets.right.pos.z,
        right_x_offset_degrees: offsets.right.rot.x,
        right_y_offset_degrees: offsets.right.rot.y,
        right_z_offset_degrees: offsets.right.rot.z,
      }
    };
    const postData = JSON.stringify(settings);

    const req = http.request({
      hostname: '127.0.0.1',
      port: 52060,
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
      res.on('end', () => resolve({ success: res.statusCode === 200 }));
    });
    req.on('error', () => resolve({ success: false }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
    req.write(postData);
    req.end();
  });
}

/**
 * Path to the pose presets JSON file (stored alongside default.vrsettings).
 */
function getPresetsPath() {
  const settingsDir = getVRSettingsPath();
  if (!settingsDir) return null;
  return path.join(path.dirname(settingsDir), 'pose_presets.json');
}

/**
 * Load all pose presets.
 * Returns { presets: { [name]: { left: {pos,rot}, right: {pos,rot} } } }
 */
function loadPosePresets() {
  const presetsPath = getPresetsPath();
  if (!presetsPath) return {};
  try {
    if (!fs.existsSync(presetsPath)) return {};
    return JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

/**
 * Save a named preset.
 */
function savePosePreset(name, offsets) {
  const presetsPath = getPresetsPath();
  if (!presetsPath) return false;
  try {
    const presets = loadPosePresets();
    presets[name] = offsets;
    fs.writeFileSync(presetsPath, JSON.stringify(presets, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Delete a named preset.
 */
function deletePosePreset(name) {
  const presetsPath = getPresetsPath();
  if (!presetsPath) return false;
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
  discoverDevicesFromLog,
  getSteamVRLogPath,
  postTrackingReference,
  setControllerOverride,
  getDriverSettings,
  readPoseOffsets,
  writePoseOffsets,
  loadPosePresets,
  savePosePreset,
  deletePosePreset,
};
