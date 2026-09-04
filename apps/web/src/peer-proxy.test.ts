import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { normalizeIpAddress, handleProxyError } from "../peer-proxy.mjs";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () => {
      const s2 = net.createServer();
      s2.once("error", reject);
      s2.listen(0, () => {
        const address = s2.address();
        if (!address || typeof address === "string") {
          s2.close(() => reject(new Error("Unable to determine free port")));
          return;
        }
        const port = address.port;
        s2.close(() => resolve(port));
      });
    });
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      if (!address || typeof address === "string") {
        s.close(() => reject(new Error("Unable to determine free port")));
        return;
      }
      const port = address.port;
      s.close(() => resolve(port));
    });
  });
}

async function waitForPortFree(port: number, host = "127.0.0.1"): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const isFree = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(port, host, () => {
        s.close(() => resolve(true));
      });
    });
    if (isFree) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function stopProxy(proxyProc: ReturnType<typeof spawn>): Promise<void> {
  if (proxyProc.exitCode === null) {
    proxyProc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      proxyProc.once("exit", () => resolve());
      setTimeout(() => {
        try {
          proxyProc.kill("SIGKILL");
        } catch {
          // ignore
        }
        resolve();
      }, 3000);
    });
  }
  await waitForPortFree(3100);
}

describe("normalizeIpAddress", () => {
  it("normalizes IPv4 addresses", () => {
    expect(normalizeIpAddress("192.168.1.1")).toBe("192.168.1.1");
    expect(normalizeIpAddress("  10.0.0.1  ")).toBe("10.0.0.1");
    expect(normalizeIpAddress("127.0.0.1")).toBe("127.0.0.1");
  });

  it("normalizes IPv6 addresses", () => {
    expect(normalizeIpAddress("::1")).toBe("::1");
    expect(normalizeIpAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
    );
  });

  it("unmaps IPv4-mapped IPv6 addresses to pure IPv4", () => {
    expect(normalizeIpAddress("::ffff:192.168.1.1")).toBe("192.168.1.1");
    expect(normalizeIpAddress("::FFFF:10.0.0.2")).toBe("10.0.0.2");
    expect(normalizeIpAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIpAddress("::ffff:172.28.0.10")).toBe("172.28.0.10");
  });

  it("returns empty string for invalid IPs or non-string inputs", () => {
    expect(normalizeIpAddress("")).toBe("");
    expect(normalizeIpAddress("not-an-ip")).toBe("");
    expect(normalizeIpAddress("999.999.999.999")).toBe("");
    expect(normalizeIpAddress(null as unknown as string)).toBe("");
    expect(normalizeIpAddress(undefined as unknown as string)).toBe("");
  });
});

