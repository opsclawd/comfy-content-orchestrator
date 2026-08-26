import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { Buffer } from "node:buffer";
import process from "node:process";
import console from "node:console";

export const REQUIRED_COMPOSE_VARIABLES = Object.freeze([
  "TAILNET_IP",
  "OPERATOR_BIND_IP",
  "CONTROL_API_PORT",
  "REVIEW_HUB_PORT",
  "S3_PORT",
  "MINIO_CONSOLE_PORT",
  "REVIEW_HUB_HOSTNAME",
  "CONTROL_API_HOSTNAME",
  "STORAGE_HOSTNAME",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "DATABASE_MIGRATION_URL",
  "DATABASE_APP_ROLE",
  "DATABASE_URL",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_STORAGE_ENDPOINT",
  "S3_SIGNING_ENDPOINT",
  "CONTROL_API_HOST",
  "CONTROL_API_URL",
  "CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES",
  "STORAGE_TELEMETRY_PATH"
]);

export function isWildcardBinding(hostIp) {
  if (hostIp === undefined || hostIp === null) {
    return true;
  }
  const trimmed = String(hostIp).trim();
  if (trimmed === "") {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower === "0.0.0.0" ||
    lower === "::" ||
    lower === "[::]" ||
    lower === "0:0:0:0:0:0:0:0" ||
    lower === "[0:0:0:0:0:0:0:0]" ||
    lower === "*" ||
    lower === "0" ||
    lower === "0.0.0.0/0" ||
    lower === "::/0"
  ) {
    return true;
  }
  return false;
}

function normalizePortEntry(portEntry) {
  if (typeof portEntry === "object" && portEntry !== null) {
    return {
      target: Number(portEntry.target),
      published: portEntry.published !== undefined ? String(portEntry.published) : undefined,
      protocol: portEntry.protocol || "tcp",
      host_ip: portEntry.host_ip !== undefined ? String(portEntry.host_ip) : undefined
    };
  }

  if (typeof portEntry === "string") {
    // String formats: "127.0.0.1:8000:8000", "8000:8000", "127.0.0.1:8000:8000/tcp"
    const parts = portEntry.split(":");
    if (parts.length === 3) {
      const host_ip = parts[0];
      const published = parts[1];
      const targetAndProto = parts[2].split("/");
      const target = Number(targetAndProto[0]);
      const protocol = targetAndProto[1] || "tcp";
      return { host_ip, published, target, protocol };
    }
    if (parts.length === 2) {
      const published = parts[0];
      const targetAndProto = parts[1].split("/");
      const target = Number(targetAndProto[0]);
      const protocol = targetAndProto[1] || "tcp";
      return { host_ip: undefined, published, target, protocol };
    }
  }

  return { target: 0, published: undefined, host_ip: undefined, protocol: "tcp" };
}

function normalizeVolumeEntry(volumeEntry) {
  if (typeof volumeEntry === "object" && volumeEntry !== null) {
    return {
      type: volumeEntry.type || "volume",
      source: volumeEntry.source,
      target: volumeEntry.target,
      read_only: volumeEntry.read_only === true || volumeEntry.mode === "ro"
    };
  }

  if (typeof volumeEntry === "string") {
    const parts = volumeEntry.split(":");
    if (parts.length >= 2) {
      const source = parts[0];
      const target = parts[1];
      const mode = parts[2];
      return {
        type: "volume",
        source,
        target,
        read_only: mode === "ro"
      };
    }
  }

  return { type: "volume", source: undefined, target: undefined, read_only: false };
}

