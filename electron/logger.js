const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Max log file size before rotation (5 MB)
const MAX_LOG_SIZE = 5 * 1024 * 1024;
// Max raw data log size (10 MB — raw data is verbose)
const MAX_RAW_SIZE = 10 * 1024 * 1024;

function getTimestamp() {
  return new Date().toISOString();
}

function rotateIfNeeded(filepath, maxSize) {
  try {
    if (!fs.existsSync(filepath)) return;
    const stats = fs.statSync(filepath);
    if (stats.size >= maxSize) {
      const ext = path.extname(filepath);
      const base = filepath.slice(0, -ext.length);
      const rotated = `${base}_${Date.now()}${ext}`;
      fs.renameSync(filepath, rotated);

      // Keep only last 3 rotated files
      const dir = path.dirname(filepath);
      const prefix = path.basename(base);
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f !== path.basename(filepath))
        .sort()
        .reverse();
      for (let i = 3; i < files.length; i++) {
        try { fs.unlinkSync(path.join(dir, files[i])); } catch (e) {}
      }
    }
  } catch (e) {
    // silent
  }
}

// ============================================================
// App Logger — errors, warnings, info, events
// ============================================================
class AppLogger {
  constructor() {
    this.filepath = path.join(LOGS_DIR, 'uvra.log');
    this._stream = null;
    this._open();
  }

  _open() {
    rotateIfNeeded(this.filepath, MAX_LOG_SIZE);
    this._stream = fs.createWriteStream(this.filepath, { flags: 'a' });
    this._write('INFO', '=== UVRA session started ===');
  }

  _write(level, message, context) {
    if (!this._stream) return;
    const line = context
      ? `[${getTimestamp()}] [${level}] ${message} | ${JSON.stringify(context)}`
      : `[${getTimestamp()}] [${level}] ${message}`;
    this._stream.write(line + '\n');
  }

  info(message, context) { this._write('INFO', message, context); }
  warn(message, context) { this._write('WARN', message, context); }
  error(message, context) { this._write('ERROR', message, context); }
  event(message, context) { this._write('EVENT', message, context); }
  debug(message, context) { this._write('DEBUG', message, context); }

  close() {
    if (this._stream) {
      this._write('INFO', '=== UVRA session ended ===');
      this._stream.end();
      this._stream = null;
    }
  }
}

// ============================================================
// Raw Data Logger — ESP32 sensor data
// ============================================================
class RawDataLogger {
  constructor() {
    this.filepath = path.join(LOGS_DIR, 'raw_data.log');
    this._stream = null;
    this._enabled = true;
    this._sampleCount = 0;
    this._logEveryN = 1; // log every Nth packet (1 = all)
    this._open();
  }

  _open() {
    rotateIfNeeded(this.filepath, MAX_RAW_SIZE);
    this._stream = fs.createWriteStream(this.filepath, { flags: 'a' });
    this._stream.write(`[${getTimestamp()}] === Raw data logging started ===\n`);
  }

  setEnabled(enabled) {
    this._enabled = enabled;
  }

  setSampleRate(n) {
    this._logEveryN = Math.max(1, Math.floor(n));
  }

  logPacket(hand, data) {
    if (!this._enabled || !this._stream) return;
    this._sampleCount++;
    if (this._sampleCount % this._logEveryN !== 0) return;

    const raw = data.raw;
    if (!raw) return;

    const line = `[${getTimestamp()}] ${hand} | raw:[${raw.join(',')}] | joy:${data.joyX?.toFixed(3)},${data.joyY?.toFixed(3)} | trg:${data.triggerValue?.toFixed(3)} | mac:${data.mac || '?'}`;
    this._stream.write(line + '\n');
  }

  close() {
    if (this._stream) {
      this._stream.write(`[${getTimestamp()}] === Raw data logging ended ===\n`);
      this._stream.end();
      this._stream = null;
    }
  }
}

// Singleton instances
const appLogger = new AppLogger();
const rawLogger = new RawDataLogger();

module.exports = { appLogger, rawLogger };