describe("handleProxyError unit branches", () => {
  it("writes 502 Bad Gateway when response and socket are writable", () => {
    const writeHead = vi.fn();
    const end = vi.fn();
    const resDestroy = vi.fn();
    const socketDestroy = vi.fn();

    const res = {
      headersSent: false,
      writable: true,
      writableEnded: false,
      destroyed: false,
      writeHead,
      end,
      destroy: resDestroy,
      socket: {
        writable: true,
        destroyed: false,
        destroy: socketDestroy
      }
    };

    handleProxyError(new Error("backend dropped"), { method: "GET", url: "/api/test" }, res);

    expect(writeHead).toHaveBeenCalledWith(502, { "Content-Type": "text/plain" });
    expect(end).toHaveBeenCalledWith("502 Bad Gateway");
    expect(resDestroy).not.toHaveBeenCalled();
    expect(socketDestroy).not.toHaveBeenCalled();
  });

  it("destroys response and socket without writing 502 when res.destroyed is true", () => {
    const writeHead = vi.fn();
    const end = vi.fn();
    const resDestroy = vi.fn();
    const socketDestroy = vi.fn();

    const res = {
      headersSent: false,
      writable: true,
      writableEnded: false,
      destroyed: true,
      writeHead,
      end,
      destroy: resDestroy,
      socket: {
        writable: true,
        destroyed: false,
        destroy: socketDestroy
      }
    };

    handleProxyError(new Error("client aborted"), { method: "POST", url: "/upload" }, res);

    expect(writeHead).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(resDestroy).toHaveBeenCalled();
    expect(socketDestroy).toHaveBeenCalled();
  });

  it("destroys response and socket without writing 502 when res.headersSent is true", () => {
    const writeHead = vi.fn();
    const end = vi.fn();
    const resDestroy = vi.fn();
    const socketDestroy = vi.fn();

    const res = {
      headersSent: true,
      writable: true,
      writableEnded: false,
      destroyed: false,
      writeHead,
      end,
      destroy: resDestroy,
      socket: {
        writable: true,
        destroyed: false,
        destroy: socketDestroy
      }
    };

    handleProxyError(new Error("reset mid-stream"), { method: "GET", url: "/stream" }, res);

    expect(writeHead).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(resDestroy).toHaveBeenCalled();
    expect(socketDestroy).toHaveBeenCalled();
  });

  it("destroys response and socket when res.writable is false", () => {
    const writeHead = vi.fn();
    const resDestroy = vi.fn();
    const socketDestroy = vi.fn();

    const res = {
      headersSent: false,
      writable: false,
      writableEnded: false,
      destroyed: false,
      writeHead,
      destroy: resDestroy,
      socket: {
        writable: true,
        destroyed: false,
        destroy: socketDestroy
      }
    };

    handleProxyError(new Error("socket closed"), { method: "GET", url: "/api" }, res);

    expect(writeHead).not.toHaveBeenCalled();
    expect(resDestroy).toHaveBeenCalled();
    expect(socketDestroy).toHaveBeenCalled();
  });

  it("destroys response and socket when res.writableEnded is true", () => {
    const writeHead = vi.fn();
    const resDestroy = vi.fn();
    const socketDestroy = vi.fn();

    const res = {
      headersSent: false,
      writable: true,
      writableEnded: true,
      destroyed: false,
      writeHead,
      destroy: resDestroy,
      socket: {
        writable: true,
        destroyed: false,
        destroy: socketDestroy
      }
    };

    handleProxyError(new Error("late error"), { method: "GET", url: "/api" }, res);

    expect(writeHead).not.toHaveBeenCalled();
    expect(resDestroy).toHaveBeenCalled();
    expect(socketDestroy).toHaveBeenCalled();
  });

  it("destroys response and socket when socket is not writable or destroyed", () => {
    const writeHead = vi.fn();
    const resDestroy = vi.fn();
    const socketDestroy = vi.fn();

    const res = {
      headersSent: false,
      writable: true,
      writableEnded: false,
      destroyed: false,
      writeHead,
      destroy: resDestroy,
      socket: {
        writable: false,
        destroyed: true,
        destroy: socketDestroy
      }
    };

    handleProxyError(new Error("socket destroyed"), { method: "GET", url: "/api" }, res);

    expect(writeHead).not.toHaveBeenCalled();
    expect(resDestroy).toHaveBeenCalled();
    expect(socketDestroy).toHaveBeenCalled();
  });

  it("catches writeHead exceptions and falls back to destroy without throwing", () => {
    const resDestroy = vi.fn();
    const socketDestroy = vi.fn();

    const res = {
      headersSent: false,
      writable: true,
      writableEnded: false,
      destroyed: false,
      writeHead: () => {
        throw new Error("Socket write failed");
      },
      destroy: resDestroy,
      socket: {
        writable: true,
        destroyed: false,
        destroy: socketDestroy
      }
    };

    expect(() => {
      handleProxyError(new Error("original err"), { method: "GET", url: "/api" }, res);
    }).not.toThrow();

    expect(resDestroy).toHaveBeenCalled();
    expect(socketDestroy).toHaveBeenCalled();
  });

  it("handles null or undefined response by destroying request socket safely", () => {
    const socketDestroy = vi.fn();
    const req = {
      method: "GET",
      url: "/ws",
      socket: {
        destroy: socketDestroy
      }
    };

    expect(() => {
      handleProxyError(new Error("upgrade error"), req, null);
    }).not.toThrow();

    expect(socketDestroy).toHaveBeenCalled();
  });
});