export function validateControlPlaneModel(model, options = {}) {
  if (!model || typeof model !== "object" || !model.services) {
    throw new Error("Invalid Compose model: missing 'services' definition");
  }

  const { tailnetIp, operatorIp } = options;
  const services = model.services;

  // 1. Check all published ports across all services for wildcard bindings
  for (const [serviceName, service] of Object.entries(services)) {
    if (service.ports && Array.isArray(service.ports)) {
      for (const rawPort of service.ports) {
        const port = normalizePortEntry(rawPort);
        if (isWildcardBinding(port.host_ip)) {
          throw new Error(
            `Service '${serviceName}' published port ${port.target} has wildcard or missing host_ip: '${port.host_ip}'`
          );
        }
      }
    }
  }

  // 2. PostgreSQL and Migrate must have NO published host ports
  const postgres = services.postgres;
  if (!postgres) {
    throw new Error("Compose model missing required 'postgres' service");
  }
  if (postgres.ports && Array.isArray(postgres.ports) && postgres.ports.length > 0) {
    throw new Error(
      "PostgreSQL must be unpublished; postgres service must not publish any host ports"
    );
  }

  const migrate = services.migrate;
  if (!migrate) {
    throw new Error("Compose model missing required 'migrate' service");
  }
  if (migrate.ports && Array.isArray(migrate.ports) && migrate.ports.length > 0) {
    throw new Error("Migration runner must be unpublished; migrate service must not publish ports");
  }

  // 3. PostgreSQL io_method=worker and NO io_workers
  const pgCommand = Array.isArray(postgres.command)
    ? postgres.command.join(" ")
    : String(postgres.command || "");

  if (!pgCommand.includes("io_method=worker")) {
    throw new Error("postgres service must configure io_method=worker in its command arguments");
  }

  if (pgCommand.includes("io_workers")) {
    throw new Error(
      "postgres service must not fix io_workers; io_workers must remain runtime-tuned"
    );
  }

  if (postgres.environment) {
    const envStr = JSON.stringify(postgres.environment);
    if (envStr.includes("io_workers")) {
      throw new Error("postgres service environment must not fix io_workers");
    }
  }

  // 4. MinIO ports: S3 on tailnet IP, Console on operator IP
  const minio = services.minio;
  if (!minio) {
    throw new Error("Compose model missing required 'minio' service");
  }
  const minioPorts = (minio.ports || []).map(normalizePortEntry);
  const s3Port = minioPorts.find((p) => p.target === 9000);
  const consolePort = minioPorts.find((p) => p.target === 9001);

  if (!s3Port) {
    throw new Error("minio service must expose S3 API on target port 9000");
  }
  if (!consolePort) {
    throw new Error("minio service must expose MinIO Console on target port 9001");
  }

  if (tailnetIp && s3Port.host_ip !== tailnetIp) {
    throw new Error(
      `minio S3 API (target 9000) must use reviewer/tailnet IP binding '${tailnetIp}', got '${s3Port.host_ip}'`
    );
  }

  if (operatorIp && consolePort.host_ip !== operatorIp) {
    throw new Error(
      `minio console (target 9001) must use operator IP binding '${operatorIp}', got '${consolePort.host_ip}'`
    );
  }

  if (tailnetIp && operatorIp && tailnetIp !== operatorIp) {
    if (consolePort.host_ip === tailnetIp) {
      throw new Error(
        "minio console (target 9001) must not be bound to tailnet IP; operator binding must be separate"
      );
    }
  }

  // 5. Control API dependencies and ports
  const controlApi = services["control-api"];
  if (!controlApi) {
    throw new Error("Compose model missing required 'control-api' service");
  }

  const apiDeps = controlApi.depends_on || {};
  if (!apiDeps.postgres) {
    throw new Error("control-api service must declare depends_on postgres");
  }
  if (apiDeps.postgres.condition !== "service_healthy") {
    throw new Error(
      `control-api depends_on postgres condition must be 'service_healthy', got '${apiDeps.postgres.condition}'`
    );
  }

  if (!apiDeps.minio) {
    throw new Error("control-api service must declare depends_on minio");
  }
  if (apiDeps.minio.condition !== "service_healthy") {
    throw new Error(
      `control-api depends_on minio condition must be 'service_healthy', got '${apiDeps.minio.condition}'`
    );
  }

  if (!apiDeps.migrate) {
    throw new Error("control-api service must declare depends_on migrate");
  }
  if (apiDeps.migrate.condition !== "service_completed_successfully") {
    throw new Error(
      `control-api depends_on migrate condition must be 'service_completed_successfully', got '${apiDeps.migrate.condition}'`
    );
  }

  // Migrate depends_on postgres service_healthy
  const migrateDeps = migrate.depends_on || {};
  if (!migrateDeps.postgres) {
    throw new Error("migrate service must declare depends_on postgres");
  }
  if (migrateDeps.postgres.condition !== "service_healthy") {
    throw new Error(
      `migrate depends_on postgres condition must be 'service_healthy', got '${migrateDeps.postgres.condition}'`
    );
  }

  // Control API port if published must use tailnet IP
  if (controlApi.ports && Array.isArray(controlApi.ports)) {
    for (const rawPort of controlApi.ports) {
      const port = normalizePortEntry(rawPort);
      if (tailnetIp && port.host_ip !== tailnetIp) {
        throw new Error(
          `control-api published port ${port.target} must use tailnet IP binding '${tailnetIp}', got '${port.host_ip}'`
        );
      }
    }
  }

  // 6. Review Hub dependencies and independence from console
  const reviewHub = services["review-hub"] || services["web"];
  if (!reviewHub) {
    throw new Error("Compose model missing required 'review-hub' service");
  }

  const hubDeps = reviewHub.depends_on || {};
  const depNames = Object.keys(hubDeps);
  if (depNames.length !== 1 || !depNames.includes("control-api")) {
    throw new Error(
      `review-hub must depend only on 'control-api'; found dependencies: [${depNames.join(", ")}]`
    );
  }

  // Check Review Hub config for 9001/console references
  const hubEnv = reviewHub.environment ? JSON.stringify(reviewHub.environment) : "";
  const hubCmd = reviewHub.command ? JSON.stringify(reviewHub.command) : "";
  if (
    hubEnv.includes("9001") ||
    hubCmd.includes("9001") ||
    hubEnv.toLowerCase().includes("console")
  ) {
    throw new Error("review-hub must not contain MinIO console (9001) endpoint/configuration");
  }

  // Review Hub ports must use tailnet IP
  if (reviewHub.ports && Array.isArray(reviewHub.ports)) {
    for (const rawPort of reviewHub.ports) {
      const port = normalizePortEntry(rawPort);
      if (tailnetIp && port.host_ip !== tailnetIp) {
        throw new Error(
          `review-hub published port ${port.target} must use tailnet IP binding '${tailnetIp}', got '${port.host_ip}'`
        );
      }
    }
  }

  // 7. Control API storage telemetry observation volume mount
  let telemetryPath;
  if (controlApi.environment) {
    if (Array.isArray(controlApi.environment)) {
      for (const entry of controlApi.environment) {
        if (typeof entry === "string" && entry.startsWith("STORAGE_TELEMETRY_PATH=")) {
          telemetryPath = entry.slice("STORAGE_TELEMETRY_PATH=".length);
          break;
        }
      }
    } else if (typeof controlApi.environment === "object") {
      telemetryPath = controlApi.environment.STORAGE_TELEMETRY_PATH;
    }
  }

  if (!telemetryPath || String(telemetryPath).trim() === "") {
    throw new Error("control-api service must configure STORAGE_TELEMETRY_PATH in its environment");
  }

  const controlApiVolumes = (controlApi.volumes || []).map(normalizeVolumeEntry);
  const minioDataMount = controlApiVolumes.find((v) => v.source === "minio_data");

  if (!minioDataMount) {
    throw new Error(
      "control-api service missing required 'minio_data' volume mount for storage telemetry"
    );
  }

  if (minioDataMount.target !== telemetryPath) {
    throw new Error(
      `control-api storage telemetry path '${telemetryPath}' does not match minio_data volume mount target '${minioDataMount.target}'`
    );
  }

  if (!minioDataMount.read_only) {
    throw new Error("control-api minio_data volume mount must be read-only");
  }

  return true;
}

