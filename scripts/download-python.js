/**
 * download-python.js
 *
 * Downloads a portable Python runtime from python-build-standalone
 * and extracts it to desktop/resources/python/.
 *
 * Usage: node scripts/download-python.js
 *
 * The script auto-detects OS and architecture, fetches the latest
 * release info from GitHub, and downloads the matching "install_only"
 * tarball. If GitHub API is unavailable, a fallback URL is used.
 *
 * After extraction, the Python executable is at:
 *   desktop/resources/python/python.exe  (Windows)
 *   desktop/resources/python/bin/python3  (Unix)
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream");
const { promisify } = require("util");
const os = require("os");
const zlib = require("zlib");

const streamPipeline = promisify(pipeline);

// ── Paths ───────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, "..");
const RESOURCES_DIR = path.join(PROJECT_ROOT, "desktop", "resources");
const PYTHON_DIR = path.join(RESOURCES_DIR, "python");
const TEMP_DIR = path.join(RESOURCES_DIR, ".tmp_python");

// ── Platform detection ───────────────────────────────────────────
const PLATFORM = os.platform();   // "win32" | "darwin" | "linux"
const ARCH = os.arch();           // "x64" | "arm64"

const TARGET_TRIPLE = {
  "win32-x64":    "x86_64-pc-windows-msvc",
  "win32-arm64":  "aarch64-pc-windows-msvc",
  "darwin-x64":   "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64":    "x86_64-unknown-linux-gnu",
  "linux-arm64":  "aarch64-unknown-linux-gnu",
}[`${PLATFORM}-${ARCH}`];

const PYTHON_EXE = PLATFORM === "win32" ? "python.exe" : "bin/python3";

// python-build-standalone uses "pc-windows-msvc" for x64 and arm64
// but the shared suffix for the triple is consistent across platforms
const ARCHIVE_EXT = PLATFORM === "win32" ? ".tar.gz" : ".tar.gz";

// ── GitHub API ──────────────────────────────────────────────────
const GITHUB_API = "https://api.github.com/repos/indygreg/python-build-standalone/releases/latest";

// Fallback release tag and version (used when GitHub API is unavailable)
const FALLBACK_RELEASE_TAG = "20250324";
const FALLBACK_PYTHON_VERSION = "3.11.11";

// ── Helpers ──────────────────────────────────────────────────────

function log(msg) {
  console.log(`[download-python] ${msg}`);
}

function warn(msg) {
  console.warn(`[download-python] ⚠  ${msg}`);
}

function error(msg) {
  console.error(`[download-python] ✗  ${msg}`);
}

function assertPlatform() {
  if (!TARGET_TRIPLE) {
    error(`Unsupported platform: ${PLATFORM}-${ARCH}`);
    error("Supported: win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64");
    process.exit(1);
  }
  log(`Platform: ${PLATFORM} ${ARCH} → ${TARGET_TRIPLE}`);
}

/**
 * Fetch JSON from a URL using https.
 */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "cli-proxy-setup/1.0" } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

/**
 * Find the right asset from a GitHub release for our platform.
 * Looks for cpython-3.11.* with "install_only" and the platform triple.
 */
function findAsset(assets, pythonVersionHint) {
  // Sort: prefer 3.11, then 3.12, then any cpython
  const candidates = assets
    .filter((a) => a.name && a.browser_download_url)
    .filter((a) => a.name.includes("install_only"))
    .filter((a) => a.name.includes(TARGET_TRIPLE))
    .filter((a) => a.name.startsWith("cpython-"));

  // Prefer exact Python version match
  const exact = candidates.filter((a) => a.name.includes(`cpython-${pythonVersionHint}`));
  const pool = exact.length > 0 ? exact : candidates;

  if (pool.length === 0) return null;

  // Take the first match (sorted alphabetically for determinism)
  pool.sort((a, b) => a.name.localeCompare(b.name));
  return pool[0];
}

/**
 * Download a file with a simple progress bar.
 */
