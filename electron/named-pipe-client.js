const net = require('net');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/**
 * One Euro Filter — adaptive low-pass for noisy human input.
 * Smooths hard when signal is still (removes jitter), smooths less when signal
 * moves fast (preserves responsiveness). Designed for VR / hand tracking.
 *
 * Paper: Casiez et al., CHI 2012 — "1€ Filter"
 *
 * Params:
 *   minCutoff — base cutoff freq in Hz. Lower = more smoothing at rest.
 *   beta      — speed coefficient. Higher = more responsive to fast motion.
 *   dCutoff   — cutoff for derivative (usually 1.0).
 */
class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  _alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, tNow) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tNow;
      return x;
    }
    const dt = Math.max(1e-6, (tNow - this.tPrev) / 1000); // seconds
    this.tPrev = tNow;

    // Estimate derivative and low-pass it
    const dx = (x - this.xPrev) / dt;
    const aD = this._alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    // Adaptive cutoff: grows with |derivative|
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this._alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }

  setParams(minCutoff, beta) {
    if (minCutoff != null) this.minCutoff = minCutoff;
    if (beta != null) this.beta = beta;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

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

    // Smoothing: EMA (Exponential Moving Average) — used for joystick
    this.smoothingAlpha = 0.4; // 0.0 = max smooth, 1.0 = no smooth
    this.smoothed = [0, 0, 0, 0, 0]; // legacy EMA state per finger (unused if One Euro active)
    this.smoothedJoyX = 0;
    this.smoothedJoyY = 0;

    // One Euro Filter for fingers — adaptive smoothing (removes jitter at rest,
    // stays responsive during fast bending). Per-finger state.
    this.oneEuroMinCutoff = 1.0;  // Hz — lower = stronger smoothing at rest
    this.oneEuroBeta      = 0.007; // higher = more responsive to speed
    this.fingerFilters = [];
    for (let i = 0; i < 5; i++) {
      this.fingerFilters.push(new OneEuroFilter(this.oneEuroMinCutoff, this.oneEuroBeta));
    }

    // Joystick deadzone: circular, radius in 0..1 of stick range.
    // Values inside the radius output 0; outside are rescaled so the edge
    // of the deadzone maps to 0 (no step, smooth ramp).
    this.deadzone = 0.1; // 10% default

    // Flex edge deadzone: fixed small clamp at calibration min/max to kill
    // sensor noise at rest / full bend. Not user-configurable.
    this.flexEdgeDeadzone = 0.03;

    // Flex gain: multiplier applied after calibration. 1.0 = no change,
    // >1.0 = fingers bend "more" in VR (half bend → full), <1.0 = dampened.
    this.flexGain = 1.0;

    // Thumb gain: extra multiplier applied only to the thumb, stacks with flexGain.
    // Thumb sensors often have a smaller dynamic range than other fingers.
    this.thumbGain = 1.0;

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

    // Apply flex edge deadzone (noise clamp at min/max)
    const fdz = this.flexEdgeDeadzone;
    if (val < fdz) val = 0;
    else if (val > 1 - fdz) val = 1;
    else val = (val - fdz) / (1 - 2 * fdz);

    // Apply flex gain to all fingers EXCEPT the thumb.
    // Thumb uses its own thumbGain (applied later) so the two controls are independent.
    if (fingerIndex !== 0 && this.flexGain !== 1.0) {
      val = Math.max(0, Math.min(1, val * this.flexGain));
    }

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

    // Apply calibration + One Euro filter to finger flexion
    const now = Date.now();
    const flexion = [];
    for (let i = 0; i < 5; i++) {
      const normalizedVal = data.flexion[i][1] || 0;

      // Dynamic calibration: expand range in background
      this._dynamicCalibrate(i, normalizedVal);

      const calibratedVal = this.applyCalibration(normalizedVal, i);
      let val = this.fingerFilters[i].filter(calibratedVal, now);

      // Extra thumb-only multiplier on top of flexGain. Thumb flex sensors
      // typically have smaller dynamic range, so they can saturate short
      // of full curl even after calibration.
      if (i === 0 && this.thumbGain !== 1.0) {
        val = Math.max(0, Math.min(1, val * this.thumbGain));
      }

      this.smoothed[i] = val; // keep for UI/debug parity

      // Joint[0] is the knuckle (MCP / metacarpal). The thumb's metacarpal
      // does not flex like other fingers — OpenGloves' skeletal animation
      // reserves that joint for palm-plane rotation. Sending curl there
      // eats into the visible bend budget and leaves the thumb ~50% short.
      if (i === 0) {
        flexion.push([0, val, val, val]);
      } else {
        flexion.push([val, val, val, val]);
      }
    }

    // Smooth joystick
    let joyX = data.joyX || 0;
    let joyY = data.joyY || 0;

    // Circular deadzone: inside radius → 0, outside → rescaled so the
    // deadzone edge maps to 0 (no abrupt step when crossing the border).
    if (this.deadzone > 0) {
      const mag = Math.sqrt(joyX * joyX + joyY * joyY);
      if (mag < this.deadzone) {
        joyX = 0;
        joyY = 0;
      } else {
        const scale = (mag - this.deadzone) / ((1 - this.deadzone) * mag);
        joyX *= scale;
        joyY *= scale;
      }
    }

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

  setFlexGain(gain) {
    this.flexGain = Math.max(0.1, Math.min(5.0, gain));
  }

  setThumbGain(gain) {
    this.thumbGain = Math.max(0.1, Math.min(5.0, gain));
  }

  setOneEuroParams(minCutoff, beta) {
    if (minCutoff != null) this.oneEuroMinCutoff = Math.max(0.01, Math.min(20.0, minCutoff));
    if (beta != null)      this.oneEuroBeta      = Math.max(0.0,  Math.min(1.0,  beta));
    for (const f of this.fingerFilters) f.setParams(this.oneEuroMinCutoff, this.oneEuroBeta);
  }

  getCalibration() {
    return {
      min: [...this.calibration.min],
      max: [...this.calibration.max],
      smoothingAlpha: this.smoothingAlpha,
      deadzone: this.deadzone,
      oneEuroMinCutoff: this.oneEuroMinCutoff,
      oneEuroBeta: this.oneEuroBeta,
      flexGain: this.flexGain,
      thumbGain: this.thumbGain,
    };
  }

  setCalibration(cal) {
    if (cal.min) this.calibration.min = [...cal.min];
    if (cal.max) this.calibration.max = [...cal.max];
    if (cal.smoothingAlpha != null) this.smoothingAlpha = cal.smoothingAlpha;
    if (cal.deadzone != null) this.deadzone = cal.deadzone;
    if (cal.oneEuroMinCutoff != null || cal.oneEuroBeta != null) {
      this.setOneEuroParams(cal.oneEuroMinCutoff, cal.oneEuroBeta);
    }
    if (cal.flexGain != null) this.setFlexGain(cal.flexGain);
    if (cal.thumbGain != null) this.setThumbGain(cal.thumbGain);
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
        oneEuroMinCutoff: this.oneEuroMinCutoff,
        oneEuroBeta: this.oneEuroBeta,
        flexGain: this.flexGain,
        thumbGain: this.thumbGain,
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
      if (data.oneEuroMinCutoff != null || data.oneEuroBeta != null) {
        this.setOneEuroParams(data.oneEuroMinCutoff, data.oneEuroBeta);
      }
      if (data.flexGain != null) this.setFlexGain(data.flexGain);
      if (data.thumbGain != null) this.setThumbGain(data.thumbGain);
    } catch (e) {
      // silent fail
    }
  }
}

module.exports = NamedPipeClient;