export function scanTextForProhibitedHostnames(filePath, content) {
  const violations = [];
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Allowlist documentation, synthetic env example, test fixtures, and checker script itself
  const isAllowlisted =
    normalizedPath === ".env.example" ||
    normalizedPath.startsWith("docs/") ||
    normalizedPath === "README.md" ||
    normalizedPath === "AGENTS.md" ||
    normalizedPath === "compose.yaml" ||
    normalizedPath.endsWith(".test.ts") ||
    normalizedPath.endsWith(".test.js") ||
    normalizedPath.endsWith(".spec.ts") ||
    normalizedPath.endsWith(".spec.js") ||
    normalizedPath.endsWith(".integration.test.ts") ||
    normalizedPath.startsWith("scripts/check-control-plane");

  if (isAllowlisted) {
    return violations;
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("godzspeed-internal.ts.net")) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "no-hardcoded-tailnet-hostname",
        message: `Hardcoded tailnet suffix 'godzspeed-internal.ts.net' found in executable/source file: ${filePath}:${i + 1}`
      });
    }
  }

  return violations;
}

export function scanTextForSecrets(filePath, content) {
  const violations = [];
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Allow synthetic example files and test files with synthetic prefixes
  const isSyntheticAllowedFile =
    normalizedPath === ".env.example" ||
    normalizedPath.endsWith(".test.ts") ||
    normalizedPath.endsWith(".test.js") ||
    normalizedPath.endsWith(".spec.ts") ||
    normalizedPath.endsWith(".spec.js");

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Private Key Header check
    if (/-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/i.test(line)) {
      if (!isSyntheticAllowedFile) {
        violations.push({
          file: filePath,
          line: i + 1,
          rule: "no-private-keys",
          message: `Tracked file contains private key header at ${filePath}:${i + 1}`
        });
      }
    }

    // 2. Tailscale auth key check
    if (/tskey-(?:auth|api)-[0-9a-zA-Z]+/i.test(line)) {
      if (!isSyntheticAllowedFile) {
        violations.push({
          file: filePath,
          line: i + 1,
          rule: "no-tailnet-auth-keys",
          message: `Tracked file contains tailnet auth key pattern at ${filePath}:${i + 1}`
        });
      }
    }

    // 3. Live non-example secrets check (Postgres, MinIO, S3, API secret, etc.)
    if (
      /(?:SECRET|PASSWORD|TOKEN|(?:API|SECRET|ACCESS|AUTH|PRIVATE)_KEY(?:_ID)?)\s*[:=]\s*['"]?(?!synthetic_|test_|mock_)(?!\w+\s*\(|process\.)[a-zA-Z0-9_-]{16,}['"]?/i.test(
        line
      )
    ) {
      if (!isSyntheticAllowedFile) {
        violations.push({
          file: filePath,
          line: i + 1,
          rule: "no-live-credentials",
          message: `Tracked file contains plausible non-example credential at ${filePath}:${i + 1}`
        });
      }
    }
  }

  return violations;
}