describe("peer-proxy process-level integration", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const tmpDir = path.join(repoRoot, ".ai-tmp", `peer-proxy-test-${Date.now()}`);
  const mockChildScript = path.join(tmpDir, "mock-child.mjs");
  const peerProxyScript = path.join(repoRoot, "apps/web/peer-proxy.mjs");

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });

    // Controllable mock child server
    const mockChildCode = `
import http from "node:http";

const port = parseInt(process.env.PORT || "3100", 10);
const delayMs = parseInt(process.env.DELAY_START_MS || "0", 10);

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url === "/echo-headers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(req.headers));
    return;
  }

  if (req.url === "/slow") {
    // Delay sending response so client can abort
    setTimeout(() => {
      if (!res.writableEnded) {
        try {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("slow-done");
        } catch {}
      }
    }, 500);
    return;
  }

  if (req.url === "/reset-connection") {
    // Abruptly destroy backend socket mid-request to simulate backend failure
    req.socket.destroy();
    return;
  }

  if (req.url === "/crash-child") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("crashing");
    setTimeout(() => {
      process.exit(42);
    }, 50);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("mock-response");
});

setTimeout(() => {
  server.listen(port, "127.0.0.1", () => {
    console.log(\`Mock child listening on 127.0.0.1:\${port}\`);
  });
}, delayMs);
`;
    fs.writeFileSync(mockChildScript, mockChildCode, "utf-8");
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    await waitForPortFree(3100);
  });

  it("returns 503 with Retry-After: 1 before readiness, then transitions to 200", async () => {
    const externalPort = await getFreePort();
    const proxyProc = spawn("node", [peerProxyScript], {
      env: {
        ...process.env,
        PORT: String(externalPort),
        PEER_PROXY_CHILD_SCRIPT: mockChildScript,
        DELAY_START_MS: "600"
      },
      stdio: "pipe"
    });

    try {
      // 1. Immediate request while child is delaying startup: should receive 503
      let earlyResponseReceived = false;
      const startEarly = Date.now();
      while (Date.now() - startEarly < 2000) {
        try {
          const res = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
          if (res.status === 503) {
            expect(res.headers.get("retry-after")).toBe("1");
            const body = await res.text();
            expect(body).toBe("503 Service Unavailable");
            earlyResponseReceived = true;
            break;
          }
        } catch {
          // Socket might still be connecting
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(earlyResponseReceived).toBe(true);

      // 2. Poll until child becomes ready and responds 200
      let readyResponse = false;
      const startPoll = Date.now();
      while (Date.now() - startPoll < 3000) {
        try {
          const res = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
          if (res.status === 200) {
            const data = (await res.json()) as { status: string };
            expect(data.status).toBe("ok");
            readyResponse = true;
            break;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(readyResponse).toBe(true);
    } finally {
      await stopProxy(proxyProc);
    }
  });

  it("strips forged x-cco-tailscale-peer-ip and sets normalized real peer IP", async () => {
    const externalPort = await getFreePort();
    const proxyProc = spawn("node", [peerProxyScript], {
      env: {
        ...process.env,
        PORT: String(externalPort),
        PEER_PROXY_CHILD_SCRIPT: mockChildScript,
        DELAY_START_MS: "0"
      },
      stdio: "pipe"
    });

    try {
      // Wait for ready
      const startWait = Date.now();
      let ready = false;
      while (Date.now() - startWait < 3000) {
        try {
          const res = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
          if (res.status === 200) {
            ready = true;
            break;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(ready).toBe(true);

      // Send request with forged peer IP header
      const res = await fetch(`http://127.0.0.1:${externalPort}/echo-headers`, {
        headers: {
          "x-cco-tailscale-peer-ip": "100.64.0.99"
        }
      });
      expect(res.status).toBe(200);
      const headers = (await res.json()) as Record<string, string>;

      // The backend must observe 127.0.0.1 (real socket remoteAddress), NOT the forged 100.64.0.99
      expect(headers["x-cco-tailscale-peer-ip"]).toBe("127.0.0.1");
    } finally {
      await stopProxy(proxyProc);
    }
  });

  it("handles client abort before headers gracefully and keeps proxy alive", async () => {
    const externalPort = await getFreePort();
    const proxyProc = spawn("node", [peerProxyScript], {
      env: {
        ...process.env,
        PORT: String(externalPort),
        PEER_PROXY_CHILD_SCRIPT: mockChildScript,
        DELAY_START_MS: "0"
      },
      stdio: "pipe"
    });

    try {
      // Wait for ready
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
          if (res.status === 200) {
            ready = true;
            break;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(ready).toBe(true);

      // Client connects, sends request to /slow, and abruptly destroys socket before headers
      await new Promise<void>((resolve) => {
        const client = net.connect({ host: "127.0.0.1", port: externalPort }, () => {
          client.write("GET /slow HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
          // Destroy connection abruptly after 50ms (before /slow returns at 500ms)
          setTimeout(() => {
            client.destroy();
            resolve();
          }, 50);
        });
      });

      // Wait a bit for proxy error handler to run
      await new Promise((r) => setTimeout(r, 200));

      // Proxy process must still be alive!
      expect(proxyProc.exitCode).toBeNull();

      // Subsequent request to proxy must still succeed
      const resAfter = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
      expect(resAfter.status).toBe(200);
      const data = (await resAfter.json()) as { status: string };
      expect(data.status).toBe("ok");
    } finally {
      await stopProxy(proxyProc);
    }
  });

  it("handles controllable backend connection drop, returns 502, and proxy survives", async () => {
    const externalPort = await getFreePort();
    const proxyProc = spawn("node", [peerProxyScript], {
      env: {
        ...process.env,
        PORT: String(externalPort),
        PEER_PROXY_CHILD_SCRIPT: mockChildScript,
        DELAY_START_MS: "0"
      },
      stdio: "pipe"
    });

    try {
      // Wait for ready
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
          if (res.status === 200) {
            ready = true;
            break;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(ready).toBe(true);

      // Send request to /reset-connection where child resets socket abruptly
      const res = await fetch(`http://127.0.0.1:${externalPort}/reset-connection`);
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).toBe("502 Bad Gateway");

      // Proxy process must still be alive!
      expect(proxyProc.exitCode).toBeNull();

      // Subsequent request to proxy must still succeed
      const resAfter = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
      expect(resAfter.status).toBe(200);
      const data = (await resAfter.json()) as { status: string };
      expect(data.status).toBe("ok");
    } finally {
      await stopProxy(proxyProc);
    }
  });

  it("exits with child exit code when child process dies", async () => {
    const externalPort = await getFreePort();
    const proxyProc = spawn("node", [peerProxyScript], {
      env: {
        ...process.env,
        PORT: String(externalPort),
        PEER_PROXY_CHILD_SCRIPT: mockChildScript,
        DELAY_START_MS: "0"
      },
      stdio: "pipe"
    });

    try {
      // Wait for ready
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${externalPort}/healthz`);
          if (res.status === 200) {
            ready = true;
            break;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(ready).toBe(true);

      // Trigger child exit (code 42)
      await fetch(`http://127.0.0.1:${externalPort}/crash-child`);

      // Proxy process should exit with the same code (42)
      const exitCode = await new Promise<number | null>((resolve) => {
        proxyProc.on("exit", (code) => resolve(code));
        setTimeout(() => resolve(proxyProc.exitCode), 2000);
      });

      expect(exitCode).toBe(42);
    } finally {
      await stopProxy(proxyProc);
    }
  });
});
