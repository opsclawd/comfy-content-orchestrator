import type { SceneStatus, ReviewAction } from "@cco/contracts";

const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
  draft_pending: "Draft Pending",
  generating_candidates: "Generating Candidates",
  director_review: "Director Review",
  approved: "Approved",
  queued: "Queued",
  rendering: "Rendering",
  qa: "QA",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled"
};

const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = {
  approve: "Approve",
  reject: "Reject",
  reroll: "Reroll",
  prompt_edit: "Edit Prompt",
  reference_change: "Change References",
  engine_change: "Change Engine",
  duration_change: "Change Duration",
  lora_tune: "Tune LoRA",
  reorder: "Reorder",
  duplicate: "Duplicate",
  cancel: "Cancel",
  candidate_select: "Select Candidate"
};

export function formatSceneStatus(status: SceneStatus): string {
  return SCENE_STATUS_LABELS[status] ?? status;
}

export function formatReviewAction(action: ReviewAction): string {
  return REVIEW_ACTION_LABELS[action] ?? action;
}

export function formatDurationMs(durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(2);
  return `${durationMs} ms (${seconds}s)`;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});

export function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }
    return DATE_TIME_FORMATTER.format(date);
  } catch {
    return isoString;
  }
}
