# Ref2V Reference-Fidelity Visual QA (issue #329)

## Purpose

The other committed certification runs (`minimax-ref2v-cert-run-00{1,2,3,4,5}`)
prove the reference-directed pipeline is structurally sound: the node accepts
N reference images, resource usage stays stable, and swapping which image
occupies a slot changes the output (proven earlier via SHA-256 diff on
plumbing smoke tests). None of that proves the model actually *honors the
semantic content* of a reference image rather than merely consuming its
bytes.

This run re-certifies the same profile using four real, representative
reference photos instead of placeholder test assets (a cartoon drawing and a
solid color block), so the output can be visually checked against something
meaningful.

## Reference images used

All four are free-license stock photos from Unsplash (`images.unsplash.com`,
standard free tier, no attribution required), stored under
`reference-images/`:

| Slot | File | Role tested | Source (direct image URL) |
| :--- | :--- | :--- | :--- |
| 0 | `trinidad_subject.jpg` | subject_identity | `images.unsplash.com/photo-1613768924699-e71d952b8cc5` |
| 1 | `trinidad_product.jpg` | product | `images.unsplash.com/photo-1773394090007-9bba895df6be` |
| 2 | `trinidad_location.jpg` | location | `images.unsplash.com/photo-1607642875704-821b6eb0ba44` |
| 3 | `trinidad_style.jpg` | style/composition | `images.unsplash.com/photo-1562946723-2ee1c79439fc` |

A candidate Carnival costume photo was deliberately rejected for the
style/composition slot: it showed close-up, identifiable individuals in
revealing costumes, which is too sensitive to feed into synthetic video
generation even for internal QA. The steel pan drum photo (no people) was
used instead.

## Result

- Status: **PASSED**. Duration 467,839 ms, peak VRAM 21,258 MB — consistent
  with the other certified runs (see `result.json`).
- A representative output frame is saved as `output-frame.png` (extracted at
  frame 60 via ffmpeg from `minimax_h3_720p_ref2v_124f_00012_.mp4`).

## Visual assessment

The output frame is a tight facial close-up. Compared against the four
inputs:

- **Subject portrait** (dreadlocks, dark skin tone, outdoor setting): the
  output face has matching dreadlocks, matching skin tone, and a similar
  facial structure — a clear, meaningful visual correspondence to this
  specific reference photo. This is a materially different face than an
  earlier run using placeholder inputs (a cartoon drawing and a solid color
  block), which produced an unrelated generic face.
- **Product (Angostura bottles), location (Port of Spain waterfront), style
  (steel pan drum)**: no literal presence in this particular frame, which is
  expected — the shot is a tight portrait, so a background cityscape or
  bottle would not be expected to appear directly. Secondary references
  likely shape mood/style rather than composite literally when the subject
  reference dominates a close framing.

This is real evidence that the pinned node conditions on reference *content*,
not just reference *presence* — closing the gap left by the earlier
plumbing-only smoke tests for issue #329's "representative reference-role
combinations execute and are visually sanity-checked" acceptance criterion.
A follow-up wide-establishing-shot run (different prompt framing, same four
references) was submitted to check whether location/product/style references
become more visible in a scene shot rather than a tight portrait.
