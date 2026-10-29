// electron/macSelfUpdater.cjs
// Updates the macOS app without Squirrel.Mac. electron-updater's MacUpdater hands its download to
// Squirrel.Mac, which installs only an update signed by the same Developer ID as the running app;
// these builds carry none, so that path fails at the install step. This one reads the release's
// <channel>-mac.yml, downloads the zip for this Mac's architecture, checks its sha512 and unpacks
// it with ditto; once the app has quit, a small shell script moves the new bundle in place of the
// old one and opens it. It answers the part of electron-updater's autoUpdater that main.cjs uses:
// the same properties, methods and events.

const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { compareVersions } = require('./updateChannels.cjs');

// How often the download reports how far it has come: every chunk would be thousands of messages.
const PROGRESS_INTERVAL_MS = 250;

// Run by /bin/sh once the app is asked to quit: $1 the app's pid, $2 the new bundle, $3 the bundle
// it replaces, $4 the folder the update was unpacked in. It waits up to a minute for the app to
// exit (a quit that does not happen leaves everything as it was), keeps the old bundle until the
// new one is in place and puts it back if that fails, then opens whichever is there.
const INSTALL_SCRIPT = `
pid="$1"; new="$2"; target="$3"; work="$4"
tries=0
while kill -0 "$pid" 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -gt 600 ] && exit 1
  sleep 0.1
done
if mv "$target" "$work/previous.app"; then
  if mv "$new" "$target"; then
    xattr -dr com.apple.quarantine "$target" 2>/dev/null
    rm -rf "$work"
  else
    mv "$work/previous.app" "$target"
  fi
fi
open "$target"
`;

// The part of electron-builder's update metadata used here: the version, and each file's url,
// sha512 and size.
function parseMacUpdateMetadata(text) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1] || '';
  const files = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const item = /^\s*-\s+url:\s*['"]?([^'"]+?)['"]?\s*$/.exec(line);
    if (item) {
      current = { url: item[1], sha512: '', size: 0 };
      files.push(current);
      continue;
    }
    // A key at the start of the line ends the list of files.
    if (!current || /^\S/.test(line)) {
      current = null;
      continue;
    }
    const field = /^\s+(sha512|size):\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (field) {
      current[field[1]] = field[1] === 'size' ? Number(field[2]) : field[2];
    }
  }
  return { version, files };
}

// The zip built for this architecture (artifactName ends in -<arch>.<ext>), never the other one.
function pickMacZip(files, arch) {
  return files.find(file => file.url.endsWith('.zip') && file.url.includes(`-${arch}.`)) || null;
}

// …/Name.app/Contents/MacOS/Name → …/Name.app
function getBundlePath(execPath) {
  const bundlePath = path.resolve(execPath, '..', '..', '..');
  return bundlePath.endsWith('.app') ? bundlePath : null;
}

// The bundle can be swapped only where the listener may write: not from the disk image, nor from
// the read-only copy macOS runs a quarantined app from (App Translocation).
function canReplaceBundle(bundlePath) {
  if (!bundlePath || bundlePath.includes('/AppTranslocation/')) {
    return false;
  }
  try {
    fs.accessSync(bundlePath, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundlePath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim())));
  });
}

function readInfoPlist(bundlePath, key) {
  return run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(bundlePath, 'Contents', 'Info.plist')]);
}