export function validateRequiredVariablesOmissionInMemory(envObj) {
  const missing = [];
  for (const key of REQUIRED_COMPOSE_VARIABLES) {
    if (envObj[key] === undefined || envObj[key] === null || String(envObj[key]).trim() === "") {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  return true;
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".tiff",
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".flv",
  ".wmv",
  ".mp3",
  ".wav",
  ".ogg",
  ".aac",
  ".flac",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".wasm",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".pyc",
  ".pyo",
  ".pyd",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot"
]);

export function isBinaryFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return true;
  }

  try {
    const fd = openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(4096);
      const bytesRead = readSync(fd, buffer, 0, 4096, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return true;
        }
      }
      return false;
    } finally {
      closeSync(fd);
    }
  } catch {
    return true;
  }
}

export function scanTrackedFiles(rootDir = process.cwd()) {
  const trackedFilesOutput = execFileSync("git", ["ls-files"], {
    cwd: rootDir,
    encoding: "utf8"
  });

  const files = trackedFilesOutput
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  const allViolations = [];

  for (const relPath of files) {
    const fullPath = resolve(rootDir, relPath);
    if (!existsSync(fullPath)) continue;

    if (isBinaryFile(fullPath)) {
      continue;
    }

    let content = "";
    try {
      content = readFileSync(fullPath, "utf8");
    } catch {
      // Unreadable file, skip text scan
      continue;
    }

    const secretViolations = scanTextForSecrets(relPath, content);
    const hostnameViolations = scanTextForProhibitedHostnames(relPath, content);

    allViolations.push(...secretViolations, ...hostnameViolations);
  }

  return allViolations;
}

