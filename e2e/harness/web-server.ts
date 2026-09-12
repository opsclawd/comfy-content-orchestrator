import { spawn, type ChildProcess, execSync } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { existsSync, statSync, readdirSync } from "node:fs";

export interface TestWebServer {
  webUrl: string;
  teardown: () => Promise<void>;
}

function shouldRebuildWeb(webAppDir: string, forceRebuild?: boolean): boolean {
  if (forceRebuild || process.env.FORCE_REBUILD === "true") {
    return true;
  }
  const buildIdPath = resolve(webAppDir, ".next/BUILD_ID");
  if (!existsSync(buildIdPath)) {
    return true;
  }
  const buildMtime = statSync(buildIdPath).mtimeMs;
  function checkDir(dir: string): boolean {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (checkDir(fullPath)) return true;
      } else if (entry.isFile()) {
        if (statSync(fullPath).mtimeMs > buildMtime) return true;
      }
    }
    return false;
  }
  return checkDir(resolve(webAppDir, "src"));
}

async function getAvailablePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close((err) => {
        if (err) rej(err);
        else res(port);
      });
    });
  });
}

export async function startTestWebServer(options: {
  controlApiBaseUrl: string;
  repoRoot?: string;
  forceRebuild?: boolean;
}): Promise<TestWebServer> {
  const repoRoot = options.repoRoot ?? resolve(import.meta.dirname, "../..");
  const webAppDir = resolve(repoRoot, "apps/web");

  // Rebuild apps/web if .next is missing, forceRebuild is requested, or source files are newer
  if (shouldRebuildWeb(webAppDir, options.forceRebuild)) {
    execSync("pnpm --filter web build", {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        CONTROL_API_URL: options.controlApiBaseUrl
      }
    });
  }

  const port = await getAvailablePort();
  const webUrl = `http://127.0.0.1:${port}`;

  const mockBinDir = resolve(repoRoot, "e2e/harness/mock-bin");
  const mockTailscalePath = resolve(mockBinDir, "tailscale");

  const serverProcess: ChildProcess = spawn(
    "pnpm",
    ["--filter", "web", "start", "-p", String(port)],
    {
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${mockBinDir}:${process.env.PATH}`,
        TAILSCALE_BIN_PATH: mockTailscalePath,
        PORT: String(port),
        CONTROL_API_URL: options.controlApiBaseUrl,
        NODE_ENV: "production"
      }
    }
  );

  const maxAttempts = 60;
  let ready = false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${webUrl}/api/healthz`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ready) {
    serverProcess.kill("SIGKILL");
    throw new Error(`Web server failed to become ready at ${webUrl} within 30 seconds`);
  }

  return {
    webUrl,
    teardown: async () => {
      serverProcess.kill("SIGTERM");
      await new Promise<void>((r) => {
        serverProcess.on("exit", () => r());
        setTimeout(() => {
          serverProcess.kill("SIGKILL");
          r();
        }, 3000);
      });
    }
  };
}
