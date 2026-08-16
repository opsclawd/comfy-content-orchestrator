# Code Review

## Findings

### 1. Missing Time Injection in Telemetry Adapters (Composition Root Omission)
- **severity:** high
- **file path:** `apps/render-worker/src/cli/certify-ltx.ts`
- **evidence:** In the composition root, the injected `now` dependency is passed to `TelemetrySampler` and `runCertification`, but it is omitted when instantiating `NvidiaSmiTelemetryAdapter` and `LinuxHostTelemetryAdapter`:
  ```typescript
      : new TelemetrySampler({
          gpuTelemetryPort: new NvidiaSmiTelemetryAdapter({ gpuIndex }),
          hostTelemetryPort: new LinuxHostTelemetryAdapter({ pid: comfyUiPid }),
          intervalMs: 200,
          now
        });
  ```
- **failure mode:** When the CLI is executed in an automated test environment that mocks time via the `now` dependency, the inner telemetry adapters will fall back to using real system time (`Date.now()`). This breaks the time abstraction spanning the components and will cause synchronization assertions and metric calculations to fail in tests.
- **required fix:** Pass the `now` dependency into the constructors of both telemetry adapters:
  ```typescript
        gpuTelemetryPort: new NvidiaSmiTelemetryAdapter({ gpuIndex, now }),
        hostTelemetryPort: new LinuxHostTelemetryAdapter({ pid: comfyUiPid, now }),
  ```
