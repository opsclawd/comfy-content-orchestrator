"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { CampaignAnimaticReadModel, CampaignAnimaticSegment } from "@cco/contracts";
import {
  computeCameraTransformAtTime,
  getActiveBeatCue,
  getActiveDialogueCue,
  computeShotLocalTimeMs,
  findActiveCampaignSegment,
  findNextSegmentStartTime,
  findPreviousSegmentStartTime
} from "@cco/contracts";

export interface CampaignAnimaticPlayerProps {
  readonly animatic: CampaignAnimaticReadModel;
  readonly isStale?: boolean | undefined;
  readonly currentSnapshotId?: string | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly onActiveSegmentChange?: ((segment: CampaignAnimaticSegment | null) => void) | undefined;
}

/**
 * Formats a duration in milliseconds to "MM:SS.ss" (e.g. 00:12.40).
 */
export function formatTimestamp(ms: number): string {
  const clampedMs = Math.max(0, Math.round(ms));
  const totalHundredths = Math.floor(clampedMs / 10);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function CampaignAnimaticPlayer({
  animatic,
  isStale = false,
  currentSnapshotId,
  onRefresh,
  onActiveSegmentChange
}: CampaignAnimaticPlayerProps): React.JSX.Element {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [isReducedMotion, setIsReducedMotion] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    return false;
  });

  const animFrameIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const activeSegmentKeyRef = useRef<string | null>(null);
  const currentTimeMsRef = useRef<number>(0);

  // Keep ref synchronized with state
  useEffect(() => {
    currentTimeMsRef.current = currentTimeMs;
  }, [currentTimeMs]);

  // Subscribe to prefers-reduced-motion OS events
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (e: MediaQueryListEvent) => {
      setIsReducedMotion(e.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  // Compute active segment at current campaign playback time
  const activeSegment = findActiveCampaignSegment(animatic, currentTimeMs);

  // Notify parent of active segment change
  useEffect(() => {
    const nextKey = activeSegment
      ? `${activeSegment.sceneId}-${activeSegment.sceneOrder}-${activeSegment.hasPlan ? activeSegment.shotPlanId : "gap"}`
      : null;
    if (activeSegmentKeyRef.current !== nextKey) {
      activeSegmentKeyRef.current = nextKey;
      onActiveSegmentChange?.(activeSegment);
    }
  }, [activeSegment, onActiveSegmentChange]);

  // Frame animation loop
  const step = useCallback(
    (timestamp: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
      }
      const delta = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      const nextTime = currentTimeMsRef.current + delta;
      if (nextTime >= animatic.totalDurationMs) {
        currentTimeMsRef.current = animatic.totalDurationMs;
        setCurrentTimeMs(animatic.totalDurationMs);
        setIsPlaying(false);
        lastTimeRef.current = null;
        return;
      }

      currentTimeMsRef.current = nextTime;
      setCurrentTimeMs(nextTime);
      animFrameIdRef.current = requestAnimationFrame(step);
    },
    [animatic.totalDurationMs]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = null;
      animFrameIdRef.current = requestAnimationFrame(step);
    } else {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      lastTimeRef.current = null;
    }

    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [isPlaying, step]);

  const handlePlayToggle = useCallback(() => {
    if (currentTimeMsRef.current >= animatic.totalDurationMs) {
      currentTimeMsRef.current = 0;
      setCurrentTimeMs(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((prev) => !prev);
    }
  }, [animatic.totalDurationMs]);

  const handleRestart = useCallback(() => {
    currentTimeMsRef.current = 0;
    setCurrentTimeMs(0);
    lastTimeRef.current = null;
  }, []);

  const handleNextShot = useCallback(() => {
    const nextTime = findNextSegmentStartTime(animatic, currentTimeMsRef.current);
    currentTimeMsRef.current = nextTime;
    setCurrentTimeMs(nextTime);
    if (nextTime >= animatic.totalDurationMs) {
      setIsPlaying(false);
    }
  }, [animatic]);

  const handlePreviousShot = useCallback(() => {
    const prevTime = findPreviousSegmentStartTime(animatic, currentTimeMsRef.current, 500);
    currentTimeMsRef.current = prevTime;
    setCurrentTimeMs(prevTime);
  }, [animatic]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      currentTimeMsRef.current = val;
      setCurrentTimeMs(val);
      if (val >= animatic.totalDurationMs) {
        setIsPlaying(false);
      }
    },
    [animatic.totalDurationMs]
  );

  const handleToggleReducedMotion = useCallback(() => {
    setIsReducedMotion((prev) => !prev);
  }, []);

  // Compute local cues and transform if active segment has a plan
  let shotLocalMs = 0;
  let cameraTransform = { scale: 1, translateXPercent: 0, translateYPercent: 0, rotateDeg: 0 };
  let activeBeat = null;
  let activeDialogue = null;

  if (activeSegment) {
    shotLocalMs = computeShotLocalTimeMs(activeSegment, currentTimeMs);
    if (activeSegment.hasPlan) {
      cameraTransform = computeCameraTransformAtTime(
        activeSegment.timeline,
        shotLocalMs,
        isReducedMotion
      );
      activeBeat = getActiveBeatCue(activeSegment.timeline, shotLocalMs);
      activeDialogue = getActiveDialogueCue(activeSegment.timeline, shotLocalMs);
    }
  }

  const isStaleRoughCut = Boolean(
    isStale || (currentSnapshotId && currentSnapshotId !== animatic.readSnapshotId)
  );

  const totalFrames = Math.max(1, Math.round((animatic.totalDurationMs / 1000) * 24));
  const currentTotalFrame = Math.min(
    totalFrames,
    Math.floor((currentTimeMs / Math.max(1, animatic.totalDurationMs)) * totalFrames) + 1
  );

  const transformStyle: React.CSSProperties = {
    transform: `scale(${cameraTransform.scale}) translate(${cameraTransform.translateXPercent}%, ${cameraTransform.translateYPercent}%) rotate(${cameraTransform.rotateDeg}deg)`,
    transformOrigin: "center center",
    transition: isPlaying ? "none" : "transform 0.1s ease-out"
  };

  return (
    <div
      className="campaign-animatic-player"
      data-testid="campaign-animatic-player"
      data-campaign-id={animatic.campaignId}
      data-snapshot-id={animatic.readSnapshotId}
    >
      {/* Stale Rough Cut Warning Banner */}
      {isStaleRoughCut && (
        <div className="animatic-stale-banner" data-testid="animatic-stale-banner">
          <span className="stale-banner-badge">STALE ROUGH CUT</span>
          <span className="stale-banner-text">
            Scene specifications or ShotPlan selections have changed on the server.
          </span>
          {onRefresh && (
            <button
              type="button"
              className="animatic-reload-btn"
              data-testid="animatic-reload-btn"
              onClick={onRefresh}
            >
              ↻ Reload Animatic
            </button>
          )}
        </div>
      )}

      {/* 16:9 Cinema Viewfinder Matte */}
      <div className="animatic-viewfinder-matte">
        {/* Animated Camera / Viewfinder Layer */}
        {activeSegment && activeSegment.hasPlan ? (
          <div
            className="animatic-camera-layer"
            data-testid="animatic-camera-layer"
            style={transformStyle}
          >
            {activeSegment.previsMedia.available && activeSegment.previsMedia.url ? (
              <img
                src={activeSegment.previsMedia.url}
                alt={`Previs visualization for Scene ${activeSegment.sceneOrder} Variant #${activeSegment.variantOrdinal}`}
                className="animatic-previs-image"
                data-testid="previs-preview-image"
              />
            ) : (
              <div className="animatic-grid-fallback" data-testid="previs-unavailable">
                <div className="grid-crosshairs" />
                <div className="grid-thirds" />
                <div className="grid-slate-info">
                  <span className="slate-line-title">
                    SCENE {activeSegment.sceneOrder} · SHOTPLAN V{activeSegment.variantOrdinal}
                  </span>
                  <span className="slate-line-sub">
                    Previs visualization not rendered · PREVIS PENDING · CAMERA:{" "}
                    {activeSegment.camera.movement.toUpperCase()} (
                    {activeSegment.camera.speed.toUpperCase()})
                  </span>
                </div>
              </div>
            )}

            {/* Subject/Product Blocking Markers */}
            {activeSegment.timeline.blockingVisuals.map((visual, idx) => (
              <div
                key={`${visual.subjectId}-${idx}`}
                className={`animatic-blocking-marker ${
                  visual.role === "product" ? "marker-product" : "marker-subject"
                }`}
                data-testid="animatic-blocking-marker"
                data-subject-id={visual.subjectId}
                data-role={visual.role}
                style={{
                  left: `${visual.anchorCoord.xPercent}%`,
                  top: `${visual.anchorCoord.yPercent}%`
                }}
              >
                <span className="marker-role-tag">
                  {visual.role === "product" ? "Product" : "Subject"}: {visual.subjectId}
                </span>
                <span className="marker-trajectory">→ {visual.movementTrajectory}</span>
                {visual.interactionSummary && (
                  <span className="marker-interaction">[{visual.interactionSummary}]</span>
                )}
              </div>
            ))}
          </div>
        ) : activeSegment && !activeSegment.hasPlan ? (
          /* Gap / Blocker Warning Slate */
          <div className="animatic-gap-slate" data-testid="animatic-gap-slate">
            <div className="gap-slate-icon" aria-hidden="true">
              ⚠️
            </div>
            <div className="gap-slate-content">
              <h3 className="gap-slate-title">
                SCENE {activeSegment.sceneOrder} (REV {activeSegment.specRevision}) — GAP / BLOCKER
              </h3>
              <p className="gap-slate-reason">
                <strong>Reason:</strong> {activeSegment.gapReason}
              </p>
              <p className="gap-slate-message">{activeSegment.gapMessage}</p>
              <span className="gap-slate-warning">
                Plan selection required prior to MiniMax-H3 production admission
              </span>
            </div>
          </div>
        ) : (
          <div className="animatic-empty-slate" data-testid="animatic-empty-slate">
            <span>No campaign scenes available</span>
          </div>
        )}

        {/* Viewfinder Overlays & HUD (Stable over viewport) */}
        <div className="animatic-hud-overlay">
          {/* Top Bar: Scene / Shot Identity, Approval Pill, Motion Badge & Watermark */}
          <div className="hud-top-bar">
            <div className="hud-identity-group">
              {activeSegment && (
                <span className="hud-scene-ordinal" data-testid="animatic-scene-ordinal">
                  SCENE {activeSegment.sceneOrder} / {animatic.totalScenes}
                  {activeSegment.hasPlan
                    ? ` · SHOT V${activeSegment.variantOrdinal}`
                    : " · NO SELECTION"}
                </span>
              )}

              {activeSegment && activeSegment.hasPlan ? (
                <span
                  className={`hud-approval-pill pill-${activeSegment.approvalStatus}`}
                  data-testid="animatic-shot-approval-badge"
                  data-approval-status={activeSegment.approvalStatus}
                >
                  {activeSegment.approvalStatus === "approved" ? "APPROVED" : "SELECTED DRAFT"}
                </span>
              ) : activeSegment && !activeSegment.hasPlan ? (
                <span className="hud-approval-pill pill-gap" data-testid="animatic-gap-badge">
                  GAP / BLOCKER
                </span>
              ) : null}
            </div>

            <div className="hud-right-group">
              {activeSegment && activeSegment.hasPlan && (
                <div className="hud-motion-badge" data-testid="animatic-motion-badge">
                  <span className="motion-label">{activeSegment.camera.motionLabel}</span>
                  <span className="motion-speed">({activeSegment.camera.speed})</span>
                </div>
              )}

              <div className="hud-watermark-pill" data-testid="animatic-non-production-watermark">
                STORYBOARD ANIMATIC — NON-PRODUCTION
              </div>
            </div>
          </div>

          {/* Active Beat HUD */}
          {activeBeat && (
            <div className="hud-beat-card" data-testid="animatic-active-beat-hud">
              <div className="beat-card-header">
                <span className="beat-badge">Beat {activeBeat.beatIndex}</span>
                <span className="beat-time-range">
                  [{(activeBeat.startMs / 1000).toFixed(1)}s -{" "}
                  {(activeBeat.endMs / 1000).toFixed(1)}s]
                </span>
                <span className="beat-desc">{activeBeat.description}</span>
              </div>
              <div className="beat-card-details">
                <span className="beat-camera-action">
                  <strong>Camera:</strong> {activeBeat.cameraAction}
                </span>
                <span className="beat-subject-action">
                  <strong>Subject:</strong> {activeBeat.subjectAction}
                </span>
              </div>
            </div>
          )}

          {/* Dialogue / VO Subtitle Banner */}
          {activeDialogue && (
            <div className="hud-dialogue-banner" data-testid="animatic-dialogue-hud">
              {activeDialogue.speaker && (
                <span className="dialogue-speaker">[{activeDialogue.speaker}]: </span>
              )}
              {activeDialogue.line && (
                <span className="dialogue-line">&ldquo;{activeDialogue.line}&rdquo;</span>
              )}
              {activeDialogue.voiceoverCue && (
                <span className="dialogue-vo"> 🎙️ VO: {activeDialogue.voiceoverCue}</span>
              )}
              {activeDialogue.audioFxPrompt && (
                <span className="dialogue-fx"> 🔊 FX: {activeDialogue.audioFxPrompt}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Playback Transport & Timeline Controls */}
      <div className="animatic-controls-bar">
        <div className="controls-primary-group">
          <button
            type="button"
            className="animatic-ctrl-btn animatic-prev-btn"
            onClick={handlePreviousShot}
            data-testid="animatic-prev-shot"
            aria-label="Previous Shot"
            title="Jump to previous shot"
          >
            ⏮
          </button>

          <button
            type="button"
            className="animatic-ctrl-btn animatic-play-btn"
            onClick={handlePlayToggle}
            data-testid="animatic-play-toggle"
            aria-label={isPlaying ? "Pause Animatic" : "Play Animatic"}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          <button
            type="button"
            className="animatic-ctrl-btn animatic-next-btn"
            onClick={handleNextShot}
            data-testid="animatic-next-shot"
            aria-label="Next Shot"
            title="Jump to next shot"
          >
            ⏭
          </button>

          <button
            type="button"
            className="animatic-ctrl-btn animatic-restart-btn"
            onClick={handleRestart}
            data-testid="animatic-restart-button"
            aria-label="Restart Animatic"
          >
            ↺ Restart
          </button>
        </div>

        {/* Continuous Scrubber with Scene-Boundary Markers */}
        <div className="controls-scrubber-group">
          <input
            type="range"
            min={0}
            max={animatic.totalDurationMs}
            step={1000 / 24}
            value={currentTimeMs}
            onChange={handleScrub}
            className="animatic-scrubber"
            data-testid="animatic-scrubber"
            aria-label="Campaign animatic scrubber"
          />

          {/* Boundary Ticks / Track Breakdown */}
          {animatic.totalDurationMs > 0 && (
            <div className="animatic-boundary-markers" aria-hidden="true">
              {animatic.segments.map((seg) => (
                <div
                  key={`${seg.sceneId}-${seg.sceneOrder}`}
                  className={`animatic-boundary-segment ${
                    seg.hasPlan
                      ? seg.approvalStatus === "approved"
                        ? "seg-approved"
                        : "seg-draft"
                      : "seg-gap"
                  }`}
                  style={{
                    left: `${(seg.startMs / animatic.totalDurationMs) * 100}%`,
                    width: `${(seg.targetDurationMs / animatic.totalDurationMs) * 100}%`
                  }}
                  title={`Scene ${seg.sceneOrder} (${(seg.targetDurationMs / 1000).toFixed(1)}s)${!seg.hasPlan ? " — GAP" : ""}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Timing Readout */}
        <div className="controls-time-readout" data-testid="animatic-time-display">
          <span className="time-seconds">
            {formatTimestamp(currentTimeMs)} / {formatTimestamp(animatic.totalDurationMs)}
          </span>{" "}
          <span className="time-frames">
            (Frame {currentTotalFrame} / {totalFrames} @ 24fps)
          </span>
        </div>

        {/* Reduced Motion Accessibility Toggle */}
        <div className="controls-aux-group">
          <button
            type="button"
            className={`animatic-ctrl-btn animatic-reduced-motion-btn ${
              isReducedMotion ? "active" : ""
            }`}
            onClick={handleToggleReducedMotion}
            data-testid="animatic-reduced-motion-toggle"
            aria-label="Toggle reduced motion"
            title="Toggle reduced motion camera transforms"
          >
            {isReducedMotion ? "Motion: Reduced" : "Motion: Standard"}
          </button>
        </div>
      </div>
    </div>
  );
}
