import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  computeIntervalUnionDuration,
  reducePhaseAccounting
} from "./minimax-h3-timing-reducer.js";
import type { MinimaxH3InstrumentationEvent } from "@cco/contracts";

const execFileAsync = promisify(execFile);

describe("MiniMax-H3 Timing Reducer", () => {
  describe("Interval Union Computation", () => {
    it("returns 0 for empty intervals", () => {
      expect(computeIntervalUnionDuration([])).toBe(0);
    });

    it("correctly unions non-overlapping intervals", () => {
      const intervals = [
        { startMs: 0, endMs: 100 },
        { startMs: 200, endMs: 300 }
      ];
      expect(computeIntervalUnionDuration(intervals)).toBe(200);
    });

    it("correctly unions overlapping and nested intervals without double-counting", () => {
      const intervals = [
        { startMs: 0, endMs: 150 },
        { startMs: 50, endMs: 200 }, // overlaps with first
        { startMs: 70, endMs: 120 }, // nested within first two
        { startMs: 300, endMs: 400 } // disjoint
      ];
      // [0, 200] is 200ms; [300, 400] is 100ms. Total = 300ms.
      expect(computeIntervalUnionDuration(intervals)).toBe(300);
    });
  });

  describe("Phase Accounting Event Reducer", () => {
    it("handles empty events with missing status and parent wall time", () => {
      const result = reducePhaseAccounting({
        events: [],
        parentWallTimeMs: 15000
      });
      expect(result.status).toBe("missing");
      expect(result.wholeAttemptWallMs).toBe(15000);
      expect(result.phases.whole_attempt_wall!.durationMs).toBe(15000);
      expect(result.phases.sampling!.status).toBe("unknown");
      expect(result.phases.sampling!.durationMs).toBeNull();
    });

    it("reduces a complete run with all phases and 20 sampling steps", () => {
      let seq = 0;
      const events: MinimaxH3InstrumentationEvent[] = [];

      function addSpan(
        phase: MinimaxH3InstrumentationEvent["phase"],
        spanId: string,
        startMs: number,
        endMs: number,
        extra: Partial<MinimaxH3InstrumentationEvent> = {}
      ) {
        seq++;
        events.push({
          protocolVersion: "v2-jsonl",
          sequence: seq,
          runId: "run-001",
          attemptToken: "att-001",
          spanId,
          phase,
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: startMs,
          ...extra
        });
        seq++;
        events.push({
          protocolVersion: "v2-jsonl",
          sequence: seq,
          runId: "run-001",
          attemptToken: "att-001",
          spanId,
          phase,
          type: "span_end",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: endMs,
          outcome: "success",
          ...extra
        });
      }

      // 1. environment_startup
      addSpan("environment_startup", "span-startup", 100, 500);
      // 2. model_loading
      addSpan("model_loading", "span-load", 500, 2500);
      // 3. conditioning
      addSpan("conditioning", "span-cond", 2500, 3500);
      // child: text_encode inside conditioning
      addSpan("text_encode", "span-text", 2600, 3000, { parentSpanId: "span-cond" });
      // 4. sampling (from 3500 to 13500)
      addSpan("sampling", "span-sample", 3500, 13500);
      // 20 steps
      for (let s = 0; s < 20; s++) {
        const stepStart = 3500 + s * 500;
        const stepEnd = stepStart + 500;
        addSpan("sampling_step", `step-${s}`, stepStart, stepEnd, {
          parentSpanId: "span-sample",
          stepIndex: s
        });
      }
      // 5. vae_decode_video
      addSpan("vae_decode_video", "span-dec-vid", 13500, 15000);
      // 6. vae_decode_audio
      addSpan("vae_decode_audio", "span-dec-aud", 15000, 15500);
      // 7. mux_and_save
      addSpan("mux_and_save", "span-mux", 15500, 16000);
      // 8. teardown
      addSpan("teardown", "span-td", 16000, 16200);

      const result = reducePhaseAccounting({
        events,
        parentWallTimeMs: 16500,
        declaredSteps: 20
      });

      expect(result.status).toBe("complete");
      expect(result.phases.environment_startup!.status).toBe("measured");
      expect(result.phases.environment_startup!.durationMs).toBe(400);

      expect(result.phases.model_loading!.status).toBe("measured");
      expect(result.phases.model_loading!.durationMs).toBe(2000);

      expect(result.phases.conditioning!.status).toBe("measured");
      expect(result.phases.conditioning!.durationMs).toBe(1000);

      expect(result.phases.sampling!.status).toBe("measured");
      expect(result.phases.sampling!.durationMs).toBe(10000);
      expect(result.phases.sampling!.stepCount).toBe(20);
      expect(result.phases.sampling!.steps?.length).toBe(20);
      expect(result.phases.sampling!.steps?.[0]?.durationMs).toBe(500);

      expect(result.phases.vae_decode_video!.status).toBe("measured");
      expect(result.phases.vae_decode_video!.durationMs).toBe(1500);

      expect(result.phases.mux_and_save!.status).toBe("measured");
      expect(result.phases.mux_and_save!.durationMs).toBe(500);

      expect(result.samplingWallTimeMs).toBe(10000);
      expect(result.wholeAttemptWallMs).toBe(16500);
      expect(result.intervalInconsistencies).toEqual([]);
    });

    it("detects sequence gaps, unclosed spans, negative durations, and child boundary violations", () => {
      const events: MinimaxH3InstrumentationEvent[] = [
        // Index 0: measured environment_startup span
        {
          protocolVersion: "v2-jsonl",
          sequence: 1,
          runId: "r1",
          attemptToken: "a1",
          spanId: "startup-1",
          phase: "environment_startup",
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 0
        },
        {
          protocolVersion: "v2-jsonl",
          sequence: 2,
          runId: "r1",
          attemptToken: "a1",
          spanId: "startup-1",
          phase: "environment_startup",
          type: "span_end",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 50,
          outcome: "success"
        },
        // Sequence gap: next index has sequence 5 instead of 3!
        {
          protocolVersion: "v2-jsonl",
          sequence: 5,
          runId: "r1",
          attemptToken: "a1",
          spanId: "parent-1",
          phase: "sampling",
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 100
        },

        // Index 1 has sequence 5 (sequence gap!)
        {
          protocolVersion: "v2-jsonl",
          sequence: 5,
          runId: "r1",
          attemptToken: "a1",
          spanId: "child-1",
          parentSpanId: "parent-1",
          phase: "sampling_step",
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 50 // starts BEFORE parent (containment violation!)
        },
        // Child end
        {
          protocolVersion: "v2-jsonl",
          sequence: 6,
          runId: "r1",
          attemptToken: "a1",
          spanId: "child-1",
          parentSpanId: "parent-1",
          phase: "sampling_step",
          type: "span_end",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 80
        },
        // Negative duration span
        {
          protocolVersion: "v2-jsonl",
          sequence: 7,
          runId: "r1",
          attemptToken: "a1",
          spanId: "bad-span",
          phase: "model_loading",
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 500
        },
        {
          protocolVersion: "v2-jsonl",
          sequence: 8,
          runId: "r1",
          attemptToken: "a1",
          spanId: "bad-span",
          phase: "model_loading",
          type: "span_end",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 200 // end < start!
        }
        // Notice parent-1 is never closed!
      ];

      const result = reducePhaseAccounting({
        events,
        parentWallTimeMs: 1000
      });

      expect(result.status).toBe("partial");
      expect(result.intervalInconsistencies.some((i) => i.includes("Sequence mismatch"))).toBe(
        true
      );
      expect(
        result.intervalInconsistencies.some((i) => i.includes("Unclosed spanId parent-1"))
      ).toBe(true);
      expect(result.intervalInconsistencies.some((i) => i.includes("Negative duration"))).toBe(
        true
      );
      expect(result.intervalInconsistencies.some((i) => i.includes("exceeds parent"))).toBe(true);
    });

    it("marks sampling phase unknown and null duration when step count does not match declared steps", () => {
      const makeStep = (
        seq: number,
        idx: number,
        startMs: number,
        endMs: number
      ): MinimaxH3InstrumentationEvent[] => [
        {
          protocolVersion: "v2-jsonl",
          sequence: seq,
          runId: "r1",
          attemptToken: "a1",
          spanId: `step-${idx}`,
          parentSpanId: "sampling-span",
          phase: "sampling_step",
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: startMs,
          stepIndex: idx
        },
        {
          protocolVersion: "v2-jsonl",
          sequence: seq + 1,
          runId: "r1",
          attemptToken: "a1",
          spanId: `step-${idx}`,
          parentSpanId: "sampling-span",
          phase: "sampling_step",
          type: "span_end",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: endMs,
          stepIndex: idx,
          outcome: "success"
        }
      ];

      // Case 1: Fewer steps than declared (e.g. 4 steps vs 8 declared)
      const eventsFew: MinimaxH3InstrumentationEvent[] = [
        {
          protocolVersion: "v2-jsonl",
          sequence: 0,
          runId: "r1",
          attemptToken: "a1",
          spanId: "sampling-span",
          phase: "sampling",
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 100
        },
        ...makeStep(1, 0, 110, 150),
        ...makeStep(3, 1, 150, 190),
        ...makeStep(5, 2, 190, 230),
        ...makeStep(7, 3, 230, 270),
        {
          protocolVersion: "v2-jsonl",
          sequence: 9,
          runId: "r1",
          attemptToken: "a1",
          spanId: "sampling-span",
          phase: "sampling",
          type: "span_end",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 280,
          outcome: "success"
        }
      ];

      const resultFew = reducePhaseAccounting({
        events: eventsFew,
        parentWallTimeMs: 500,
        declaredSteps: 8
      });

      expect(resultFew.phases.sampling).toBeDefined();
      expect(resultFew.phases.sampling?.status).toBe("unknown");
      expect(resultFew.phases.sampling?.durationMs).toBeNull();
      expect(resultFew.phases.sampling?.unknownReason).toBe("incomplete_sampling_steps");
      expect(resultFew.intervalInconsistencies).toContain(
        "Observed step count (4) does not match declared steps (8)"
      );
      expect(resultFew.samplingWallTimeMs).toBeNull();

      // Case 2: Excess steps than declared (e.g. 5 steps vs 4 declared)
      const eventsExcess: MinimaxH3InstrumentationEvent[] = [
        {
          protocolVersion: "v2-jsonl",
          sequence: 0,
          runId: "r1",
          attemptToken: "a1",
          spanId: "sampling-span",
          phase: "sampling",
          type: "span_start",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 100
        },
        ...makeStep(1, 0, 110, 150),
        ...makeStep(3, 1, 150, 190),
        ...makeStep(5, 2, 190, 230),
        ...makeStep(7, 3, 230, 270),
        ...makeStep(9, 4, 270, 310),
        {
          protocolVersion: "v2-jsonl",
          sequence: 11,
          runId: "r1",
          attemptToken: "a1",
          spanId: "sampling-span",
          phase: "sampling",
          type: "span_end",
          boundarySource: "child_bootstrap",
          clockDomain: "mono_child",
          monotonicMs: 320,
          outcome: "success"
        }
      ];

      const resultExcess = reducePhaseAccounting({
        events: eventsExcess,
        parentWallTimeMs: 500,
        declaredSteps: 4
      });

      expect(resultExcess.phases.sampling).toBeDefined();
      expect(resultExcess.phases.sampling?.status).toBe("unknown");
      expect(resultExcess.phases.sampling?.durationMs).toBeNull();
      expect(resultExcess.phases.sampling?.unknownReason).toBe("excess_sampling_steps");
      expect(resultExcess.intervalInconsistencies).toContain(
        "Observed step count (5) does not match declared steps (4)"
      );
      expect(resultExcess.samplingWallTimeMs).toBeNull();
    });
  });

  describe("Python Collector Bootstrap Smoke Test", () => {
    it("runs collector bootstrap against a minimal fake ComfyUI entrypoint and verifies JSONL stream", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "cco-collector-test-"));
      const collectorPath = resolve(
        __dirname,
        "../../../../packages/infrastructure/src/experiments/minimax-h3-collector.py"
      );
      const fakeEntrypointPath = join(tmpDir, "fake_comfy.py");
      const eventLogPath = join(tmpDir, "phase-events.jsonl");

      // Create a minimal fake entrypoint that simulates ComfyUI work
      const fakeEntrypointCode = `
import sys, time
print("Fake ComfyUI starting...")
time.sleep(0.05)
print("Fake ComfyUI finished.")
`;
      await writeFile(fakeEntrypointPath, fakeEntrypointCode, "utf8");

      const env = {
        ...process.env,
        CCO_EXPERIMENT_RUN_DIR: tmpDir,
        CCO_EXPERIMENT_RUN_ID: "smoke-test-run",
        CCO_EXPERIMENT_ATTEMPT_TOKEN: "smoke-test-attempt",
        CCO_EXPERIMENT_EVENT_LOG: eventLogPath
      };

      const { stdout } = await execFileAsync(
        "python3",
        [collectorPath, "--bootstrap-entrypoint", fakeEntrypointPath],
        { env, timeout: 10000 }
      );

      expect(stdout).toContain("Fake ComfyUI starting...");
      expect(stdout).toContain("Fake ComfyUI finished.");

      // Verify event log
      const logContent = await readFile(eventLogPath, "utf8");
      const lines = logContent
        .trim()
        .split("\n")
        .filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(4);

      const parsedEvents: MinimaxH3InstrumentationEvent[] = lines.map((l) => JSON.parse(l));
      for (const ev of parsedEvents) {
        expect(ev.protocolVersion).toBe("v2-jsonl");
        expect(ev.runId).toBe("smoke-test-run");
        expect(ev.clockDomain).toBe("mono_child");
        expect(typeof ev.monotonicMs).toBe("number");
      }

      // Verify startup and teardown spans exist
      const phases = parsedEvents.map((e) => e.phase);
      expect(phases).toContain("environment_startup");
      expect(phases).toContain("teardown");

      // Verify timing reducer can parse this smoke test output
      const reduction = reducePhaseAccounting({
        events: parsedEvents,
        parentWallTimeMs: 200
      });
      expect(reduction.phases.environment_startup!.status).toBe("measured");
      expect(reduction.phases.teardown!.status).toBe("measured");

      await rm(tmpDir, { recursive: true, force: true });
    });
  });
});
