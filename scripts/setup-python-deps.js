/**
 * setup-python-deps.js
 *
 * Installs Python dependencies from requirements.txt into the
 * portable Python runtime at desktop/resources/python/.
 *
 * Usage: node scripts/setup-python-deps.js
 *
 * The script locates the Python executable, runs pip install with
 * --target pointing to the correct site-packages directory, and
 * verifies that key packages can be imported.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");
const os = require("os");

// ── Paths ───────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PYTHON_DIR = path.join(PROJECT_ROOT, "desktop", "resources", "python");
const PLATFORM = os.platform();

const PYTHON_EXE = PLATFORM === "win32" ? "python.exe" : "bin/python3";
const PIP_EXE = PLATFORM === "win32"
  ? path.join("Scripts", "pip.exe")
  : path.join("bin", "pip3");

// ── Helpers ──────────────────────────────────────────────────────

function log(msg) {
  console.log(`[setup-deps] ${msg}`);
}

function warn(msg) {
  console.warn(`[setup-deps] ⚠  ${msg}`);
}

function error(msg) {
  console.error(`[setup-deps] ✗  ${msg}`);
}

/**
 * Find the Python executable. Tries several possible paths.
 */
function findPython() {
  const candidates = [
    path.join(PYTHON_DIR, PYTHON_EXE),
    // Alternative layouts
    PLATFORM === "win32" ? path.join(PYTHON_DIR, "python.exe") : null,
    PLATFORM !== "win32" ? path.join(PYTHON_DIR, "bin", "python3") : null,
    // System Python as last resort
    PLATFORM === "win32" ? "python" : "python3",
  ].filter(Boolean);

  for (const exe of candidates) {
    try {
      const version = execFileSync(exe, ["--version"], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      log(`Found Python: ${exe} → ${version}`);
      return exe;
    } catch (_) {
      // try next
    }
  }

  return null;
}

/**
 * Find pip. Tries the bundled pip first, then python -m pip.
 */
function findPip(pythonExe) {
  // Try pip next to python first
  const pipPath = path.join(path.dirname(pythonExe === path.join(PYTHON_DIR, PYTHON_EXE)
    ? PYTHON_DIR : path.dirname(path.dirname(pythonExe))),
    PLATFORM === "win32" ? "Scripts" : "bin",
    PLATFORM === "win32" ? "pip.exe" : "pip3"
  );

  // We'll use "python -m pip" which always works
  return null; // Always use python -m pip for reliability
}

/**
 * Find requirements.txt. Checks several locations.
 */
function findRequirements() {
  const candidates = [
    path.join(PROJECT_ROOT, "requirements.txt"),
    path.join(PROJECT_ROOT, "src", "requirements.txt"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Determine the site-packages target directory for --target.
 */
function getSitePackagesTarget() {
  // For python-build-standalone on Windows the standard Lib/site-packages
  // is inside the python installation directory.
  if (PLATFORM === "win32") {
    return path.join(PYTHON_DIR, "Lib", "site-packages");
  }

  // On Unix, we need to detect the Python version
  try {
    const pythonExe = path.join(PYTHON_DIR, PYTHON_EXE);
    const versionStr = execFileSync(pythonExe, [
      "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    ], { encoding: "utf-8", timeout: 10000 }).trim();
    return path.join(PYTHON_DIR, "lib", `python${versionStr}`, "site-packages");
  } catch (_) {
    // Fallback
    return path.join(PYTHON_DIR, "lib", "python3.11", "site-packages");
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  log("cli-proxy — Python dependency installer");
  log("=======================================");

  // ── Step 1: Find Python ──
  const pythonExe = findPython();
  if (!pythonExe) {
    error("Python runtime not found!");
    error(`Expected at: ${path.join(PYTHON_DIR, PYTHON_EXE)}`);
    error("");
    error("Please run the download script first:");
    error("  node scripts/download-python.js");
    error("");
    error("Or download python-build-standalone manually and place it at:");
    error(`  ${PYTHON_DIR}`);
    process.exit(1);
  }

  // ── Step 2: Find requirements.txt ──
  let requirementsPath = findRequirements();
  if (!requirementsPath) {
    warn("requirements.txt not found in project root. Creating a default one...");
    requirementsPath = path.join(PROJECT_ROOT, "requirements.txt");
    const defaultReqs = [
      "fastapi>=0.115.0",
      "uvicorn[standard]>=0.34.0",
      "httpx>=0.28.0",
      "pyyaml>=6.0",
      "pytest>=8.0",
      "pytest-asyncio>=0.25.0",
    ].join("\n") + "\n";
    fs.writeFileSync(requirementsPath, defaultReqs, "utf-8");
    log(`Created default requirements.txt with ${defaultReqs.split("\n").filter(l => l).length} packages.`);
  }

  const reqContent = fs.readFileSync(requirementsPath, "utf-8");
  const pkgCount = reqContent.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
  log(`Requirements: ${requirementsPath} (${pkgCount} packages)`);

  // ── Step 3: Ensure pip is available ──
  log("Checking pip...");
  try {
    const pipVersion = execFileSync(pythonExe, ["-m", "pip", "--version"], {
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
    log(`pip: ${pipVersion}`);
  } catch (e) {
    error("pip is not available in this Python installation.");
    error(`  ${e.stderr ? e.stderr.toString().trim() : e.message}`);
    error("");
    error("python-build-standalone 'install_only' variants may not include pip.");
    error("Try downloading the full variant instead, or install pip manually:");
    error(`  ${pythonExe} -m ensurepip`);
    process.exit(1);
  }

  // ── Step 4: Determine target directory ──
  const sitePackages = getSitePackagesTarget();
  log(`Target site-packages: ${sitePackages}`);

  // Ensure target directory exists
  fs.mkdirSync(sitePackages, { recursive: true });

  // ── Step 5: Install dependencies ──
  log("Installing dependencies...");
  log(`Command: ${pythonExe} -m pip install -r ${requirementsPath} --target ${sitePackages}`);

  const pipArgs = [
    "-m", "pip", "install",
    "-r", requirementsPath,
    "--target", sitePackages,
    "--no-input",
    "--disable-pip-version-check",
  ];

  try {
    // Stream output in real-time
    execFileSync(pythonExe, pipArgs, {
      encoding: "utf-8",
      stdio: "inherit",
      timeout: 300000, // 5 minutes for pip install
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
    });
    log("pip install completed.");
  } catch (e) {
    error(`pip install failed (exit code ${e.status || "?"}):`);
    if (e.stderr) {
      // Already shown via stdio:inherit, but log key info
      const lines = (typeof e.stderr === "string" ? e.stderr : e.stderr.toString())
        .split("\n").filter((l) => l.includes("ERROR") || l.includes("error"));
      if (lines.length > 0) {
        lines.slice(0, 5).forEach((l) => error(`  ${l.trim()}`));
      }
    }
    error("");
    error("Common fixes:");
    error("  1. Check your internet connection (pip needs to download packages)");
    error("  2. Try with a proxy: set HTTP_PROXY / HTTPS_PROXY environment variables");
    error("  3. Run again: node scripts/setup-python-deps.js");
    process.exit(1);
  }

  // ── Step 6: Verify key packages ──
  log("Verifying installed packages...");
  const verifyPackages = ["fastapi", "uvicorn", "httpx", "yaml"];
  let allOk = true;

  for (const pkg of verifyPackages) {
    const importName = pkg === "yaml" ? "yaml" : pkg;
    try {
      execFileSync(pythonExe, ["-c", `import ${importName}`], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      log(`  ✓ ${pkg}`);
    } catch (e) {
      error(`  ✗ ${pkg} — import failed`);
      allOk = false;
    }
  }

  if (!allOk) {
    warn("Some packages could not be imported. The proxy may not start correctly.");
    warn("Check the pip install output above for errors.");
    warn("You can retry: node scripts/setup-python-deps.js");
  }

  // ── Step 7: Summary ──
  log("=====================================");
  if (allOk) {
    log("All dependencies installed successfully!");
  }
  log(`Python: ${pythonExe}`);
  log(`Site-packages: ${sitePackages}`);
  log("");
  log("You can now run the proxy directly:");
  log(`  ${pythonExe} -m uvicorn src.main:app --host 0.0.0.0 --port 8317`);
}

main().catch((e) => {
  error(`Unexpected error: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