async function downloadFile(url, destPath) {
  log(`Downloading: ${url}`);
  log(`Destination: ${destPath}`);

  const tmpPath = destPath + ".part";

  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "cli-proxy-setup/1.0" } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }

      const total = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;
      let lastLog = 0;

      const fileStream = createWriteStream(tmpPath);
      res.on("data", (chunk) => {
        downloaded += chunk.length;
        // Log progress every 5 MB or every 2 seconds
        const now = Date.now();
        if (total > 0 && (now - lastLog > 2000 || downloaded - lastLog > 5 * 1024 * 1024)) {
          const pct = ((downloaded / total) * 100).toFixed(1);
          const mb = (downloaded / 1024 / 1024).toFixed(1);
          const totalMb = (total / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${pct}%  ${mb}/${totalMb} MB`);
          lastLog = downloaded;
        } else if (total === 0 && now - lastLog > 2000) {
          const mb = (downloaded / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${mb} MB downloaded...`);
          lastLog = now;
        }
      });
      res.pipe(fileStream);
      fileStream.on("finish", () => {
        process.stdout.write("\n");
        fs.renameSync(tmpPath, destPath);
        log("Download complete.");
        resolve();
      });
      fileStream.on("error", (e) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        reject(e);
      });
    });
    req.on("error", (e) => {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      reject(e);
    });
    req.setTimeout(600000, () => { req.destroy(); reject(new Error("Download timeout (10 min)")); });
  });
}

/**
 * Extract a .tar.gz archive and strip the top-level directory.
 * Uses the system `tar` command (available on Windows 10+, macOS, Linux).
 */
