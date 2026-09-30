"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { ShotPlanAnimaticTimeline } from "@cco/contracts";
import {
  computeCameraTransformAtTime,
  getActiveBeatCue,
  getActiveDialogueCue
} from "@cco/contracts";

export interface ShotPlanAnimaticPlayerProps {
  readonly timeline: ShotPlanAnimaticTimeline;
  readonly isCurrentRevision: boolean;
  readonly onActiveBeatChange?: ((beatIndex: number | null) => void) | undefined;
}

export function ShotPlanAnimaticPlayer({
  timeline,
  isCurrentRevision,
  onActiveBeatChange
}: ShotPlanAnimaticPlayerProps): React.JSX.Element {
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
  const activeBeatIndexRef = useRef<number | null>(null);

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
      // Legacy fallback
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  // Compute active cues at current playback time
  const activeBeat = getActiveBeatCue(timeline, currentTimeMs);
  const activeDialogue = getActiveDialogueCue(timeline, currentTimeMs);
  const cameraTransform = computeCameraTransformAtTime(timeline, currentTimeMs, isReducedMotion);

  // Notify parent of active beat index change
  useEffect(() => {
    const nextIndex = activeBeat ? activeBeat.beatIndex : null;
    if (activeBeatIndexRef.current !== nextIndex) {
      activeBeatIndexRef.current = nextIndex;
      onActiveBeatChange?.(nextIndex);
    }
  }, [activeBeat, onActiveBeatChange]);

  // Animation frame loop
  const step = useCallback(
    (timestamp: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
      }
      const delta = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      setCurrentTimeMs((prev) => {
        const next = prev + delta;
        if (next >= timeline.totalDurationMs) {
          setIsPlaying(false);
          lastTimeRef.current = null;
          return timeline.totalDurationMs;
        }
        return next;
      });

      animFrameIdRef.current = requestAnimationFrame(step);
    },
    [timeline.totalDurationMs]
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
    if (currentTimeMs >= timeline.totalDurationMs) {
      setCurrentTimeMs(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((prev) => !prev);
    }
  }, [currentTimeMs, timeline.totalDurationMs]);

  const handleRestart = useCallback(() => {
    setCurrentTimeMs(0);
    lastTimeRef.current = null;
  }, []);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setCurrentTimeMs(val);
      if (val >= timeline.totalDurationMs) {
        setIsPlaying(false);
      }
    },
    [timeline.totalDurationMs]
  );

  const handleToggleReducedMotion = useCallback(() => {
    setIsReducedMotion((prev) => !prev);
  }, []);

  // Format frame readout
  const currentSeconds = (currentTimeMs / 1000).toFixed(2);
  const totalSeconds = (timeline.totalDurationMs / 1000).toFixed(2);
  const currentFrame = Math.min(
    timeline.targetFrameCount,
    Math.floor(
      (currentTimeMs / Math.max(1, timeline.totalDurationMs)) * timeline.targetFrameCount
    ) + 1
  );

  const transformStyle: React.CSSProperties = {
    transform: `scale(${cameraTransform.scale}) translate(${cameraTransform.translateXPercent}%, ${cameraTransform.translateYPercent}%) rotate(${cameraTransform.rotateDeg}deg)`,
    transformOrigin: "center center",
    transition: isPlaying ? "none" : "transform 0.1s ease-out"
  };

  return (
    <div
      className="shot-plan-animatic-player"
      data-testid="shot-plan-animatic-player"
      data-timeline-id={timeline.timelineId}
    >
      {/* Historical Stale Revision Banner */}
      {!isCurrentRevision && (
        <div className="animatic-stale-banner" data-testid="animatic-stale-banner">
          <span className="stale-banner-badge">STALE REVISION (Rev {timeline.specRevision})</span>
          <span className="stale-banner-text">
            Historical Planning Only · Does Not Represent Current Scene Spec
          </span>
        </div>
      )}

      {/* 16:9 Viewfinder Matte */}
      <div className="animatic-viewfinder-matte">
        {/* Animated Camera Layer */}
        <div
          className="animatic-camera-layer"
          data-testid="animatic-camera-layer"
          style={transformStyle}
        >
          {timeline.previsMedia.available && timeline.previsMedia.url ? (
            <img
              src={timeline.previsMedia.url}
              alt={`Previs visualization for Variant #${timeline.variantOrdinal}`}
              className="animatic-previs-image"
              data-testid="previs-preview-image"
            />
          ) : (
            <div className="animatic-grid-fallback" data-testid="previs-unavailable">
              <div className="grid-crosshairs" />
              <div className="grid-thirds" />
              <div className="grid-slate-info">
                <span className="slate-line-title">
                  SCENE {timeline.sceneId.slice(0, 8).toUpperCase()} · SHOTPLAN V
                  {timeline.variantOrdinal}
                </span>
                <span className="slate-line-sub">
                  Previs visualization not rendered · PREVIS PENDING · CAMERA INTENT:{" "}
                  {timeline.camera.movement.toUpperCase()} ({timeline.camera.speed.toUpperCase()})
                </span>
              </div>
            </div>
          )}

          {/* Blocking & Staging Markers Anchored in Frame */}
          {timeline.blockingVisuals.map((visual, idx) => (
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

        {/* Viewfinder Overlays & HUD (HUD stays stable, not transformed with camera) */}
        <div className="animatic-hud-overlay">
          {/* Top Bar: Camera Motion Badge & Watermark */}
          <div className="hud-top-bar">
            <div className="hud-motion-badge" data-testid="animatic-motion-badge">
              <span className="motion-label">{timeline.camera.motionLabel}</span>
              <span className="motion-speed">({timeline.camera.speed})</span>
            </div>

            <div className="hud-watermark-pill" data-testid="animatic-non-production-watermark">
              STORYBOARD ANIMATIC — NON-PRODUCTION
            </div>
          </div>

          {/* Center/Bottom: Active Beat HUD */}
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

          {/* Dialogue & VO Subtitle Banner */}
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

      {/* Playback Controls Bar */}
      <div className="animatic-controls-bar">
        <div className="controls-primary-group">
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
            className="animatic-ctrl-btn animatic-restart-btn"
            onClick={handleRestart}
            data-testid="animatic-restart-button"
            aria-label="Restart Animatic"
          >
            ↺ Restart
          </button>
        </div>

        {/* Scrubber Range Slider */}
        <div className="controls-scrubber-group">
          <input
            type="range"
            min={0}
            max={timeline.totalDurationMs}
            step={1000 / 24}
            value={currentTimeMs}
            onChange={handleScrub}
            className="animatic-scrubber"
            data-testid="animatic-scrubber"
            aria-label="Animatic timeline scrubber"
          />
        </div>

        {/* Timing Readout */}
        <div className="controls-time-readout" data-testid="animatic-time-display">
          <span className="time-seconds">
            {currentSeconds}s / {totalSeconds}s
          </span>{" "}
          <span className="time-frames">
            (Frame {currentFrame} / {timeline.targetFrameCount})
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
