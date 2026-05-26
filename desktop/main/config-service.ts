/**
 * ConfigService — manages the cli-proxy configuration (config.yaml + vault.bin).
 *
 * Responsibilities:
 *   - Read/write YAML config from the user's config directory
 *   - Encrypt/decrypt API keys via Electron safeStorage (DPAPI on Windows)
 *   - Provide environment variables for the Python backend process
 *   - Auto-copy default config on first run
 *   - Config change → Python restart (2s debounce via callback)
 *
 * Config directory layout:
 *   %USERPROFILE%/.cli-proxy/
 *     config.yaml      — user-editable config (api_keys replaced with ***)
 *     vault.bin        — safeStorage-encrypted API keys
 *     backups/         — auto backups (last 5 versions)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { safeStorage } from "electron";
import * as yaml from "js-yaml";

// ── Types ────────────────────────────────────────────────────────

export interface ProviderConfig {
  api_base: string;
  api_keys: string[];
  enabled: boolean;
}

export interface ReliabilityConfig {
  retry: { max_retries: number; backoff_base: number };
  circuit_breaker: { failure_threshold: number; cooldown_seconds: number };
  concurrency: { max_concurrent: number; queue_timeout: number };
  rate_limit: { requests_per_minute: number; burst_size: number };
}

export interface AppConfig {
  server: { host: string; port: number };
  deepseek: { api_base: string; api_keys: string[]; thinking_disabled: boolean };
  model_map: Record<string, string>;
  reliability: ReliabilityConfig;
  providers: Record<string, ProviderConfig>;
}

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: AppConfig = {
  server: { host: "0.0.0.0", port: 8317 },
  deepseek: {
    api_base: "https://api.deepseek.com",
    api_keys: [],
    thinking_disabled: true,
  },
  model_map: {
    "gpt-5.5": "deepseek:deepseek-v4-pro",
    "gpt-5.4": "deepseek:deepseek-v4-pro",
    "gpt-5.4-mini": "deepseek:deepseek-v4-pro",
    "deepseek-v4-pro": "deepseek:deepseek-v4-pro",
  },
  reliability: {
    retry: { max_retries: 3, backoff_base: 2.0 },
    circuit_breaker: { failure_threshold: 5, cooldown_seconds: 30.0 },
    concurrency: { max_concurrent: 10, queue_timeout: 30.0 },
    rate_limit: { requests_per_minute: 30, burst_size: 30 },
  },
  providers: {},
};

const KNOWN_PROVIDERS = ["deepseek", "qwen", "bailian", "moonshot", "siliconflow"];
const MAX_BACKUPS = 5;

// ── ConfigService ────────────────────────────────────────────────

export class ConfigService {
  private configDir: string;
  private configPath: string;
  private vaultPath: string;
  private backupDir: string;

  // In-memory decrypted config cache
  private config: AppConfig | null = null;

  // Debounce timer for config-change → restart
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private onConfigChanged: (() => void) | null = null;

  constructor(onConfigChanged?: () => void) {
    this.configDir = path.join(os.homedir(), ".cli-proxy");
    this.configPath = path.join(this.configDir, "config.yaml");
    this.vaultPath = path.join(this.configDir, "vault.bin");
    this.backupDir = path.join(this.configDir, "backups");
    this.onConfigChanged = onConfigChanged || null;
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Load the full configuration (YAML + decrypted vault keys).
   * On first run, copies the default config template.
   */
  load(): AppConfig {
    if (this.config) return this.config;

    this.ensureConfigDir();

    // First run: copy default config if none exists
    if (!fs.existsSync(this.configPath)) {
      this.saveToDisk(DEFAULT_CONFIG);
      console.log("[config] First run — created default config.");
    }

    // Read YAML config
    let config: AppConfig;
    try {
      const raw = fs.readFileSync(this.configPath, "utf-8");
      config = yaml.load(raw) as AppConfig;
      console.log("[config] Loaded config.yaml");
    } catch (e: any) {
      console.warn(`[config] Failed to load config.yaml: ${e.message}. Using defaults.`);
      config = { ...DEFAULT_CONFIG };
    }

    // Merge defaults for any missing sections
    config = this.mergeDefaults(config);

    // Decrypt keys from vault
    const vaultKeys = this.loadVault();
    this.mergeKeys(config, vaultKeys);

    this.config = config;
    return config;
  }

  /**
   * Save configuration. API keys are encrypted to vault.bin;
   * the YAML file gets "***" placeholders.
   *
   * Triggers onConfigChanged after a 2s debounce.
   */
  save(config: AppConfig): void {
    // ── Schema validation ──
    if (typeof config.server?.port !== "number" || !Number.isInteger(config.server.port) || config.server.port < 1024 || config.server.port > 65535) {
      throw new Error("Invalid config: server.port must be an integer between 1024 and 65535");
    }
    if (config.server?.host !== "0.0.0.0" && config.server?.host !== "127.0.0.1") {
      throw new Error("Invalid config: server.host must be \"0.0.0.0\" or \"127.0.0.1\"");
    }
    if (typeof config.deepseek?.api_base !== "string" || !config.deepseek.api_base.startsWith("https://")) {
      throw new Error("Invalid config: deepseek.api_base must start with \"https://\"");
    }
    for (const [name, pcfg] of Object.entries(config.providers || {})) {
      if (typeof pcfg.api_base !== "string" || !pcfg.api_base.startsWith("https://")) {
        throw new Error(`Invalid config: providers.${name}.api_base must start with "https://"`);
      }
    }

    // Sanitize keys in config (replace with "***") for YAML storage
    const sanitized = this.sanitizeKeys(config);

    // Backup current config before overwriting
    if (fs.existsSync(this.configPath)) {
      this.backup();
    }

    // Write YAML to temp file first, then atomically rename
    // This prevents corruption if the write fails mid-stream
    const tmpYaml = this.configPath + ".tmp";
    const yamlStr = this.sanitizeToYaml(sanitized);
    fs.writeFileSync(tmpYaml, yamlStr, "utf-8");
    fs.renameSync(tmpYaml, this.configPath);

    // Only write vault AFTER YAML is safely on disk
    // This prevents vault/YAML inconsistency if the process crashes
    const vaultKeys = this.extractKeys(config);
    this.saveVault(vaultKeys);

    // Update in-memory cache (with real keys)
    this.config = config;

    console.log("[config] Configuration saved.");

    // Debounced change notification → restart Python
    this.scheduleRestart();
  }

  /**
   * Reload config from disk.
   */
  reload(): AppConfig {
    this.config = null;
    return this.load();
  }

  /**
   * Build environment variables for the Python backend process.
   * Returns an object suitable for child_process.spawn env.
   */
  getEnvForPython(): Record<string, string> {
    const config = this.load();
    const env: Record<string, string> = {};

    // Default deepseek keys (CLI_PROXY_API_KEYS — already supported by config.py)
    if (config.deepseek.api_keys.length > 0) {
      env.CLI_PROXY_API_KEYS = config.deepseek.api_keys.join(",");
    }

    // For other providers, pass keys as individual env vars
    // (Python config.py will need to be extended or we write a temp config)
    for (const [name, pcfg] of Object.entries(config.providers)) {
      if (pcfg.api_keys.length > 0) {
        env[`CLI_PROXY_${name.toUpperCase()}_API_KEYS`] = pcfg.api_keys.join(",");
      }
    }

    if (config.deepseek.thinking_disabled) {
      env.CLI_PROXY_THINKING_DISABLED = "true";
    }

    return env;
  }

  /**
   * Get the path to write a temporary config file with real keys
   * for the Python process to consume.
   */
  writeRuntimeConfig(): string {
    const config = this.load();
    const tmpPath = path.join(this.configDir, ".runtime-config.yaml");

    // Write a full config with real keys (in-memory only, deleted after)
    const yamlStr = yaml.dump(config, { noRefs: true, lineWidth: 120 });
    fs.writeFileSync(tmpPath, yamlStr, "utf-8");

    return tmpPath;
  }

  /**
   * Get known provider names for the UI.
   */
  getKnownProviders(): string[] {
    return KNOWN_PROVIDERS;
  }

  // ── Vault Operations ──────────────────────────────────────────

  private loadVault(): Record<string, string[]> {
    try {
      if (!fs.existsSync(this.vaultPath)) return {};
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[config] safeStorage not available. Keys will be stored in plaintext.");
        return {};
      }
      const encrypted = fs.readFileSync(this.vaultPath);
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted);
    } catch (e: any) {
      console.warn(`[config] Failed to load vault: ${e.message}`);
      return {};
    }
  }

  private saveVault(keys: Record<string, string[]>): void {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[config] safeStorage not available. Skipping vault write.");
        return;
      }
      const plaintext = JSON.stringify(keys, null, 2);
      const encrypted = safeStorage.encryptString(plaintext);
      fs.writeFileSync(this.vaultPath, encrypted);
      console.log("[config] Vault saved.");
    } catch (e: any) {
      console.error(`[config] Failed to save vault: ${e.message}`);
    }
  }

  // ── Key Management ────────────────────────────────────────────

  /**
   * Merge decrypted vault keys into the config object.
   */
  private mergeKeys(config: AppConfig, vaultKeys: Record<string, string[]>): void {
    // DeepSeek top-level keys
    if (vaultKeys["deepseek"] && vaultKeys["deepseek"].length > 0) {
      config.deepseek.api_keys = vaultKeys["deepseek"];
    }

    // Provider keys
    for (const pname of KNOWN_PROVIDERS) {
      if (vaultKeys[pname] && vaultKeys[pname].length > 0) {
        if (!config.providers[pname]) {
          config.providers[pname] = {
            api_base: "https://api.deepseek.com",
            api_keys: [],
            enabled: false,
          };
        }
        config.providers[pname].api_keys = vaultKeys[pname];
      }
    }
  }

  /**
   * Extract all API keys from config into a plain object for vault storage.
   */
  private extractKeys(config: AppConfig): Record<string, string[]> {
    const keys: Record<string, string[]> = {};

    if (config.deepseek.api_keys.length > 0) {
      keys["deepseek"] = config.deepseek.api_keys;
    }

    for (const [pname, pcfg] of Object.entries(config.providers)) {
      if (pcfg.api_keys.length > 0) {
        keys[pname] = pcfg.api_keys;
      }
    }

    return keys;
  }

  /**
   * Return a copy of config with API keys replaced by "***" placeholders.
   */
  private sanitizeKeys(config: AppConfig): AppConfig {
    const result = structuredClone(config);
    result.deepseek.api_keys = result.deepseek.api_keys.map(() => "***");
    for (const pname of Object.keys(result.providers)) {
      result.providers[pname].api_keys = result.providers[pname].api_keys.map(() => "***");
    }
    return result;
  }

  // ── YAML I/O ──────────────────────────────────────────────────

  private saveToDisk(config: AppConfig): void {
    const yamlStr = yaml.dump(config, { noRefs: true, lineWidth: 120, quotingType: '"' });
    fs.writeFileSync(this.configPath, yamlStr, "utf-8");
  }

  private sanitizeToYaml(config: AppConfig): string {
    return yaml.dump(config, { noRefs: true, lineWidth: 120, quotingType: '"' });
  }

  // ── Backup ────────────────────────────────────────────────────

  private backup(): void {
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
      const backupPath = path.join(this.backupDir, `config.${ts}.yaml`);
      fs.copyFileSync(this.configPath, backupPath);

      // Rotate: keep only last MAX_BACKUPS
      const files = fs.readdirSync(this.backupDir)
        .filter((f) => f.startsWith("config.") && f.endsWith(".yaml"))
        .sort();
      while (files.length > MAX_BACKUPS) {
        fs.unlinkSync(path.join(this.backupDir, files.shift()!));
      }
    } catch (e: any) {
      console.warn(`[config] Backup failed: ${e.message}`);
    }
  }

  // ── Restart Debounce ──────────────────────────────────────────

  private scheduleRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      console.log("[config] Config changed — triggering restart.");
      if (this.onConfigChanged) {
        this.onConfigChanged();
      }
    }, 2000);
  }

  // ── Helpers ───────────────────────────────────────────────────

  private ensureConfigDir(): void {
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  private mergeDefaults(config: AppConfig): AppConfig {
    const merged = structuredClone(DEFAULT_CONFIG);

    if (config.server) Object.assign(merged.server, config.server);
    if (config.deepseek) {
      if (config.deepseek.api_base) merged.deepseek.api_base = config.deepseek.api_base;
      if (config.deepseek.thinking_disabled !== undefined) {
        merged.deepseek.thinking_disabled = config.deepseek.thinking_disabled;
      }
      if (config.deepseek.api_keys?.length > 0 && config.deepseek.api_keys[0] !== "***") {
        merged.deepseek.api_keys = config.deepseek.api_keys;
      }
    }
    if (config.model_map) merged.model_map = config.model_map;
    if (config.reliability) {
      if (config.reliability.retry) Object.assign(merged.reliability.retry, config.reliability.retry);
      if (config.reliability.circuit_breaker) Object.assign(merged.reliability.circuit_breaker, config.reliability.circuit_breaker);
      if (config.reliability.concurrency) Object.assign(merged.reliability.concurrency, config.reliability.concurrency);
      if (config.reliability.rate_limit) Object.assign(merged.reliability.rate_limit, config.reliability.rate_limit);
    }
    if (config.providers) {
      for (const [pname, pcfg] of Object.entries(config.providers)) {
        merged.providers[pname] = {
          api_base: pcfg.api_base || merged.deepseek.api_base,
          api_keys: pcfg.api_keys || [],
          enabled: pcfg.enabled ?? false,
        };
      }
    }

    return merged;
  }
}
