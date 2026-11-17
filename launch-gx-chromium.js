const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execSync } = require('child_process');

const ROOT_DIR = __dirname;
const RUNTIME_DIR = path.join(ROOT_DIR, 'chromium-runtime');
const PROFILE_DIR = path.join(ROOT_DIR, 'gx-chromium-profile');
const EXT_DIR = path.join(ROOT_DIR, 'gx-extension');
const THEME_DIR = path.join(ROOT_DIR, 'gx-theme');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      let lastPct = -1;
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.floor((downloaded / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            lastPct = pct;
            process.stdout.write(`\rDownloading Official Full Chromium Browser: ${pct}% (${Math.round(downloaded / 1048576)} / ${Math.round(total / 1048576)} MB)`);
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\n');
          resolve();
        });
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function getPlatformKey() {
  if (process.platform === 'win32') return 'win64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux64';
}

function findChromeBinary() {
  const platformKey = getPlatformKey();
  const subDir = path.join(RUNTIME_DIR, `chrome-${platformKey}`);
  const binName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
  const candidate = path.join(subDir, binName);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

async function ensureChromiumBinary() {
  const existing = findChromeBinary();
  if (existing) return existing;

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  console.log('Fetching latest official Chromium (Chrome for Testing) release info...');
  const data = await fetchJson(
    'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'
  );
  const platformKey = getPlatformKey();
  const downloads = data.channels.Stable.downloads.chrome;
  const entry = downloads.find((d) => d.platform === platformKey);
  if (!entry) {
    throw new Error(`No pre-built Chromium found for platform: ${platformKey}`);
  }

  const zipPath = path.join(RUNTIME_DIR, `chrome-${platformKey}.zip`);
  console.log(`Downloading Chromium v${data.channels.Stable.version} from ${entry.url}...`);
  await downloadFile(entry.url, zipPath);

  console.log('Extracting Full Chromium Browser...');
  if (process.platform === 'win32') {
    execSync(`powershell -command "Expand-Archive -Force '${zipPath}' '${RUNTIME_DIR}'"`, { stdio: 'inherit' });
  } else {
    execSync(
      `python3 -c "import zipfile, os, stat; z=zipfile.ZipFile('${zipPath}'); z.extractall('${RUNTIME_DIR}'); [os.chmod(os.path.join('${RUNTIME_DIR}', i.filename), i.external_attr >> 16) for i in z.infolist() if (i.external_attr >> 16) > 0]"`,
      { stdio: 'inherit' }
    );
  }
  fs.unlinkSync(zipPath);

  const bin = findChromeBinary();
  if (!bin) throw new Error('Extraction completed, but chrome binary was not found.');
  if (process.platform !== 'win32') {
    fs.chmodSync(bin, 0o755);
  }
  return bin;
}

function configureProfilePreferences() {
  const defaultDir = path.join(PROFILE_DIR, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  const prefFile = path.join(defaultDir, 'Preferences');

  let prefs = {};
  if (fs.existsSync(prefFile)) {
    try {
      prefs = JSON.parse(fs.readFileSync(prefFile, 'utf-8'));
    } catch (_) {
      prefs = {};
    }
  }

  // Configure Native Side Panel on the LEFT side (Opera GX style) while Chrome 3-Dot menu stays on the RIGHT!
  prefs.side_panel = {
    ...(prefs.side_panel || {}),
    is_right_aligned: false
  };

  prefs.browser = {
    ...(prefs.browser || {}),
    has_seen_welcome_page: true,
    check_default_browser: false
  };

  fs.writeFileSync(prefFile, JSON.stringify(prefs, null, 2), 'utf-8');
}

async function main() {
  const chromeBin = await ensureChromiumBinary();
  configureProfilePreferences();

  const args = [
    `--user-data-dir=${PROFILE_DIR}`,
    `--load-extension=${THEME_DIR},${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-infobars',
    '--no-sandbox',
    'chrome://newtab'
  ];

  console.log('Launching GX Chromium Browser:', chromeBin);
  const child = spawn(chromeBin, args, {
    stdio: 'ignore',
    detached: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined
    }
  });
  child.unref();
  console.log('GX Chromium Browser launched successfully! (PID:', child.pid, ')');
}

main().catch((err) => {
  console.error('Failed to launch GX Chromium Browser:', err);
  process.exit(1);
});
