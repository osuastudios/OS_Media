const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

const DEFAULTS = {
  destDir: null,
  useCookies: false,
  cookiesBrowser: 'firefox',
  sleepInterval: 3,
  filenameTemplate: '%(title)s.%(ext)s',
};

function readSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSettings(partial) {
  const next = { ...readSettings(), ...partial };
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { readSettings, writeSettings };
