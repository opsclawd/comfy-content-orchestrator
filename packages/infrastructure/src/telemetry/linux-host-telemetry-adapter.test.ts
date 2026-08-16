import { describe, expect, it } from "vitest";
import {
  LinuxHostTelemetryAdapter,
  LinuxHostTelemetryError,
  parseProcMeminfo,
  parseProcPidStat,
  parseProcPidStatus,
  parseProcVmstat
} from "./linux-host-telemetry-adapter.js";

describe("LinuxHostTelemetryAdapter and Proc Parsers", () => {
  const sampleMeminfo = [
    "MemTotal:       67108864 kB",
    "MemFree:        16777216 kB",
    "MemAvailable:   33554432 kB",
    "Buffers:         1048576 kB",
    "Cached:          8388608 kB",
    "SwapTotal:      16777216 kB",
    "SwapFree:       12582912 kB"
  ].join("\n");

  const sampleVmstat = [
    "nr_free_pages 4194304",
    "nr_inactive_anon 524288",
    "nr_active_anon 1048576",
    "pswpin 12",
    "pswpout 34",
    "pgfault 987654",
    "pgmajfault 567"
  ].join("\n");

  const sampleStatus = [
    "Name:\tpython3",
    "Umask:\t0022",
    "State:\tS (sleeping)",
    "Tgid:\t12345",
    "Ngid:\t0",
    "Pid:\t12345",
    "PPid:\t1",
    "VmPeak:\t 4194304 kB",
    "VmSize:\t 3145728 kB",
    "VmHWM:\t 2097152 kB",
    "VmRSS:\t 2097152 kB",
    "RssAnon:\t 1572864 kB",
    "RssFile:\t  524288 kB"
  ].join("\n");

  // /proc/<pid>/stat fields:
  // 1: pid=12345
  // 2: comm=(python3)
  // 3: state=S
  // 4..9: 1 12345 12345 0 -1 4194304
  // 10: minflt=123456
  // 11: cminflt=0
  // 12: majflt=789
  // 13..21: 0 500 200 0 0 20 0 16 0
  // 22: starttime=9876543
  const sampleStat =
    "12345 (python3) S 1 12345 12345 0 -1 4194304 123456 0 789 0 500 200 0 0 20 0 16 0 9876543 1000000 5000 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0 0";

  // Behavioral invariant: linux-units-are-normalized
  it("normalizes meminfo RAM swap and RSS values to MB", async () => {
    const mockFiles: Record<string, string> = {
      "/proc/meminfo": sampleMeminfo,
      "/proc/vmstat": sampleVmstat,
      "/proc/12345/status": sampleStatus,
      "/proc/12345/stat": sampleStat
    };

    const adapter = new LinuxHostTelemetryAdapter({
      pid: 12345,
      readFile: async (filePath) => {
        const content = mockFiles[filePath];
        if (content === undefined) {
          throw new Error(`File not found: ${filePath}`);
        }
        return content;
      },
      now: () => "2026-08-15T20:00:00.000Z"
    });

    const snapshot = await adapter.readHostMemory();

    // 67108864 kB / 1024 = 65536 MB
    expect(snapshot.hostRamTotalMb).toBe(65536);
    // 33554432 kB / 1024 = 32768 MB
    expect(snapshot.hostRamAvailableMb).toBe(32768);
    // hostRamUsedMb = MemTotal - MemAvailable = 65536 - 32768 = 32768 MB
    expect(snapshot.hostRamUsedMb).toBe(32768);
    // 16777216 kB / 1024 = 16384 MB
    expect(snapshot.swapTotalMb).toBe(16384);
    // 16384 MB total - (12582912 kB / 1024 = 12288 MB free) = 4096 MB used
    expect(snapshot.swapUsedMb).toBe(4096);
    // 2097152 kB / 1024 = 2048 MB RSS
    expect(snapshot.processRssMb).toBe(2048);
    expect(snapshot.measuredAt).toBe("2026-08-15T20:00:00.000Z");
  });

  // Behavioral invariant: counter-fields-are-exact
  it("reads system swap activity and process page fault counters", async () => {
    const mockFiles: Record<string, string> = {
      "/proc/meminfo": sampleMeminfo,
      "/proc/vmstat": sampleVmstat,
      "/proc/12345/status": sampleStatus,
      "/proc/12345/stat": sampleStat
    };

    const adapter = new LinuxHostTelemetryAdapter({
      pid: 12345,
      readFile: async (filePath) => mockFiles[filePath]!,
      now: () => "2026-08-15T20:00:00.000Z"
    });

    const snapshot = await adapter.readHostMemory();

    expect(snapshot.systemSwapInPages).toBe(12);
    expect(snapshot.systemSwapOutPages).toBe(34);
    expect(snapshot.systemMajorPageFaults).toBe(567);
    expect(snapshot.systemMinorPageFaults).toBe(987654);
    expect(snapshot.processPid).toBe(12345);
    expect(snapshot.processStartTimeTicks).toBe(9876543);
    expect(snapshot.processMinorPageFaults).toBe(123456);
    expect(snapshot.processMajorPageFaults).toBe(789);
  });

  // Behavioral invariant: process-identity-is-stable
  it("rejects telemetry when the configured process identity changes", async () => {
    let currentStat = sampleStat;

    const adapter = new LinuxHostTelemetryAdapter({
      pid: 12345,
      readFile: async (filePath) => {
        if (filePath === "/proc/12345/stat") {
          return currentStat;
        }
        if (filePath === "/proc/meminfo") return sampleMeminfo;
        if (filePath === "/proc/vmstat") return sampleVmstat;
        if (filePath === "/proc/12345/status") return sampleStatus;
        throw new Error(`File not found: ${filePath}`);
      },
      now: () => "2026-08-15T20:00:00.000Z"
    });

    // First read establishes initial start time ticks (9876543)
    const firstSnapshot = await adapter.readHostMemory();
    expect(firstSnapshot.processStartTimeTicks).toBe(9876543);

    // Simulate PID reuse: a new process spawned with the same PID but different starttime ticks (9999999)
    currentStat =
      "12345 (python3) S 1 12345 12345 0 -1 4194304 100 0 10 0 500 200 0 0 20 0 16 0 9999999 1000000 5000 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0 0";

    await expect(adapter.readHostMemory()).rejects.toThrow(LinuxHostTelemetryError);
    await expect(adapter.readHostMemory()).rejects.toThrow(/Process start time changed/);
  });

  // Behavioral invariant: required-source-failure-is-loud
  it("rejects missing malformed or inaccessible proc telemetry", async () => {
    // 1. Inaccessible proc file
    const inaccessibleAdapter = new LinuxHostTelemetryAdapter({
      pid: 12345,
      readFile: async (filePath) => {
        if (filePath === "/proc/12345/stat") {
          const err = new Error("ENOENT: no such file or directory");
          (err as { code?: string }).code = "ENOENT";
          throw err;
        }
        return sampleMeminfo;
      }
    });
    await expect(inaccessibleAdapter.readHostMemory()).rejects.toThrow(LinuxHostTelemetryError);

    // 2. Missing required key in meminfo (missing MemAvailable)
    const brokenMeminfo = sampleMeminfo.replace(/MemAvailable:.*\n/, "");
    expect(() => parseProcMeminfo(brokenMeminfo)).toThrow(LinuxHostTelemetryError);

    // 3. Inconsistent meminfo (MemAvailable > MemTotal)
    const inconsistentMeminfo =
      "MemTotal: 1000 kB\nMemAvailable: 2000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB";
    expect(() => parseProcMeminfo(inconsistentMeminfo)).toThrow(LinuxHostTelemetryError);

    // 4. Missing required counter in vmstat (missing pgmajfault)
    const brokenVmstat = sampleVmstat.replace(/pgmajfault.*\n?/, "");
    expect(() => parseProcVmstat(brokenVmstat)).toThrow(LinuxHostTelemetryError);

    // 5. Missing VmRSS in status
    const brokenStatus = sampleStatus.replace(/VmRSS:.*\n/, "");
    expect(() => parseProcPidStatus(brokenStatus)).toThrow(LinuxHostTelemetryError);

    // 6. Malformed stat (missing parentheses around comm)
    const malformedStat =
      "12345 python3 S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22";
    expect(() => parseProcPidStat(malformedStat, 12345)).toThrow(LinuxHostTelemetryError);

    // 7. Stat PID mismatch
    expect(() => parseProcPidStat(sampleStat, 99999)).toThrow(LinuxHostTelemetryError);
  });

  describe("Pure parser unit tests", () => {
    it("handles parenthesized command names and spaces in /proc/<pid>/stat safely", () => {
      const complexStat =
        "42 (comfy (main) worker: 1) S 1 42 42 0 -1 4194304 555 0 77 0 100 200 0 0 20 0 4 0 12345678 1000 2000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
      const result = parseProcPidStat(complexStat, 42);
      expect(result.processPid).toBe(42);
      expect(result.processMinorPageFaults).toBe(555);
      expect(result.processMajorPageFaults).toBe(77);
      expect(result.processStartTimeTicks).toBe(12345678);
    });

    it("parses meminfo with zero swap correctly", () => {
      const zeroSwapMeminfo = [
        "MemTotal:       32768000 kB",
        "MemFree:         8192000 kB",
        "MemAvailable:   16384000 kB",
        "SwapTotal:             0 kB",
        "SwapFree:              0 kB"
      ].join("\n");

      const result = parseProcMeminfo(zeroSwapMeminfo);
      expect(result.hostRamTotalMb).toBe(32000);
      expect(result.hostRamAvailableMb).toBe(16000);
      expect(result.hostRamUsedMb).toBe(16000);
      expect(result.swapTotalMb).toBe(0);
      expect(result.swapUsedMb).toBe(0);
    });

    it("handles CRLF line endings in meminfo and vmstat", () => {
      const crlfMeminfo = sampleMeminfo.replace(/\n/g, "\r\n");
      const memResult = parseProcMeminfo(crlfMeminfo);
      expect(memResult.hostRamTotalMb).toBe(65536);

      const crlfVmstat = sampleVmstat.replace(/\n/g, "\r\n");
      const vmResult = parseProcVmstat(crlfVmstat);
      expect(vmResult.systemMajorPageFaults).toBe(567);
      expect(vmResult.systemMinorPageFaults).toBe(987654);
    });

    it("validates constructor options for LinuxHostTelemetryAdapter", () => {
      expect(() => new LinuxHostTelemetryAdapter({ pid: 0 })).toThrow(TypeError);
      expect(() => new LinuxHostTelemetryAdapter({ pid: -5 })).toThrow(TypeError);
      expect(() => new LinuxHostTelemetryAdapter({ pid: 1.5 })).toThrow(TypeError);
    });
  });
});