function extractTarGz(archivePath, destDir) {
  log(`Extracting to: ${destDir}`);

  // Clear temp dir
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Extract to temp
  try {
    execSync(`tar -xzf "${archivePath}" -C "${TEMP_DIR}"`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
  } catch (e) {
    error(`tar extraction failed: ${e.stderr ? e.stderr.toString() : e.message}`);
    error("Make sure 'tar' is available on your system (Windows 10+, macOS, Linux all have it).");
    throw e;
  }

  // Strip top-level directory
  const entries = fs.readdirSync(TEMP_DIR);
  const dirs = entries.filter((e) => fs.statSync(path.join(TEMP_DIR, e)).isDirectory());
  const files = entries.filter((e) => fs.statSync(path.join(TEMP_DIR, e)).isFile());

  let sourceDir;
  if (dirs.length === 1 && files.length <= 2) {
    // Standard layout: one directory containing the Python installation
    sourceDir = path.join(TEMP_DIR, dirs[0]);
  } else {
    // Flat layout: files directly in temp
    sourceDir = TEMP_DIR;
  }

  // Move from sourceDir to destDir
  // Clear dest first
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  // Move all contents
  const sources = fs.readdirSync(sourceDir);
  for (const name of sources) {
    const src = path.join(sourceDir, name);
    const dst = path.join(destDir, name);
    fs.renameSync(src, dst);
  }

  // Clean up temp
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  log("Extraction complete.");
}

/**
 * Verify the Python installation.
 */
function verifyPython() {
  const exePath = path.join(PYTHON_DIR, PYTHON_EXE);
  if (!fs.existsSync(exePath)) {
    // Check alternative paths
    const altExe = PLATFORM === "win32"
      ? path.join(PYTHON_DIR, "python.exe")
      : path.join(PYTHON_DIR, "bin", "python3");
    if (fs.existsSync(altExe)) {
      log(`Python found at alternate path: ${altExe}`);
      return altExe;
    }
    error(`Python executable not found at: ${exePath}`);
    error("The archive may have a different internal layout than expected.");
    error(`Contents of ${PYTHON_DIR}:`);
    if (fs.existsSync(PYTHON_DIR)) {
      const topFiles = fs.readdirSync(PYTHON_DIR).slice(0, 20);
      topFiles.forEach((f) => console.error(`  ${f}`));
    }
    return null;
  }

  try {
    const version = execFileSync(exePath, ["--version"], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    log(`Python verified: ${version}`);
  } catch (e) {
    error(`Python --version failed: ${e.stderr ? e.stderr.toString() : e.message}`);
    return null;
  }

  return exePath;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  log("cli-proxy — Python runtime downloader");
  log("=====================================");

  assertPlatform();

  // Check if already installed
  const pythonExe = path.join(PYTHON_DIR, PYTHON_EXE);
  const altPythonExe = PLATFORM === "win32"
    ? path.join(PYTHON_DIR, "python.exe")
    : path.join(PYTHON_DIR, "bin", "python3");

  const alreadyExists = fs.existsSync(pythonExe) || fs.existsSync(altPythonExe);
  if (alreadyExists) {
    log("Python runtime already exists. Verifying...");
    if (verifyPython()) {
      log("Existing Python runtime is valid. Skipping download.");
      log(`To re-download, delete: ${PYTHON_DIR}`);
      return;
    }
    warn("Existing Python runtime is broken. Re-downloading...");
    fs.rmSync(PYTHON_DIR, { recursive: true, force: true });
  }

  // Ensure target directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // ── Step 1: Get release info ──
  log("Fetching latest release info from GitHub...");
  let release;
  let usingFallback = false;

  try {
    release = await fetchJSON(GITHUB_API);
    log(`Latest release: ${release.tag_name}`);
  } catch (e) {
    warn(`GitHub API unavailable (${e.message}). Using fallback release.`);
    usingFallback = true;
    release = {
      tag_name: FALLBACK_RELEASE_TAG,
    };
  }

  // ── Step 2: Find the right asset ──
  let asset;

  if (usingFallback) {
    // Construct a fallback URL directly
    const filename = `cpython-${FALLBACK_PYTHON_VERSION}+${FALLBACK_RELEASE_TAG}-${TARGET_TRIPLE}-install_only.tar.gz`;
    const fallbackUrl = `https://github.com/indygreg/python-build-standalone/releases/download/${FALLBACK_RELEASE_TAG}/${filename}`;
    asset = { name: filename, browser_download_url: fallbackUrl };
    log(`Using fallback asset: ${filename}`);
  } else {
    // Search assets
    const pythonVersion = FALLBACK_PYTHON_VERSION;
    asset = findAsset(release.assets || [], pythonVersion);

    if (!asset) {
      // Try with a different version hint
      warn("No 3.11 asset found, trying 3.12...");
      const alt = findAsset(release.assets || [], "3.12.");
      if (alt) {
        asset = alt;
      }
    }

    if (!asset) {
      warn("Could not find matching asset in release. Trying fallback URL...");
      const filename = `cpython-${FALLBACK_PYTHON_VERSION}+${release.tag_name}-${TARGET_TRIPLE}-install_only.tar.gz`;
      const fallbackUrl = `https://github.com/indygreg/python-build-standalone/releases/download/${release.tag_name}/${filename}`;
      asset = { name: filename, browser_download_url: fallbackUrl };
    }

    if (!asset) {
      error("No suitable asset found for this platform.");
      error(`Platform triple: ${TARGET_TRIPLE}`);
      error("You can manually download a Python runtime and place it at:");
      error(`  ${PYTHON_DIR}`);
      error("Downloads: https://github.com/indygreg/python-build-standalone/releases");
      error("Look for a file with 'install_only' and your platform in the name.");
      process.exit(1);
    }

    log(`Selected asset: ${asset.name}`);
  }

  // ── Step 3: Download ──
  const archiveName = asset.name;
  const archivePath = path.join(RESOURCES_DIR, archiveName);

  const url = asset.browser_download_url;
  log(`Download URL: ${url}`);

  try {
    await downloadFile(url, archivePath);
  } catch (e) {
    error(`Download failed: ${e.message}`);
    error("");
    error("You can manually download the Python runtime:");
    error(`  1. Go to: https://github.com/indygreg/python-build-standalone/releases`);
    error(`  2. Download a file matching: *install_only*${TARGET_TRIPLE}*.tar.gz`);
    error(`  3. Place the archive at: ${RESOURCES_DIR}`);
    error(`  4. Run this script again — it will detect and extract the archive.`);
    // Check if partial download exists and clean up
    try { fs.unlinkSync(archivePath); } catch (_) {}
    try { fs.unlinkSync(archivePath + ".part"); } catch (_) {}
    // Check if there's already a local archive to use
    const existing = fs.readdirSync(RESOURCES_DIR).filter(
      (f) => f.endsWith(".tar.gz") && f.includes("install_only") && f.includes(TARGET_TRIPLE)
    );
    if (existing.length > 0) {
      warn("Found existing archive(s) that could be used:");
      existing.forEach((f) => console.warn(`  ${f}`));
      warn("Deleting the damaged download and re-running this script may work.");
    }
    process.exit(1);
  }

  // ── Step 4: Extract ──
  log("Extracting Python runtime...");
  try {
    extractTarGz(archivePath, PYTHON_DIR);
  } catch (e) {
    error(`Extraction failed: ${e.message}`);
    process.exit(1);
  }

  // ── Step 5: Clean up archive ──
  try {
    fs.unlinkSync(archivePath);
    log("Removed archive file.");
  } catch (e) {
    warn(`Could not remove archive: ${e.message}`);
  }

  // ── Step 6: Verify ──
  const verified = verifyPython();
  if (!verified) {
    error("Python verification failed. The download may be corrupted.");
    error(`Please check: ${PYTHON_DIR}`);
    process.exit(1);
  }

  log("=====================================");
  log("Python runtime installed successfully!");
  log(`Location: ${verified}`);
  log("");
  log("Next step: node scripts/setup-python-deps.js");
}

main().catch((e) => {
  error(`Unexpected error: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
