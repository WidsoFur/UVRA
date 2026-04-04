const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * Discovers SteamVR tracked devices by parsing vrserver.txt log.
 * Returns array of { id, serial, driver, type, model, manufacturer, role }
 */
function discoverDevicesFromLog() {
  const logPath = getSteamVRLogPath();
  if (!logPath || !fs.existsSync(logPath)) {
    return [];
  }

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

  return devices;
}

/**
 * Get SteamVR vrserver.txt log path
 */
function getSteamVRLogPath() {
  const candidates = [
    path.join('C:', 'Program Files (x86)', 'Steam', 'logs', 'vrserver.txt'),
    path.join('D:', 'Program Files (x86)', 'Steam', 'logs', 'vrserver.txt'),
    path.join('D:', 'Steam', 'logs', 'vrserver.txt'),
  ];

  // Also try user-specific Steam paths
  const home = require('os').homedir();
  candidates.push(path.join(home, 'Steam', 'logs', 'vrserver.txt'));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
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

module.exports = {
  discoverDevicesFromLog,
  getSteamVRLogPath,
  postTrackingReference,
  setControllerOverride,
  getDriverSettings,
};
