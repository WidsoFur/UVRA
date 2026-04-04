const net = require('net');
const EventEmitter = require('events');

/**
 * Named Pipe client for OpenGloves driver communication.
 * 
 * Writes to: \\.\pipe\vrapplication\input\glove\v2\<left/right>
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
 *   Total: ~120 bytes (with potential padding)
 * 
 * Note: C++ struct alignment may add padding. We pack as tightly as possible
 * and rely on the driver's actual memory layout.
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
    this.calibrationOffset = {
      flexion: Array(5).fill(null).map(() => Array(4).fill(0)),
      splay: Array(5).fill(0),
    };
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

  /**
   * Pack glove data into the OpenGloves v2 binary struct format.
   * 
   * Struct layout matching C++:
   *   std::array<std::array<float, 4>, 5> flexion;  // 80 bytes
   *   std::array<float, 5> splay;                    // 20 bytes
   *   float joyX;                                     // 4 bytes
   *   float joyY;                                     // 4 bytes
   *   bool joyButton;                                 // 1 byte
   *   bool trgButton;                                 // 1 byte
   *   bool aButton;                                   // 1 byte
   *   bool bButton;                                   // 1 byte
   *   bool grab;                                      // 1 byte
   *   bool pinch;                                     // 1 byte
   *   bool menu;                                      // 1 byte
   *   bool calibrate;                                 // 1 byte
   *   float trgValue;                                 // 4 bytes
   *                                                    // = 120 bytes
   */
  packData(data) {
    // 80 (flexion) + 20 (splay) + 8 (joy) + 8 (bools) + 4 (trigger) = 120
    const buf = Buffer.alloc(120);
    let offset = 0;

    // Flexion: 5 fingers × 4 joints
    for (let finger = 0; finger < 5; finger++) {
      for (let joint = 0; joint < 4; joint++) {
        let val = (data.flexion && data.flexion[finger] && data.flexion[finger][joint]) || 0;
        val = Math.max(0, Math.min(1, val + this.calibrationOffset.flexion[finger][joint]));
        buf.writeFloatLE(val, offset);
        offset += 4;
      }
    }

    // Splay: 5 fingers
    for (let i = 0; i < 5; i++) {
      let val = (data.splay && data.splay[i]) || 0.5;
      val = Math.max(0, Math.min(1, val + this.calibrationOffset.splay[i]));
      buf.writeFloatLE(val, offset);
      offset += 4;
    }

    // Joystick
    buf.writeFloatLE(data.joyX || 0, offset); offset += 4;
    buf.writeFloatLE(data.joyY || 0, offset); offset += 4;

    // Buttons (each as a single byte bool)
    buf[offset++] = data.joyButton ? 1 : 0;
    buf[offset++] = data.trgButton ? 1 : 0;
    buf[offset++] = data.aButton ? 1 : 0;
    buf[offset++] = data.bButton ? 1 : 0;
    buf[offset++] = data.grab ? 1 : 0;
    buf[offset++] = data.pinch ? 1 : 0;
    buf[offset++] = data.menu ? 1 : 0;
    buf[offset++] = data.calibrate ? 1 : 0;

    // Trigger value
    buf.writeFloatLE(data.triggerValue || 0, offset);

    return buf;
  }

  sendData(data) {
    if (!this.connected || !this.pipe || this.writing) {
      return false;
    }

    try {
      const packed = this.packData(data);
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

  calibrate() {
    // Reset calibration offsets
    this.calibrationOffset = {
      flexion: Array(5).fill(null).map(() => Array(4).fill(0)),
      splay: Array(5).fill(0),
    };
  }
}

module.exports = NamedPipeClient;
