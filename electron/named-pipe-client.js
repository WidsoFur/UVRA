const net = require('net');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/**
 * Named Pipe client for OpenGloves driver communication.
 * 
 * Writes to: \\.\pipe\vrapplication\input\glove\v2\<left/right>
 * 
 * Includes:
 *   - Per-finger min/max calibration (auto-detected during calibration phase)
 *   - EMA (Exponential Moving Average) smoothing with configurable alpha
 *   - Deadzone at min/max edges to eliminate sensor noise
 *   - Calibration data persistence to JSON file
 * 
 * OpenGloves v2 InputData struct layout (C++ memory layout):
 *   float flexion[5][4]  — 80 bytes (5 fingers × 4 joints × 4 bytes)
 *   float splay[5]       — 20 bytes
 *   float joyX            — 4 bytes
 *   float joyY            — 4 bytes
 *   bool  joyButton       — 1 byte
 *   bool  trgButton       — 1 byte
 *   bool  aButton         — 1 byte
 *   bool  bButton         — 1 byte
 *   bool  grab            — 1 byte
 *   bool  pinch           — 1 byte
 *   bool  menu            — 1 byte
 *   bool  calibrate       — 1 byte
 *   float trgValue        — 4 bytes
 *   Total: 120 bytes
 */
class NamedPipeClient extends EventEmitter {
  constructor(hand) {
    super();
    this.hand = hand;
    this.pipeName = `\\\\.\\pipe\\vrapplication\\input\\glove\\v2\\${hand}`;
    this.pipe = null;
    this.connected = false;
    this.writing = false;
    this.reconnectTimer = null;

    // Calibration: per-finger min/max raw ADC values
    this.calibration = {
      min: [0, 0, 0, 0, 0],       // raw ADC min per finger (fully open)
      max: [4095, 4095, 4095, 4095, 4095], // raw ADC max per finger (fully closed)
    };

    // Calibration recording state
    this.calibrating = false;
    this.calibrationTimer = null;
    this.calibrationDuration = 10000; // ms
    this.calibrationSamples = { min: [Infinity, Infinity, Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity] };

    // Smoothing: EMA (Exponential Moving Average)
    this.smoothingAlpha = 0.4; // 0.0 = max smooth, 1.0 = no smooth
    this.smoothed = [0, 0, 0, 0, 0]; // current smoothed values per finger
    this.smoothedJoyX = 0;
    this.smoothedJoyY = 0;

    // Deadzone: percentage of range to clamp at edges
    this.deadzone = 0.03; // 3%

    // Try to load saved calibration
    this._loadCalibration();
  }

  connect(retries = 5, delayMs = 2000) {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
        return;
      }

      const attempt = (attemptsLeft) => {
        const pipe = net.createConnection(this.pipeName, () => {
          this.pipe = pipe;
          this.connected = true;
          this.emit('connected', this.hand);
          resolve();
        });

        pipe.on('error', (err) => {
          pipe.destroy();
          const retriable = err.code === 'EPERM' || err.code === 'ENOENT' || err.code === 'EACCES';
          if (retriable && attemptsLeft > 0) {
            this.emit('error', { hand: this.hand, error: `${err.message} — повтор через ${delayMs / 1000}с (осталось ${attemptsLeft})` });
            setTimeout(() => attempt(attemptsLeft - 1), delayMs);
          } else {
            this.connected = false;
            let hint = '';
            if (err.code === 'EPERM' || err.code === 'EACCES') {
              hint = '. Попробуйте запустить UVRA от имени администратора, либо убедитесь что SteamVR и UVRA запущены с одинаковыми правами';
            } else if (err.code === 'ENOENT') {
              hint = '. Pipe не найден — убедитесь что SteamVR запущен и драйвер OpenGloves активен';
            }
            this.emit('error', { hand: this.hand, error: err.message + hint });
            reject(err);
          }
        });

        pipe.on('close', () => {
          this.connected = false;
          this.emit('disconnected', this.hand);
        });
      };

