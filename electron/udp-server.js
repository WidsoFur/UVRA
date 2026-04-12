const dgram = require('dgram');
const EventEmitter = require('events');

/**
 * UDP Server that receives glove data from ESP32 devices over WiFi.
 * 
 * Expected packet format (JSON):
 * {
 *   "hand": "left" | "right",
 *   "fingers": {
 *     "thumb":  [joint0, joint1, joint2, joint3],
 *     "index":  [joint0, joint1, joint2, joint3],
 *     "middle": [joint0, joint1, joint2, joint3],
 *     "ring":   [joint0, joint1, joint2, joint3],
 *     "pinky":  [joint0, joint1, joint2, joint3]
 *   },
 *   "splay": [thumb, index, middle, ring, pinky],
 *   "joystick": { "x": 0.0, "y": 0.0 },
 *   "buttons": {
 *     "joy": false, "trigger": false, "A": false, "B": false,
 *     "grab": false, "pinch": false, "menu": false, "calibrate": false
 *   },
 *   "triggerValue": 0.0
 * }
 * 
 * Also supports UVRA Binary v1 (46 bytes):
 *   [0]      0x55 — magic byte
 *   [1]      hand: 0=left, 1=right
 *   [2..18]  MAC: 17 bytes "XX:XX:XX:XX:XX:XX\0"
 *   [19..28] raw flex: 5 × uint16 LE (raw ADC 0-4095)
 *   [29..38] norm flex: 5 × uint16 LE (0-10000 → 0.0-1.0)
 *   [39..42] joystick: 2 × int16 LE (X, Y, -10000..10000)
 *   [43]     buttons: bitmask
 *   [44..45] trigger: uint16 LE (0-10000)
 */
class UDPServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.running = false;
    this.port = null;
    this.connectedGloves = new Map();
    this.timeoutInterval = null;
    this.TIMEOUT_MS = 3000;
    this.discoveryServer = null;
    this.discoveryPort = 7776;
  }

  start(port = 7777) {
    return new Promise((resolve, reject) => {
      if (this.running) {
        this.stop();
      }

      this.server = dgram.createSocket('udp4');

      this.server.on('error', (err) => {
        this.emit('error', err);
        this.stop();
        reject(err);
      });

      this.server.on('message', (msg, rinfo) => {
        try {
          const data = this.parseMessage(msg, rinfo);
          if (data) {
            const mac = data.mac || null;
            const key = mac || `${rinfo.address}:${data.hand}`;
            const isNew = !this.connectedGloves.has(key);

            this.connectedGloves.set(key, {
              address: rinfo.address,
              port: rinfo.port,
              hand: data.hand,
              mac,
              lastSeen: Date.now(),
            });

            if (isNew) {
              this.emit('gloveConnected', {
                address: rinfo.address,
                hand: data.hand,
                mac,
              });
            }

            this.emit('gloveData', data);
          }
        } catch (err) {
          console.error('Error parsing glove data:', err.message);
        }
      });

      this.server.bind(port, '0.0.0.0', () => {
        this.running = true;
        this.port = port;
        this.startTimeoutChecker();
        this.startDiscovery();
        resolve();
      });
    });
  }

  /**
   * Start listening for ESP32 discovery broadcasts on the discovery port.
   * When a "UVRA_DISCOVER:<MAC>" packet arrives, respond with "UVRA_ACK:<dataPort>"
   * so the ESP32 knows where to send data.
   */
  startDiscovery() {
    if (this.discoveryServer) return;

    this.discoveryServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.discoveryServer.on('message', (msg, rinfo) => {
      const str = msg.toString('utf8').trim();
      if (str.startsWith('UVRA_DISCOVER:')) {
        const mac = str.substring(14);
        const response = `UVRA_ACK:${this.port}`;

        this.discoveryServer.send(response, rinfo.port, rinfo.address, (err) => {
          if (err) console.error('Discovery response error:', err.message);
        });

        this.emit('deviceDiscovered', { mac, address: rinfo.address });
      }
    });

    this.discoveryServer.on('error', (err) => {
      console.error('Discovery server error:', err.message);
    });

    this.discoveryServer.bind(this.discoveryPort, '0.0.0.0');
  }

  stopDiscovery() {
    if (this.discoveryServer) {
      try {
        this.discoveryServer.removeAllListeners();
        this.discoveryServer.unref();
        this.discoveryServer.close();
      } catch (e) {}
      this.discoveryServer = null;
    }
  }

  stop() {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }
    this.stopDiscovery();
    if (this.server) {
      try {
        this.server.removeAllListeners();
        this.server.unref();
        this.server.close();
      } catch (e) {}
      this.server = null;
    }
    this.running = false;
    this.port = null;

    for (const [key, info] of this.connectedGloves) {
      this.emit('gloveDisconnected', info);
    }
    this.connectedGloves.clear();
  }

  startTimeoutChecker() {
    this.timeoutInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, info] of this.connectedGloves) {
        if (now - info.lastSeen > this.TIMEOUT_MS) {
          this.connectedGloves.delete(key);
          this.emit('gloveDisconnected', info);
        }
      }
    }, 1000);
  }

  parseMessage(msg, rinfo) {
    // UVRA Binary v1 (46 bytes, magic 0x55)
    if (msg.length === 46 && msg[0] === 0x55) {
      return this.parseBinaryV1(msg, rinfo);
    }

    // Try JSON first
    if (msg[0] === 0x7B) { // '{'
      const json = JSON.parse(msg.toString('utf8'));
      return this.normalizeJsonData(json, rinfo);
    }

    // Legacy binary format (114 bytes)
    if (msg.length === 114) {
      return this.parseBinaryData(msg, rinfo);
    }

    // Try simple string format: "hand:left,A:1023,B:512,C:0,D:256,E:128"
    const str = msg.toString('utf8').trim();
    if (str.includes(':')) {
      return this.parseSimpleString(str, rinfo);
    }

    // Try OpenGloves alpha encoding: "A256B110C0D1023E512\n"
    return this.parseAlphaEncoding(str, rinfo);
  }

  normalizeJsonData(json, rinfo) {
    const hand = json.hand || 'left';
    const fingers = json.fingers || {};
    const flexion = [
      fingers.thumb  || [0, 0, 0, 0],
      fingers.index  || [0, 0, 0, 0],
      fingers.middle || [0, 0, 0, 0],
      fingers.ring   || [0, 0, 0, 0],
      fingers.pinky  || [0, 0, 0, 0],
    ];
    const splay = json.splay || [0.5, 0.5, 0.5, 0.5, 0.5];
    const joystick = json.joystick || { x: 0, y: 0 };
    const buttons = json.buttons || {};

    return {
      hand,
      flexion: flexion.map(f => f.map(v => Math.max(0, Math.min(1, v)))),
      splay: splay.map(v => Math.max(0, Math.min(1, v))),
      joyX: joystick.x || 0,
      joyY: joystick.y || 0,
      joyButton: !!buttons.joy,
      trgButton: !!buttons.trigger,
      aButton: !!buttons.A,
      bButton: !!buttons.B,
      grab: !!buttons.grab,
      pinch: !!buttons.pinch,
      menu: !!buttons.menu,
      calibrate: !!buttons.calibrate,
      triggerValue: json.triggerValue || 0,
      raw: json.raw || null,
      mac: json.mac || null,
      source: rinfo.address,
    };
  }

  parseBinaryV1(msg, rinfo) {
    // UVRA Binary v1 — 46 bytes
    let offset = 1; // skip magic 0x55

    const hand = msg[offset++] === 0 ? 'left' : 'right';

    // MAC address (17 bytes string)
    const mac = msg.slice(offset, offset + 17).toString('utf8').replace(/\0/g, '');
    offset += 17;

    // Raw flex ADC (5 × uint16 LE)
    const raw = [];
    for (let i = 0; i < 5; i++) {
      raw.push(msg.readUInt16LE(offset));
      offset += 2;
    }

    // Normalized flex (5 × uint16 LE, 0-10000 → 0.0-1.0)
    // Expand 1 value per finger → 4 identical joints
    const flexion = [];
    for (let i = 0; i < 5; i++) {
      const val = msg.readUInt16LE(offset) / 10000.0;
      offset += 2;
      flexion.push([val, val, val, val]);
    }

    // Joystick (2 × int16 LE, -10000..10000 → -1.0..1.0)
    const joyX = msg.readInt16LE(offset) / 10000.0;
    offset += 2;
    const joyY = msg.readInt16LE(offset) / 10000.0;
    offset += 2;

    // Buttons bitmask
    const btnByte = msg[offset++];

    // Trigger (uint16 LE, 0-10000 → 0.0-1.0)
    const triggerValue = msg.readUInt16LE(offset) / 10000.0;

    return {
      hand,
      flexion,
      splay: [0.5, 0.5, 0.5, 0.5, 0.5],
      joyX, joyY,
      joyButton:  !!(btnByte & 0x01),
      trgButton:  !!(btnByte & 0x02),
      aButton:    !!(btnByte & 0x04),
      bButton:    !!(btnByte & 0x08),
      grab:       !!(btnByte & 0x10),
      pinch:      !!(btnByte & 0x20),
      menu:       !!(btnByte & 0x40),
      calibrate:  !!(btnByte & 0x80),
      triggerValue,
      raw,
      mac: mac || null,
      source: rinfo.address,
    };
  }

  parseBinaryData(msg, rinfo) {
    const hand = msg[0] === 0 ? 'left' : 'right';
    let offset = 1;

    const flexion = [];
    for (let i = 0; i < 5; i++) {
      const joints = [];
      for (let j = 0; j < 4; j++) {
        joints.push(msg.readFloatLE(offset));
        offset += 4;
      }
      flexion.push(joints);
    }

    const splay = [];
    for (let i = 0; i < 5; i++) {
      splay.push(msg.readFloatLE(offset));
      offset += 4;
    }

    const joyX = msg.readFloatLE(offset); offset += 4;
    const joyY = msg.readFloatLE(offset); offset += 4;

    const btnByte = msg[offset]; offset += 1;
    const triggerValue = msg.readFloatLE(offset);

    // Convert normalized flexion back to raw ADC values for calibration
    const raw = flexion.map(finger => {
      // Use middle joint (index 1) as representative raw value
      const midJoint = finger[1];
      return Math.round(midJoint * 4095);
    });

    return {
      hand,
      flexion,
      splay,
      joyX, joyY,
      joyButton:  !!(btnByte & 0x01),
      trgButton:  !!(btnByte & 0x02),
      aButton:    !!(btnByte & 0x04),
      bButton:    !!(btnByte & 0x08),
      grab:       !!(btnByte & 0x10),
      pinch:      !!(btnByte & 0x20),
      menu:       !!(btnByte & 0x40),
      calibrate:  !!(btnByte & 0x80),
      triggerValue,
      raw, // Raw ADC values for calibration
      source: rinfo.address,
    };
  }

  parseSimpleString(str, rinfo) {
    const parts = str.split(',');
    const map = {};
    for (const part of parts) {
      const [key, val] = part.split(':');
      map[key.trim()] = val.trim();
    }

    const hand = map.hand || 'left';
    const maxVal = parseFloat(map.max) || 4095;

    const normalize = (key) => {
      const v = parseFloat(map[key] || '0');
      return Math.max(0, Math.min(1, v / maxVal));
    };

    return {
      hand,
      flexion: [
        [normalize('A'), normalize('A'), normalize('A'), 0],
        [normalize('B'), normalize('B'), normalize('B'), normalize('B')],
        [normalize('C'), normalize('C'), normalize('C'), normalize('C')],
        [normalize('D'), normalize('D'), normalize('D'), normalize('D')],
        [normalize('E'), normalize('E'), normalize('E'), normalize('E')],
      ],
      splay: [0.5, 0.5, 0.5, 0.5, 0.5],
      joyX: parseFloat(map.F || '0') / maxVal,
      joyY: parseFloat(map.G || '0') / maxVal,
      joyButton: map.H === '1',
      trgButton: map.I === '1',
      aButton: map.J === '1',
      bButton: map.K === '1',
      grab: map.L === '1',
      pinch: map.M === '1',
      menu: map.N === '1',
      calibrate: map.O === '1',
      triggerValue: normalize('P'),
      raw: [ // Raw ADC values for calibration
        parseFloat(map.A || '0'),
        parseFloat(map.B || '0'),
        parseFloat(map.C || '0'),
        parseFloat(map.D || '0'),
        parseFloat(map.E || '0'),
      ],
      source: rinfo.address,
    };
  }

  parseAlphaEncoding(str, rinfo) {
    const data = str.replace(/\n/g, '');
    const regex = /([A-Z])(\d+)/g;
    const values = {};
    let match;
    while ((match = regex.exec(data)) !== null) {
      values[match[1]] = parseInt(match[2]);
    }

    const maxVal = 4095;
    const normalize = (key) => Math.max(0, Math.min(1, (values[key] || 0) / maxVal));

    return {
      hand: 'left',
      flexion: [
        [normalize('A'), normalize('A'), normalize('A'), 0],
        [normalize('B'), normalize('B'), normalize('B'), normalize('B')],
        [normalize('C'), normalize('C'), normalize('C'), normalize('C')],
        [normalize('D'), normalize('D'), normalize('D'), normalize('D')],
        [normalize('E'), normalize('E'), normalize('E'), normalize('E')],
      ],
      splay: [0.5, 0.5, 0.5, 0.5, 0.5],
      joyX: normalize('F'),
      joyY: normalize('G'),
      joyButton: 'H' in values,
      trgButton: 'I' in values,
      aButton: 'J' in values,
      bButton: 'K' in values,
      grab: 'L' in values,
      pinch: 'M' in values,
      menu: 'N' in values,
      calibrate: 'O' in values,
      triggerValue: normalize('P'),
      raw: [ // Raw ADC values for calibration
        values.A || 0,
        values.B || 0,
        values.C || 0,
        values.D || 0,
        values.E || 0,
      ],
      source: rinfo.address,
    };
  }

  getConnectedGloves() {
    return Array.from(this.connectedGloves.values()).map(g => ({
      address: g.address,
      hand: g.hand,
      mac: g.mac,
      lastSeen: g.lastSeen,
    }));
  }
}

module.exports = UDPServer;
