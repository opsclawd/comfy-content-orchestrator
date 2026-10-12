"use client";

import React, { useState, useEffect } from "react";
import type {
  ShotPlanTemporalBeat,
  ShotPlanBeatFrameReviewItem,
  ShotPlanBeatFrameStatus
} from "@cco/contracts";

export interface ShotPlanBeatStripProps {
  readonly beats: readonly ShotPlanTemporalBeat[];
  readonly beatFrames?: readonly ShotPlanBeatFrameReviewItem[] | undefined;
  readonly planId?: string | undefined;
}

interface ShotPlanBeatSlotProps {
  readonly beat: ShotPlanTemporalBeat;
  readonly frame?: ShotPlanBeatFrameReviewItem | undefined;
}

function getPlaceholderText(status: ShotPlanBeatFrameStatus): string {
  switch (status) {
    case "pending":
      return "Frame pending";
    case "failed":
      return "Frame failed";
    case "unavailable":
    default:
      return "Frame unavailable";
  }
}

export function ShotPlanBeatSlot({ beat, frame }: ShotPlanBeatSlotProps) {
  const [hasImageError, setHasImageError] = useState(false);

  // Reset local image load error whenever candidate or media URL changes
  useEffect(() => {
    setHasImageError(false);
  }, [frame?.candidateId, frame?.media?.url]);

  let effectiveStatus: ShotPlanBeatFrameStatus = "pending";
  if (!frame) {
    effectiveStatus = "pending";
  } else if (hasImageError) {
    effectiveStatus = "unavailable";
  } else if (frame.status === "ready") {
    if (frame.media?.available && frame.media?.url) {
      effectiveStatus = "ready";
    } else {
      effectiveStatus = "unavailable";
    }
  } else {
    effectiveStatus = frame.status;
  }

  const altText = `Beat ${beat.beatIndex}: ${beat.description || "Temporal beat frame"}`;

  return (
    <li
      className="shot-plan-beat-slot"
      data-testid="shot-plan-beat-slot"
      data-beat-index={beat.beatIndex}
      data-status={effectiveStatus}
    >
      <div className="shot-plan-beat-slot-frame">
        {effectiveStatus === "ready" && frame?.media?.url ? (
          <img
            src={frame.media.url}
            alt={altText}
            className="shot-plan-beat-image"
            data-testid="shot-plan-beat-image"
            onError={() => setHasImageError(true)}
          />
        ) : (
          <div
            className={`shot-plan-beat-placeholder shot-plan-beat-placeholder-${effectiveStatus}`}
            data-testid="shot-plan-beat-placeholder"
            data-status={effectiveStatus}
          >
            <span className="placeholder-text">{getPlaceholderText(effectiveStatus)}</span>
          </div>
        )}
      </div>
      <div className="shot-plan-beat-caption-wrapper">
        <span className="shot-plan-beat-caption" data-testid="shot-plan-beat-caption">
          Beat {beat.beatIndex}
        </span>
      </div>
    </li>
  );
}

export function ShotPlanBeatStrip({ beats, beatFrames, planId }: ShotPlanBeatStripProps) {
  if (!beats || beats.length === 0) {
    return null;
  }

  // Sort declared beats copy numerically by beatIndex
  const sortedBeats = [...beats].sort((a, b) => a.beatIndex - b.beatIndex);

  const frameMap = new Map<number, ShotPlanBeatFrameReviewItem>();
  if (beatFrames) {
    for (const frame of beatFrames) {
      frameMap.set(frame.beatIndex, frame);
    }
  }

  return (
    <div
      className="shot-plan-beat-strip"
      data-testid="shot-plan-beat-strip"
      {...(planId ? { "data-shot-plan-id": planId } : {})}
    >
      <div className="shot-plan-beat-strip-header">
        <div
          className="storyboard-non-production-badge badge-previs-non-production shot-plan-beat-strip-badge"
          data-testid="beat-strip-badge"
        >
          <span className="badge-text">Beat frames — non-authoritative</span>
        </div>
      </div>
      <ol className="shot-plan-beat-slots" data-testid="shot-plan-beat-slots">
        {sortedBeats.map((beat) => (
          <ShotPlanBeatSlot key={beat.beatIndex} beat={beat} frame={frameMap.get(beat.beatIndex)} />
        ))}
      </ol>
    </div>
  );
}