export function renderEffectiveComposeModel(envFile = ".env.example", rootDir = process.cwd()) {
  const jsonOutput = execFileSync(
    "docker",
    ["compose", "--env-file", envFile, "-f", "compose.yaml", "config", "--format", "json"],
    {
      cwd: rootDir,
      encoding: "utf8"
    }
  );

  return JSON.parse(jsonOutput);
}

export function parseEnvFile(envFilePath) {
  const content = readFileSync(envFilePath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

export function testRequiredVariableOmissionDocker(rootDir = process.cwd()) {
  const baseEnv = parseEnvFile(resolve(rootDir, ".env.example"));

  for (const varName of REQUIRED_COMPOSE_VARIABLES) {
    const testEnv = { ...process.env, ...baseEnv };
    delete testEnv[varName];

    let threw = false;
    try {
      execFileSync(
        "docker",
        ["compose", "--env-file", "/dev/null", "-f", "compose.yaml", "config", "--format", "json"],
        {
          cwd: rootDir,
          env: testEnv,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        }
      );
    } catch {
      threw = true;
    }

    if (!threw) {
      throw new Error(
        `Docker compose config succeeded when required variable '${varName}' was omitted; expected interpolation error`
      );
    }
  }
}

export function main() {
  console.log("======================================================================");
  console.log("Starting Control-Plane Topology & Security Verification");
  console.log("======================================================================");

  const rootDir = process.cwd();

  // Phase 1: Tracked content scan
  console.log("==> Phase 1: Scanning tracked files for secrets and prohibited hostnames...");
  const violations = scanTrackedFiles(rootDir);
  if (violations.length > 0) {
    console.error(`FAILED: Found ${violations.length} security/hostname violation(s):`);
    for (const v of violations) {
      console.error(`  - [${v.rule}] ${v.message}`);
    }
    process.exit(1);
  }
  console.log("  PASS: No tracked secrets or hardcoded tailnet hostnames found.");

  // Phase 2: Render effective Compose model with .env.example
  console.log("==> Phase 2: Rendering effective Compose model from .env.example...");
  const baseEnv = parseEnvFile(resolve(rootDir, ".env.example"));
  const model = renderEffectiveComposeModel(".env.example", rootDir);
  console.log("  PASS: Compose JSON model rendered successfully.");

  // Phase 3: Topology model validation
  console.log("==> Phase 3: Validating topology model invariants...");
  validateControlPlaneModel(model, {
    tailnetIp: baseEnv.TAILNET_IP,
    operatorIp: baseEnv.OPERATOR_BIND_IP
  });
  console.log(
    "  PASS: All topology invariants verified (non-wildcard bindings, dependency gating, console isolation)."
  );

  // Phase 4: Required variable omission checks
  console.log("==> Phase 4: Testing required variable omission on Compose interpolation...");
  testRequiredVariableOmissionDocker(rootDir);
  console.log(
    `  PASS: All ${REQUIRED_COMPOSE_VARIABLES.length} required variables fail closed when omitted.`
  );

  console.log("======================================================================");
  console.log("All Control-Plane Topology Checks Passed Successfully!");
  console.log("======================================================================");
}

if (process.argv[1] && import.meta.url.endsWith(relative(rootDirForUrl(), process.argv[1]))) {
  main();
}

function rootDirForUrl() {
  return process.cwd();
}
