import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers";
import httpProxy from "http-proxy";

/**
 * Normalizes IPv4 and IPv6 addresses.
 * Mirrors apps/control-api/src/http/reviewer-identity.ts (normalizeIpAddress).
 */
export function normalizeIpAddress(ip) {
  if (typeof ip !== "string") {
    return "";
  }
  const trimmed = ip.trim();
  const ipVersion = net.isIP(trimmed);
  if (ipVersion === 0) {
    return "";
  }
  if (ipVersion === 4) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const v4Candidate = lower.slice(7);
    if (net.isIP(v4Candidate) === 4) {
      return v4Candidate;
    }
  }
  return lower;
}

/**
 * Handles proxy-level errors (client disconnects, backend connection refused/reset).
 * Writes 502 Bad Gateway if the response and socket are writable; otherwise destroys them.
 * Never rethrows or allows 'error' events to crash the process.
 */
export function handleProxyError(err, req, res) {
  const method = req ? req.method : "UNKNOWN";
  const url = req ? req.url : "UNKNOWN";
  console.error(`Proxy error handling ${method} ${url}:`, err);

  const socket = res?.socket ?? req?.socket;
  const isWritable =
    res &&
    !res.headersSent &&
    res.writable === true &&
    !res.writableEnded &&
    !res.destroyed &&
    typeof res.writeHead === "function" &&
    socket?.writable === true &&
    !socket.destroyed;

  if (isWritable) {
    try {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("502 Bad Gateway");
    } catch {
      if (typeof res.destroy === "function") {
        res.destroy();
      }
      if (socket && typeof socket.destroy === "function") {
        socket.destroy();
      }
    }
  } else {
    if (res && typeof res.destroy === "function") {
      res.destroy();
    }
    if (socket && typeof socket.destroy === "function") {
      socket.destroy();
    }
  }
}

export function startPeerProxy(overrides = {}) {
  // 1. Diagnostic-only Tailscale socket access check at boot (never fatal)
  const socketPath =
    overrides.socketPath ||
    process.env.TAILSCALE_SOCKET_PATH ||
    "/var/run/tailscale/tailscaled.sock";
  try {
    fs.accessSync(socketPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    console.warn(
      "WARN: tailscaled socket not accessible at boot — review actions will fail closed with 401 AUTHENTICATION_REQUIRED until scripts/prepare-tailscale-socket-access.sh has been run on the host, see docs/deployment-runbook.md#reviewer-identity-trust-boundary"
    );
  }

  // 2. Child process configuration (pinned internal port 127.0.0.1:3100)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const serverScript =
    overrides.serverScript ||
    process.env.PEER_PROXY_CHILD_SCRIPT ||
    path.join(__dirname, "server.js");

  const INTERNAL_HOST = "127.0.0.1";
  // This is deliberately not configurable: the readiness and trust boundary
  // depend on the child being reachable only on this loopback port.
  const INTERNAL_PORT = 3100;
  const EXTERNAL_PORT = overrides.externalPort || parseInt(process.env.PORT || "3000", 10);

  let childReady = false;

  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      PORT: String(INTERNAL_PORT),
      HOSTNAME: INTERNAL_HOST
    },
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    childReady = false;
    console.error(
      `Child Next.js server exited with code ${code !== null ? code : "null"}, signal ${signal !== null ? signal : "null"}`
    );
    process.exit(code !== null ? code : 1);
  });

  // Forward termination signals to child process
  const handleSignal = (sig) => {
    childReady = false;
    try {
      child.kill(sig);
    } catch {
      // Child may already be dead
    }
  };
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));

  // 3. Child readiness polling: every 50ms up to 10s (10,000ms)
  const startTime = Date.now();
  const MAX_WAIT_MS = 10000;
  const POLL_INTERVAL_MS = 50;

  function pollChildReadiness() {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      console.error(
        `Fatal: Timed out waiting for child Next.js server to become ready on ${INTERNAL_HOST}:${INTERNAL_PORT} after 10 seconds.`
      );
      handleSignal("SIGKILL");
      process.exit(1);
    }

    const socket = net.connect({ host: INTERNAL_HOST, port: INTERNAL_PORT }, () => {
      childReady = true;
      socket.destroy();
      console.log("Child Next.js server is ready. Proxying traffic.");
    });

    socket.on("error", () => {
      socket.destroy();
      setTimeout(pollChildReadiness, POLL_INTERVAL_MS);
    });
  }

  pollChildReadiness();

  // 4. Proxy setup
  const proxy = httpProxy.createProxyServer({
    target: `http://${INTERNAL_HOST}:${INTERNAL_PORT}`,
    xfwd: false
  });

  // Mandatory error listener to prevent unhandled 'error' events crashing the process
  proxy.on("error", (err, req, res) => {
    handleProxyError(err, req, res);
  });

  // Delete-then-set discipline for peer IP header
  proxy.on("proxyReq", (proxyReq, req) => {
    proxyReq.removeHeader("x-cco-tailscale-peer-ip");
    const remoteAddress = req.socket?.remoteAddress;
    if (remoteAddress) {
      const normalized = normalizeIpAddress(remoteAddress);
      if (normalized) {
        proxyReq.setHeader("x-cco-tailscale-peer-ip", normalized);
      }
    }
  });

  // 5. Outer HTTP server
  const server = http.createServer((req, res) => {
    // A client may close its socket while http-proxy is unwinding a failed
    // request. Keep those ordinary stream errors from reaching the process-
    // level fatal handler after the proxy error listener has handled them.
    req.on("error", (err) => {
      console.warn(
        `Proxy request stream closed for ${req.method ?? "UNKNOWN"} ${req.url ?? "UNKNOWN"}:`,
        err
      );
    });
    res.on("error", (err) => {
      console.warn(
        `Proxy response stream closed for ${req.method ?? "UNKNOWN"} ${req.url ?? "UNKNOWN"}:`,
        err
      );
    });

    if (!childReady) {
      res.writeHead(503, {
        "Content-Type": "text/plain",
        "Retry-After": "1"
      });
      res.end("503 Service Unavailable");
      return;
    }

    proxy.web(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (!childReady) {
      socket.destroy();
      return;
    }

    proxy.ws(req, socket, head);
  });

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception in peer-proxy:", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection in peer-proxy:", reason);
    process.exit(1);
  });

  server.listen(EXTERNAL_PORT, "0.0.0.0", () => {
    console.log(`Peer-proxy listening on 0.0.0.0:${EXTERNAL_PORT}`);
  });

  return { server, proxy, child };
}

// Automatically start when executed directly by node
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPeerProxy();
}
