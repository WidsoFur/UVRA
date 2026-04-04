const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Persistent store for device MAC → hand assignment.
 *
 * File: %APPDATA%/uvra-gloves/devices.json
 * Format:
 * {
 *   "AA:BB:CC:DD:EE:FF": { "hand": "left",  "name": "Left Glove",  "lastSeen": "..." },
 *   "11:22:33:44:55:66": { "hand": "right", "name": "Right Glove", "lastSeen": "..." }
 * }
 */
class DeviceStore {
  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'devices.json');
    this.devices = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.devices = JSON.parse(raw);
      }
    } catch (err) {
      console.error('DeviceStore: failed to load', err.message);
      this.devices = {};
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.devices, null, 2), 'utf8');
    } catch (err) {
      console.error('DeviceStore: failed to save', err.message);
    }
  }

  /**
   * Get the hand assignment for a MAC address.
   * Returns "left", "right", or null if unknown.
   */
  getHand(mac) {
    const entry = this.devices[mac];
    return entry ? entry.hand : null;
  }

  /**
   * Get full device info for a MAC address.
   */
  getDevice(mac) {
    return this.devices[mac] || null;
  }

  /**
   * Assign a hand to a MAC address.
   */
  setDevice(mac, hand, name) {
    this.devices[mac] = {
      hand,
      name: name || this.devices[mac]?.name || mac,
      lastSeen: new Date().toISOString(),
    };
    this.save();
  }

  /**
   * Update lastSeen timestamp for a device.
   */
  touch(mac) {
    if (this.devices[mac]) {
      this.devices[mac].lastSeen = new Date().toISOString();
      // Don't save on every touch — too frequent. Caller can save periodically.
    }
  }

  /**
   * Remove a device by MAC.
   */
  removeDevice(mac) {
    delete this.devices[mac];
    this.save();
  }

  /**
   * Get all known devices.
   */
  getAllDevices() {
    return { ...this.devices };
  }
}

module.exports = DeviceStore;
