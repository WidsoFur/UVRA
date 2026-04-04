const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
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

const GITHUB_RELEASE_API = 'https://api.github.com/repos/LucidVR/opengloves-driver/releases/latest';
const DRIVER_FOLDER_NAME = 'openglove';

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
    const driverDll = path.join(driverBinDir, 'driver_openglove.dll');
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
   * Get latest release download URL from GitHub
   */
  getLatestReleaseUrl() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/LucidVR/opengloves-driver/releases/latest',
        headers: { 'User-Agent': 'UVRA-Gloves/1.0' },
      };

      https.get(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            if (release.assets) {
              const asset = release.assets.find(a =>
                a.name.toLowerCase().includes('openglove') &&
                a.name.toLowerCase().endsWith('.zip')
              );
              if (asset) {
                resolve({
                  url: asset.browser_download_url,
                  name: asset.name,
                  version: release.tag_name,
                });
                return;
              }
            }
            reject(new Error('Не найден архив драйвера в последнем релизе'));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Download a file from URL, following redirects
   */
  downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      this.emit('log', 'info', `Скачивание: ${url}`);
      this.emit('downloadProgress', 0);

      const makeRequest = (requestUrl) => {
        const lib = requestUrl.startsWith('https') ? https : http;
        lib.get(requestUrl, { headers: { 'User-Agent': 'UVRA-Gloves/1.0' } }, (res) => {
          // Handle redirects
          if (res.statusCode === 301 || res.statusCode === 302) {
            makeRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          const totalSize = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          const file = fs.createWriteStream(destPath);
          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize > 0) {
              this.emit('downloadProgress', Math.round(downloaded / totalSize * 100));
            }
          });
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            this.emit('downloadProgress', 100);
            resolve(destPath);
          });
        }).on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      };

      makeRequest(url);
    });
  }

  /**
   * Extract zip file using PowerShell (Windows built-in)
   */
  extractZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
      this.emit('log', 'info', 'Распаковка драйвера...');

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const psCommand = `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`;
      exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Ошибка распаковки: ${stderr || error.message}`));
        } else {
          resolve(destDir);
        }
      });
    });
  }

  /**
   * Full installation: download, extract, place in SteamVR/drivers/
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

      // 2. Get latest release info
      this.emit('log', 'info', 'Поиск последней версии драйвера...');
      const release = await this.getLatestReleaseUrl();
      this.emit('log', 'info', `Найдена версия: ${release.version}`);

      // 3. Download to temp
      const tempDir = path.join(os.tmpdir(), 'uvra-driver');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const zipPath = path.join(tempDir, release.name);
      await this.downloadFile(release.url, zipPath);

      // 4. Extract
      const extractDir = path.join(tempDir, 'extracted');
      await this.extractZip(zipPath, extractDir);

      // 5. Find the openglove folder in extracted files
      const opengloveSource = this.findDriverFolder(extractDir);
      if (!opengloveSource) {
        throw new Error('Папка openglove не найдена в архиве');
      }

      // 6. Copy to SteamVR/drivers/
      const targetPath = path.join(driversDir, DRIVER_FOLDER_NAME);
      this.emit('log', 'info', `Установка в: ${targetPath}`);
      this.copyFolderSync(opengloveSource, targetPath);

      // 7. Cleanup temp files
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        // non-critical
      }

      // 8. Configure for Named Pipes
      await this.configureForNamedPipes();

      this.installed = true;
      this.status = 'configured';
      this.driverPath = targetPath;
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
   * Recursively find the openglove driver folder in extracted files
   */
  findDriverFolder(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (item.toLowerCase() === DRIVER_FOLDER_NAME || item.toLowerCase() === 'openglove') {
          // Verify it's a valid driver folder
          if (fs.existsSync(path.join(fullPath, 'driver.vrdrivermanifest'))) {
            return fullPath;
          }
        }
        // Search deeper
        const found = this.findDriverFolder(fullPath);
        if (found) return found;
      }
    }
    return null;
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
   * Writes settings to SteamVR's settings file.
   */
  async configureForNamedPipes() {
    this.emit('log', 'info', 'Настройка драйвера для Named Pipes...');

    // Settings are stored in Steam\config\steamvr.vrsettings
    const settingsPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'openvr', 'steamvr.vrsettings'),
    ];

    // Also try finding via Steam path
    const steamPaths = [
      'C:\\Program Files (x86)\\Steam\\config\\steamvr.vrsettings',
      'C:\\Program Files\\Steam\\config\\steamvr.vrsettings',
    ];

    let settingsPath = null;
    for (const p of [...settingsPaths, ...steamPaths]) {
      if (fs.existsSync(p)) {
        settingsPath = p;
        break;
      }
    }

    // OpenGloves also reads from its own default.vrsettings in the driver folder
    const driverSettingsPath = this.driverPath
      ? path.join(this.driverPath, 'resources', 'settings', 'default.vrsettings')
      : null;

    if (driverSettingsPath && fs.existsSync(driverSettingsPath)) {
      try {
        let settings = JSON.parse(fs.readFileSync(driverSettingsPath, 'utf8'));

        // Set communication method to Named Pipes for both hands
        if (settings['driver_openglove']) {
          settings['driver_openglove']['communication_protocol'] = 'namedpipe';
        }
        // Write settings for left hand
        const leftKey = 'driver_openglove_left';
        if (!settings[leftKey]) settings[leftKey] = {};
        settings[leftKey]['communication_protocol'] = 'namedpipe';
        settings[leftKey]['enabled'] = true;

        // Write settings for right hand
        const rightKey = 'driver_openglove_right';
        if (!settings[rightKey]) settings[rightKey] = {};
        settings[rightKey]['communication_protocol'] = 'namedpipe';
        settings[rightKey]['enabled'] = true;

        fs.writeFileSync(driverSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
        this.emit('log', 'success', 'Настройки драйвера обновлены (Named Pipes)');
      } catch (e) {
        this.emit('log', 'warning', `Не удалось обновить настройки драйвера: ${e.message}`);
      }
    }

    // Also configure global SteamVR settings if found
    if (settingsPath) {
      try {
        let steamSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

        if (!steamSettings['driver_openglove']) {
          steamSettings['driver_openglove'] = {};
        }
        steamSettings['driver_openglove']['communication_protocol'] = 'namedpipe';
        steamSettings['driver_openglove']['left_enabled'] = true;
        steamSettings['driver_openglove']['right_enabled'] = true;

        fs.writeFileSync(settingsPath, JSON.stringify(steamSettings, null, 2), 'utf8');
        this.emit('log', 'success', 'Глобальные настройки SteamVR обновлены');
      } catch (e) {
        this.emit('log', 'warning', `Не удалось обновить steamvr.vrsettings: ${e.message}`);
      }
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