      attempt(retries);
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.writing = false;
    if (this.pipe) {
      try {
        this.pipe.removeAllListeners();
        this.pipe.unref();
        this.pipe.destroy();
      } catch (e) {}
      this.pipe = null;
    }
    this.connected = false;
  }

  // ========== CALIBRATION ==========

  /**
   * Start calibration: record min/max for each finger over a duration.
   * User should fully open and fully close their hand during this time.
   */
  startCalibration(durationMs) {
    if (this.calibrating) return;
    this.calibrationDuration = durationMs || 5000;
    this.calibrating = true;
    this.calibrationSamples = {
      min: [Infinity, Infinity, Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity],
    };
    this.emit('calibrationStart', { hand: this.hand, duration: this.calibrationDuration });

    this.calibrationTimer = setTimeout(() => {
      this.finishCalibration();
    }, this.calibrationDuration);
  }

  /**
   * Feed raw sensor values during calibration to track min/max.
   * raw = [thumb, index, middle, ring, pinky, joyX, joyY, trigger] (8 ints)
   */
  feedCalibrationData(raw) {
    if (!this.calibrating || !raw || raw.length < 5) return;
    for (let i = 0; i < 5; i++) {
      if (raw[i] < this.calibrationSamples.min[i]) this.calibrationSamples.min[i] = raw[i];
      if (raw[i] > this.calibrationSamples.max[i]) this.calibrationSamples.max[i] = raw[i];
    }
  }

  finishCalibration() {
    this.calibrating = false;
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }

    // Apply collected min/max, with safety margin
    for (let i = 0; i < 5; i++) {
      const min = this.calibrationSamples.min[i];
      const max = this.calibrationSamples.max[i];
      if (min < max && isFinite(min) && isFinite(max)) {
        this.calibration.min[i] = min;
        this.calibration.max[i] = max;
      }
    }

    this._saveCalibration();
    this.emit('calibrationEnd', {
      hand: this.hand,
      calibration: { ...this.calibration },
    });
  }

  cancelCalibration() {
    this.calibrating = false;
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
  }

  // ========== PROCESSING ==========

  /**
   * Normalize a raw ADC value to 0.0–1.0 using per-finger calibration.
   * Applies deadzone at edges.
   */
  normalizeRaw(raw, fingerIndex) {
    const min = this.calibration.min[fingerIndex];
    const max = this.calibration.max[fingerIndex];
    const range = max - min;
    if (range <= 0) return 0;

    let val = (raw - min) / range;
    val = Math.max(0, Math.min(1, val));

    // Apply deadzone at edges
    if (val < this.deadzone) val = 0;
    else if (val > 1 - this.deadzone) val = 1;
    else val = (val - this.deadzone) / (1 - 2 * this.deadzone);

    return val;
  }

  /**
   * Apply EMA smoothing: smoothed = alpha * new + (1 - alpha) * prev
   */
  smooth(newVal, prevSmoothed) {
    return this.smoothingAlpha * newVal + (1 - this.smoothingAlpha) * prevSmoothed;
  }

  /**
   * Process incoming data: calibrate raw values, apply smoothing, then pack.
   * If raw data is present, use it for calibration-aware normalization.
   * Otherwise fall through to the original flexion values.
   */
  processData(data) {
    const hasRaw = data.raw && data.raw.length >= 5;

    // Feed calibration if active
    if (this.calibrating && hasRaw) {
      this.feedCalibrationData(data.raw);
    }

    // Compute finger flexion from raw or use pre-normalized
    const flexion = [];
    for (let i = 0; i < 5; i++) {
      let val;
      if (hasRaw) {
        val = this.normalizeRaw(data.raw[i], i);
      } else {
        // Fallback: use middle joint from firmware-normalized data
        val = (data.flexion && data.flexion[i] && data.flexion[i][1]) || 0;
      }

      // Apply EMA smoothing
      this.smoothed[i] = this.smooth(val, this.smoothed[i]);
      val = this.smoothed[i];

      // Build 4-joint array: [0, curl, curl, curl] for non-thumb, [0, curl, curl, 0] for thumb
      if (i === 0) {
        flexion.push([0, val, val, 0]);
      } else {
        flexion.push([0, val, val, val]);
      }
    }

    // Smooth joystick
    const joyX = data.joyX || 0;
    const joyY = data.joyY || 0;
    this.smoothedJoyX = this.smooth(joyX, this.smoothedJoyX);
    this.smoothedJoyY = this.smooth(joyY, this.smoothedJoyY);

    return {
      flexion,
      splay: data.splay || [0.5, 0.5, 0.5, 0.5, 0.5],
      joyX: this.smoothedJoyX,
      joyY: this.smoothedJoyY,
      joyButton: !!data.joyButton,
      trgButton: !!data.trgButton,
      aButton: !!data.aButton,
      bButton: !!data.bButton,
      grab: !!data.grab,
      pinch: !!data.pinch,
      menu: !!data.menu,
      calibrate: !!data.calibrate,
      triggerValue: data.triggerValue || 0,
    };
  }

  // ========== PACKING ==========

  packData(processed) {
    const buf = Buffer.alloc(120);
    let offset = 0;

    // Flexion: 5 fingers × 4 joints
    for (let finger = 0; finger < 5; finger++) {
      for (let joint = 0; joint < 4; joint++) {
        const val = (processed.flexion[finger] && processed.flexion[finger][joint]) || 0;
        buf.writeFloatLE(Math.max(0, Math.min(1, val)), offset);
        offset += 4;
      }
    }

    // Splay: 5 fingers
    for (let i = 0; i < 5; i++) {
      buf.writeFloatLE(processed.splay[i] || 0.5, offset);
      offset += 4;
    }

    // Joystick
    buf.writeFloatLE(processed.joyX || 0, offset); offset += 4;
    buf.writeFloatLE(processed.joyY || 0, offset); offset += 4;

    // Buttons (each as a single byte bool)
    buf[offset++] = processed.joyButton ? 1 : 0;
    buf[offset++] = processed.trgButton ? 1 : 0;
    buf[offset++] = processed.aButton ? 1 : 0;
    buf[offset++] = processed.bButton ? 1 : 0;
    buf[offset++] = processed.grab ? 1 : 0;
    buf[offset++] = processed.pinch ? 1 : 0;
    buf[offset++] = processed.menu ? 1 : 0;
    buf[offset++] = processed.calibrate ? 1 : 0;

    // Trigger value
    buf.writeFloatLE(processed.triggerValue || 0, offset);

    return buf;
  }

  sendData(data) {
    if (!this.connected || !this.pipe || this.writing) {
      return false;
    }

    try {
      const processed = this.processData(data);
      const packed = this.packData(processed);
      this.writing = true;
      this.pipe.write(packed, () => {
        this.writing = false;
      });
      return true;
    } catch (err) {
      this.writing = false;
      this.connected = false;
      this.emit('error', { hand: this.hand, error: err.message });
      return false;
    }
  }

  // ========== SETTINGS ==========

  setSmoothingAlpha(alpha) {
    this.smoothingAlpha = Math.max(0.01, Math.min(1.0, alpha));
  }

  setDeadzone(dz) {
    this.deadzone = Math.max(0, Math.min(0.2, dz));
  }

  getCalibration() {
    return {
      min: [...this.calibration.min],
      max: [...this.calibration.max],
      smoothingAlpha: this.smoothingAlpha,
      deadzone: this.deadzone,
    };
  }

  setCalibration(cal) {
    if (cal.min) this.calibration.min = [...cal.min];
    if (cal.max) this.calibration.max = [...cal.max];
    if (cal.smoothingAlpha != null) this.smoothingAlpha = cal.smoothingAlpha;
    if (cal.deadzone != null) this.deadzone = cal.deadzone;
    this._saveCalibration();
  }

  // ========== PERSISTENCE ==========

  _getCalibrationPath() {
    const dir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `calibration_${this.hand}.json`);
  }

  _saveCalibration() {
    try {
      const data = {
        min: this.calibration.min,
        max: this.calibration.max,
        smoothingAlpha: this.smoothingAlpha,
        deadzone: this.deadzone,
      };
      fs.writeFileSync(this._getCalibrationPath(), JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      // silent fail
    }
  }

  _loadCalibration() {
    try {
      const filepath = this._getCalibrationPath();
      if (!fs.existsSync(filepath)) return;
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      if (data.min) this.calibration.min = data.min;
      if (data.max) this.calibration.max = data.max;
      if (data.smoothingAlpha != null) this.smoothingAlpha = data.smoothingAlpha;
      if (data.deadzone != null) this.deadzone = data.deadzone;
    } catch (e) {
      // silent fail
    }
  }
}

module.exports = NamedPipeClient;
