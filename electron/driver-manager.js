const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const os = require('os');

/**
 * DriverManager handles automatic installation and configuration
 * of the OpenGloves SteamVR driver.
 *
 * Responsibilities:
 * - Detect SteamVR installation path
 * - Download OpenGloves driver from GitHub releases
 * - Install driver into SteamVR/drivers/
 * - Configure driver for Named Pipes communication
 * - Check driver status
 */

const DRIVER_FOLDER_NAME = 'opengloves';

class DriverManager extends EventEmitter {
  constructor() {
    super();
    this.steamVRPath = null;
    this.driverPath = null;
    this.installed = false;
    this.status = 'unknown'; // unknown, not_found, installed, configured, error
  }

  /**
   * Find SteamVR installation path by checking common locations
   * and reading Steam's libraryfolders.vdf
   */
  findSteamVR() {
    const possiblePaths = [
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR',
      'C:\\Program Files\\Steam\\steamapps\\common\\SteamVR',
      'D:\\Steam\\steamapps\\common\\SteamVR',
      'D:\\SteamLibrary\\steamapps\\common\\SteamVR',
      'E:\\Steam\\steamapps\\common\\SteamVR',
      'E:\\SteamLibrary\\steamapps\\common\\SteamVR',
    ];

    // Also try to find via registry or Steam config
    const steamConfigPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'openvr', 'openvrpaths.vrpath'),
    ];

    // Try openvrpaths.vrpath first - most reliable
    for (const configPath of steamConfigPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (data.runtime && data.runtime.length > 0) {
            for (const runtimePath of data.runtime) {
              const normalized = runtimePath.replace(/\\\\/g, '\\').replace(/\//g, '\\');
              if (fs.existsSync(normalized)) {
                this.steamVRPath = normalized;
                this.driverPath = path.join(normalized, 'drivers', DRIVER_FOLDER_NAME);
                this.emit('log', 'info', `SteamVR найден: ${normalized}`);
                return normalized;
              }
            }
          }
        }
      } catch (e) {
        // continue
      }
    }

    // Fallback: check common paths
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          this.steamVRPath = p;
          this.driverPath = path.join(p, 'drivers', DRIVER_FOLDER_NAME);
          this.emit('log', 'info', `SteamVR найден: ${p}`);
          return p;
        }
      } catch (e) {
        // continue
      }
    }

    // Try to find via Steam's libraryfolders.vdf
    const libraryVdfPaths = [
      'C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf',
      'C:\\Program Files\\Steam\\steamapps\\libraryfolders.vdf',
    ];

    for (const vdfPath of libraryVdfPaths) {
      try {
        if (fs.existsSync(vdfPath)) {
          const content = fs.readFileSync(vdfPath, 'utf8');
          const pathMatches = content.match(/"path"\s+"([^"]+)"/g);
          if (pathMatches) {
            for (const match of pathMatches) {
              const libPath = match.match(/"path"\s+"([^"]+)"/)[1].replace(/\\\\/g, '\\');
              const steamVRCandidate = path.join(libPath, 'steamapps', 'common', 'SteamVR');
              if (fs.existsSync(steamVRCandidate)) {
                this.steamVRPath = steamVRCandidate;
                this.driverPath = path.join(steamVRCandidate, 'drivers', DRIVER_FOLDER_NAME);
                this.emit('log', 'info', `SteamVR найден: ${steamVRCandidate}`);
                return steamVRCandidate;
              }
            }
          }
        }
      } catch (e) {
        // continue
      }
    }

    this.emit('log', 'error', 'SteamVR не найден');
    return null;
  }

  /**
   * Check if OpenGloves driver is already installed
   */
  checkInstalled() {
    if (!this.steamVRPath) {
      this.findSteamVR();
    }

    if (!this.driverPath) {
      this.status = 'not_found';
      return false;
    }

    const driverBinDir = path.join(this.driverPath, 'bin', 'win64');
    const driverDll = path.join(driverBinDir, 'driver_opengloves.dll');
    const driverManifest = path.join(this.driverPath, 'driver.vrdrivermanifest');

    if (fs.existsSync(driverDll) && fs.existsSync(driverManifest)) {
      this.installed = true;
      this.status = 'installed';
      this.emit('log', 'success', 'Драйвер OpenGloves установлен');
      return true;
    }

    this.status = 'not_found';
    this.emit('log', 'warning', 'Драйвер OpenGloves не установлен');
    return false;
  }

  /**
   * Get path to bundled driver included with the app
   */
  getBundledDriverPath() {
    // In development: project_root/opengloves
    // In production: resources/opengloves (packed with electron-builder)
    const { app } = require('electron');
    const devPath = path.join(__dirname, '..', DRIVER_FOLDER_NAME);
    const prodPath = path.join(path.dirname(app.getAppPath()), DRIVER_FOLDER_NAME);

    if (fs.existsSync(devPath)) return devPath;
    if (fs.existsSync(prodPath)) return prodPath;
    return null;
  }

  /**
   * Full installation: copy bundled driver to SteamVR/drivers/
   */
  async install() {
    try {
      this.emit('status', 'installing');

      // 1. Find SteamVR
      if (!this.steamVRPath) {
        this.findSteamVR();
      }
      if (!this.steamVRPath) {
        throw new Error('SteamVR не найден. Убедитесь, что Steam и SteamVR установлены.');
      }

      const driversDir = path.join(this.steamVRPath, 'drivers');
      if (!fs.existsSync(driversDir)) {
        throw new Error(`Папка drivers не найдена: ${driversDir}`);
      }

      // 2. Find bundled driver
      const bundledPath = this.getBundledDriverPath();
      if (!bundledPath) {
        throw new Error('Драйвер OpenGloves не найден в составе приложения');
      }
      this.emit('log', 'info', `Источник драйвера: ${bundledPath}`);

      // 3. Copy to SteamVR/drivers/
      const targetPath = path.join(driversDir, DRIVER_FOLDER_NAME);
      this.emit('log', 'info', `Установка в: ${targetPath}`);
      this.copyFolderSync(bundledPath, targetPath);

      // 4. Configure for Named Pipes
      this.driverPath = targetPath;
      await this.configureForNamedPipes();

      this.installed = true;
      this.status = 'configured';
      this.emit('log', 'success', 'Драйвер OpenGloves успешно установлен и настроен!');
      this.emit('status', 'configured');
      return true;

    } catch (err) {
      this.status = 'error';
      this.emit('log', 'error', `Ошибка установки: ${err.message}`);
      this.emit('status', 'error');
      throw err;
    }
  }

  /**
   * Register driver path in openvrpaths.vrpath external_drivers
   * (alternative to copying into SteamVR/drivers/)
   */
  registerExternalDriver(driverPath) {
    const vrpathFile = path.join(os.homedir(), 'AppData', 'Local', 'openvr', 'openvrpaths.vrpath');
    try {
      if (!fs.existsSync(vrpathFile)) {
        this.emit('log', 'warning', 'openvrpaths.vrpath не найден');
        return false;
      }

      const data = JSON.parse(fs.readFileSync(vrpathFile, 'utf8'));
      if (!data.external_drivers) {
        data.external_drivers = [];
      }

      const normalized = driverPath.replace(/\\/g, '\\\\');
      if (!data.external_drivers.includes(driverPath) && !data.external_drivers.includes(normalized)) {
        data.external_drivers.push(driverPath);
        fs.writeFileSync(vrpathFile, JSON.stringify(data, null, '\t'), 'utf8');
        this.emit('log', 'success', `Драйвер зарегистрирован в openvrpaths.vrpath`);
      }
      return true;
    } catch (e) {
      this.emit('log', 'error', `Ошибка регистрации драйвера: ${e.message}`);
      return false;
    }
  }

  /**
   * Recursively copy a folder
   */
  copyFolderSync(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const items = fs.readdirSync(src);
    for (const item of items) {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);
      const stat = fs.statSync(srcPath);

      if (stat.isDirectory()) {
        this.copyFolderSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Configure OpenGloves driver to use Named Pipes instead of Serial.
   * Modifies the driver's default.vrsettings file.
   */
  async configureForNamedPipes() {
    this.emit('log', 'info', 'Настройка драйвера для Named Pipes...');

    // OpenGloves reads from its own default.vrsettings in the driver folder
    const driverSettingsPath = this.driverPath
      ? path.join(this.driverPath, 'resources', 'settings', 'default.vrsettings')
      : null;

    if (driverSettingsPath && fs.existsSync(driverSettingsPath)) {
      try {
        let settings = JSON.parse(fs.readFileSync(driverSettingsPath, 'utf8'));

        // Enable driver
        if (!settings['driver_opengloves']) settings['driver_opengloves'] = {};
        settings['driver_opengloves']['enable'] = true;
        settings['driver_opengloves']['left_enabled'] = true;
        settings['driver_opengloves']['right_enabled'] = true;

        // Disable serial and bluetooth, enable Named Pipes
        if (settings['communication_serial']) {
          settings['communication_serial']['enable'] = false;
        }
        if (settings['communication_btserial']) {
          settings['communication_btserial']['enable'] = false;
        }
        if (!settings['communication_namedpipe']) settings['communication_namedpipe'] = {};
        settings['communication_namedpipe']['enable'] = true;

        fs.writeFileSync(driverSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
        this.emit('log', 'success', 'Настройки драйвера обновлены (Named Pipes)');
      } catch (e) {
        this.emit('log', 'warning', `Не удалось обновить настройки драйвера: ${e.message}`);
      }
    } else {
      this.emit('log', 'warning', 'Файл default.vrsettings не найден');
    }
  }

  /**
   * Uninstall the driver from SteamVR
   */
  uninstall() {
    if (!this.driverPath || !fs.existsSync(this.driverPath)) {
      this.emit('log', 'warning', 'Драйвер не найден для удаления');
      return false;
    }

    try {
      fs.rmSync(this.driverPath, { recursive: true, force: true });
      this.installed = false;
      this.status = 'not_found';
      this.emit('log', 'info', 'Драйвер OpenGloves удалён');
      return true;
    } catch (e) {
      this.emit('log', 'error', `Ошибка удаления: ${e.message}`);
      return false;
    }
  }

  /**
   * Get full status object
   */
  getStatus() {
    return {
      steamVRPath: this.steamVRPath,
      driverPath: this.driverPath,
      installed: this.installed,
      status: this.status,
    };
  }
}

module.exports = DriverManager;
