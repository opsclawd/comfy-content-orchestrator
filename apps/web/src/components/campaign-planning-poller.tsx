"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export interface CampaignPlanningPollerProps {
  readonly campaignId: string;
  readonly isPlanning: boolean;
  readonly pollIntervalMs?: number;
  readonly onStatusChange?: (newStatus: string) => void;
}

export function CampaignPlanningPoller({
  campaignId,
  isPlanning,
  pollIntervalMs = 2000,
  onStatusChange
}: CampaignPlanningPollerProps) {
  const router = useRouter();
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    if (!isPlanning) return;

    let isCancelled = false;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/review-summary`, {
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (isCancelled) return;

        if (data.status && data.status !== "planning") {
          clearInterval(intervalId);
          if (onStatusChangeRef.current) {
            onStatusChangeRef.current(data.status);
          }
          router.refresh();
          if (typeof window !== "undefined") {
            try {
              window.location.reload();
            } catch {
              // Ignore in environments where window.location.reload is not implemented (e.g. jsdom)
            }
          }
        }
      } catch {
        // Ignore network glitch during polling; retry on next interval
      }
    }, pollIntervalMs);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [campaignId, isPlanning, pollIntervalMs, router]);

  return null;
}