// getSession answers the session the requests go through (main.cjs: the update check's own
// partition, on the system proxy).
function createMacSelfUpdater({ app, getSession, execPath = process.execPath, arch = process.arch }) {
  const updater = new EventEmitter();
  const bundlePath = getBundlePath(execPath);
  let feed = null;
  // The version the last check found, with its zip.
  let found = null;
  // The version unpacked and checked, waiting for quitAndInstall.
  let downloaded = null;
  let downloading = null;

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.channel = 'latest';
  updater.allowPrerelease = false;

  updater.canInstall = () => canReplaceBundle(bundlePath);

  updater.setFeedURL = (config) => {
    feed = config;
  };

  const metadataUrl = () => {
    const name = `${updater.channel || 'latest'}-mac.yml`;
    if (feed?.provider === 'generic') {
      return new URL(name, feed.url).href;
    }
    return `https://github.com/${feed.owner}/${feed.repo}/releases/latest/download/${name}`;
  };

  const fileUrl = (version, url) => {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    if (feed?.provider === 'generic') {
      return new URL(url, feed.url).href;
    }
    return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${version}/${encodeURIComponent(url)}`;
  };

  const request = async (url) => {
    const ses = await getSession();
    const response = await ses.fetch(url, { headers: { 'User-Agent': `Folia/${app.getVersion()}` } });
    if (!response.ok) {
      throw new Error(`Update request failed: ${response.status} ${response.statusText}`);
    }
    return response;
  };

  const fail = (error) => {
    updater.emit('error', error);
    throw error;
  };

  updater.checkForUpdates = async () => {
    if (!feed) {
      return fail(new Error('No update feed is set.'));
    }
    updater.emit('checking-for-update');
    try {
      const metadata = parseMacUpdateMetadata(await (await request(metadataUrl())).text());
      if (!metadata.version) {
        throw new Error('Update metadata did not include a version.');
      }
      const info = { version: metadata.version };
      if (compareVersions(metadata.version, app.getVersion()) <= 0) {
        found = null;
        updater.emit('update-not-available', info);
        return { updateInfo: info };
      }
      const file = pickMacZip(metadata.files, arch);
      if (!file) {
        throw new Error(`Update metadata has no zip for ${arch}.`);
      }
      found = { version: metadata.version, file };
      updater.emit('update-available', info);
      if (updater.autoDownload) {
        // A failed download reports itself through the error event.
        updater.downloadUpdate().catch(() => {});
      }
      return { updateInfo: info };
    } catch (error) {
      return fail(error);
    }
  };

  const download = async ({ version, file }) => {
    const workDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'folia-update-'));
    try {
      const zipPath = path.join(workDir, 'update.zip');
      const response = await request(fileUrl(version, file.url));
      const total = Number(response.headers.get('content-length')) || file.size || 0;
      const hash = crypto.createHash('sha512');
      const output = fs.createWriteStream(zipPath);
      let writeError = null;
      output.on('error', (error) => {
        writeError = error;
      });
      let transferred = 0;
      let reportedAt = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (writeError) throw writeError;
        hash.update(value);
        transferred += value.length;
        if (!output.write(value)) {
          await new Promise(resolve => output.once('drain', resolve));
        }
        if (Date.now() - reportedAt >= PROGRESS_INTERVAL_MS) {
          reportedAt = Date.now();
          updater.emit('download-progress', { percent: total ? (transferred / total) * 100 : 0, transferred, total });
        }
      }
      await new Promise((resolve, reject) => {
        output.once('error', reject);
        output.end(resolve);
      });
      if (writeError) throw writeError;
      updater.emit('download-progress', { percent: 100, transferred, total: total || transferred });
      if (file.sha512 && hash.digest('base64') !== file.sha512) {
        throw new Error('The downloaded update does not match its sha512.');
      }

      // ditto keeps the bundle's symlinks and signature as they were zipped.
      const unpacked = path.join(workDir, 'unpacked');
      await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked]);
      await fs.promises.rm(zipPath, { force: true });
      const appName = (await fs.promises.readdir(unpacked)).find(name => name.endsWith('.app'));
      if (!appName) {
        throw new Error('The update has no app in it.');
      }
      const appPath = path.join(unpacked, appName);
      // The same app, at the version the metadata named.
      const [identifier, ownIdentifier, shortVersion] = await Promise.all([
        readInfoPlist(appPath, 'CFBundleIdentifier'),
        readInfoPlist(bundlePath, 'CFBundleIdentifier'),
        readInfoPlist(appPath, 'CFBundleShortVersionString'),
      ]);
      if (identifier !== ownIdentifier) {
        throw new Error(`The update is another app (${identifier}).`);
      }
      if (compareVersions(shortVersion, version) !== 0) {
        throw new Error(`The update is version ${shortVersion}, not ${version}.`);
      }

      if (downloaded) {
        fs.promises.rm(downloaded.workDir, { recursive: true, force: true }).catch(() => {});
      }
      downloaded = { version, appPath, workDir };
      updater.emit('update-downloaded', { version });
      return [appPath];
    } catch (error) {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      return fail(error);
    }
  };

  updater.downloadUpdate = () => {
    if (!found) {
      return Promise.reject(new Error('No update has been found to download.'));
    }
    if (downloaded?.version === found.version) {
      updater.emit('update-downloaded', { version: downloaded.version });
      return Promise.resolve([downloaded.appPath]);
    }
    if (!downloading) {
      downloading = download(found).finally(() => {
        downloading = null;
      });
    }
    return downloading;
  };

  updater.quitAndInstall = () => {
    if (!downloaded || !canReplaceBundle(bundlePath)) {
      return;
    }
    const child = spawn(
      '/bin/sh',
      ['-c', INSTALL_SCRIPT, 'folia-update', String(process.pid), downloaded.appPath, bundlePath, downloaded.workDir],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    app.quit();
  };

  return updater;
}

module.exports = {
  canReplaceBundle,
  createMacSelfUpdater,
  getBundlePath,
  parseMacUpdateMetadata,
  pickMacZip,
};
