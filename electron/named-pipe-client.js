const net = require('net');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/**
 * Named Pipe client for OpenGloves driver communication.
 * 
 * Writes to: \\.\pipe\uvra\input\glove\v2\<left/right>
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
    this.pipeName = `\\\\.\\pipe\\uvra\\input\\glove\\v2\\${hand}`;
    this.pipe = null;
    this.connected = false;
    this.writing = false;
    this.reconnectTimer = null;

    // Calibration: per-finger min/max normalized values (0.0-1.0)
    this.calibration = {
      min: [0.0, 0.0, 0.0, 0.0, 0.0],     // min per finger (fully open)
      max: [1.0, 1.0, 1.0, 1.0, 1.0],     // max per finger (fully closed)
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

    // Dynamic calibration: slowly expand min/max range during use
    this.dynamicCalibration = true;
    this.dynamicRate = 0.002; // how fast to expand per sample (lower = slower, more stable)
    this._dynamicSaveCounter = 0;

    // Try to load saved calibration
    this._loadCalibration();
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
        return;
      }

      this.pipe = net.createConnection(this.pipeName, () => {
        this.connected = true;
        this.emit('connected', this.hand);
        resolve();
      });

      this.pipe.on('error', (err) => {
        this.connected = false;
        this.emit('error', { hand: this.hand, error: err.message });
        reject(err);
      });

      this.pipe.on('close', () => {
        this.connected = false;
        this.emit('disconnected', this.hand);
      });
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
  // Two-phase calibration:
  //   Phase 1 "open"  — user holds hand fully open (records min values)
  //   Phase 2 "close" — user holds hand fully closed (records max values)
  // Each phase has its own timer. Margin is applied to make 0%/100% easier to reach.

  static CALIBRATION_MARGIN = 0.08; // 8% margin on each side

  startCalibration(phaseDurationMs) {
    if (this.calibrating) return;
    this.calibrationPhaseDuration = phaseDurationMs || 5000;
    this.calibrating = true;
    this.calibrationPhase = 'open'; // 'open' → 'close' → finish
    this.calibrationSampleCount = 0;
    this.calibrationSamples = {
      min: [Infinity, Infinity, Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity],
    };

    console.log(`[Calibration] START ${this.hand}, phase=open, duration=${this.calibrationPhaseDuration}ms per phase`);
    this.emit('calibrationStart', { hand: this.hand, phase: 'open', duration: this.calibrationPhaseDuration });
    this.emit('calibrationPhase', { hand: this.hand, phase: 'open', remaining: this.calibrationPhaseDuration });

    // Phase 1 timer: open hand
    this.calibrationTimer = setTimeout(() => {
      this._startClosePhase();
    }, this.calibrationPhaseDuration);
  }

  _startClosePhase() {
    this.calibrationPhase = 'close';
    console.log(`[Calibration] ${this.hand} phase=close, min so far=[${this.calibrationSamples.min.map(v => v.toFixed(3))}]`);
    this.emit('calibrationPhase', { hand: this.hand, phase: 'close', remaining: this.calibrationPhaseDuration });

    this.calibrationTimer = setTimeout(() => {
      this.finishCalibration();
    }, this.calibrationPhaseDuration);
  }

  /**
   * Feed flexion values during calibration.
   * In 'open' phase — records min values. In 'close' phase — records max values.
   */
  feedCalibrationData(flexion) {
    if (!this.calibrating || !flexion || flexion.length < 5) return;
    this.calibrationSampleCount++;

    for (let i = 0; i < 5; i++) {
      const val = flexion[i][1] || 0;
      if (this.calibrationPhase === 'open') {
        if (val < this.calibrationSamples.min[i]) this.calibrationSamples.min[i] = val;
      } else {
        if (val > this.calibrationSamples.max[i]) this.calibrationSamples.max[i] = val;
      }
    }
  }

  finishCalibration() {
    this.calibrating = false;
    this.calibrationPhase = null;
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }

    console.log(`[Calibration] FINISH ${this.hand} samples=${this.calibrationSampleCount}`);
    console.log(`[Calibration] RECORDED: min=[${this.calibrationSamples.min.map(v => v.toFixed(3))}] max=[${this.calibrationSamples.max.map(v => v.toFixed(3))}]`);

    const margin = NamedPipeClient.CALIBRATION_MARGIN;

    for (let i = 0; i < 5; i++) {
      let min = this.calibrationSamples.min[i];
      let max = this.calibrationSamples.max[i];

      if (!isFinite(min) || !isFinite(max) || min >= max) {
        console.log(`[Calibration] WARNING: finger ${i} skipped (min=${min}, max=${max})`);
        continue;
      }

      // Apply margin: shrink the range so 0% and 100% are easier to reach
      const range = max - min;
      min = min + range * margin;
      max = max - range * margin;

      if (min < max) {
        this.calibration.min[i] = min;
        this.calibration.max[i] = max;
      }
    }

    console.log(`[Calibration] APPLIED (with ${margin * 100}% margin): min=[${this.calibration.min.map(v => v.toFixed(3))}] max=[${this.calibration.max.map(v => v.toFixed(3))}]`);

    this._saveCalibration();
    this.emit('calibrationEnd', {
      hand: this.hand,
      calibration: { ...this.calibration },
    });
  }

  cancelCalibration() {
    this.calibrating = false;
    this.calibrationPhase = null;
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
  }

  // ========== PROCESSING ==========

  /**
   * Apply calibration to normalized flexion values.
   * Maps min/max range to 0.0-1.0 with deadzone.
   */
  applyCalibration(normalizedVal, fingerIndex) {
    const min = this.calibration.min[fingerIndex];
    const max = this.calibration.max[fingerIndex];
    const range = max - min;
    if (range <= 0) return normalizedVal; // No calibration data, return original

    let val = (normalizedVal - min) / range;
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
   * Process incoming data: apply calibration, smoothing, then pack.
   */
  /**
   * Dynamic calibration: if a value is outside the current min/max range,
   * slowly move the boundary towards it. This gradually improves calibration
   * during normal use without needing a manual calibration step.
   */
  _dynamicCalibrate(fingerIndex, normalizedVal) {
    if (!this.dynamicCalibration || this.calibrating) return;

    const min = this.calibration.min[fingerIndex];
    const max = this.calibration.max[fingerIndex];
    let changed = false;

    if (normalizedVal < min) {
      this.calibration.min[fingerIndex] = min + (normalizedVal - min) * this.dynamicRate;
      changed = true;
    }
    if (normalizedVal > max) {
      this.calibration.max[fingerIndex] = max + (normalizedVal - max) * this.dynamicRate;
      changed = true;
    }

    // Save periodically if changed (every ~5 seconds at 100Hz)
    if (changed) {
      this._dynamicSaveCounter++;
      if (this._dynamicSaveCounter >= 500) {
        this._dynamicSaveCounter = 0;
        this._saveCalibration();
      }
    }
  }

  processData(data) {
    // Feed calibration if active
    if (this.calibrating) {
      this.feedCalibrationData(data.flexion);
    }

    // Apply calibration + EMA smoothing to finger flexion
    const flexion = [];
    for (let i = 0; i < 5; i++) {
      const normalizedVal = data.flexion[i][1] || 0;

      // Dynamic calibration: expand range in background
      this._dynamicCalibrate(i, normalizedVal);

      const calibratedVal = this.applyCalibration(normalizedVal, i);
      this.smoothed[i] = this.smooth(calibratedVal, this.smoothed[i]);
      const val = this.smoothed[i];
      flexion.push([val, val, val, val]);
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

  /**
   * Process incoming data (calibration, normalization, smoothing).
   * Always works — even without pipe connection.
   * Returns processed data for UI display.
   */
  updateData(data) {
    return this.processData(data);
  }

  sendData(data) {
    // Always process data (for calibration and smoothing) even if pipe is not connected
    const processed = this.processData(data);

    if (!this.connected || !this.pipe || this.writing) {
      return false;
    }

    try {
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
