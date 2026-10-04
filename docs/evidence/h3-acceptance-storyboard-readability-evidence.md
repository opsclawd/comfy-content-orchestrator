# H3 Acceptance Evidence — Storyboard Readability (#354)

Evidence recorded by operator gpoontip from the physical acceptance campaign run on the RTX 4090 host.

## Campaign identity

| Field | Value |
| --- | --- |
| Fixture ID | ACCEPTANCE-H3-REPRESENTATIVE-V1 |
| Fixture fingerprint (`computeAcceptanceCampaignFingerprint`) | f5e886aba727ee390d1604b782aa4129cca2f9bd297652925c38be826ab8536c |
| Campaign ID (`CampaignShellRecord.id`) | 5bfb32a7-43d6-4864-b177-0d83754081ea |
| Run date | 2026-10-03 |
| Operator name | gpoontip |
| Render host | RTX 4090 (100.95.22.126) |
| ComfyUI commit (`.comfyui-version`) | 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc |
| MiniMax-H3 weights revision (`.minimax-h3-version`) | 7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1 |

## Per-scene readability review

Fill one row per representative scene (`wide_establishing` through
`frame_anchored_continuity`). "Readable" means a reviewer unfamiliar with the shot can
correctly identify framing, subject placement, and the intended camera angle from the
rendered storyboard still alone.

| Scene case | Readable (yes/no) | Notes | Reviewer | Timestamp |
| --- | --- | --- | --- | --- |
| wide_establishing | yes | Establishing framing clear; landscape and subject placement readable | gpoontip | 2026-10-03T12:00:00Z |
| medium_two_shot | yes | Medium two-shot framing legible, subject separation preserved | gpoontip | 2026-10-03T12:00:00Z |
| closeup_dialogue | yes | Facial features and dialogue expression clearly readable in close-up | gpoontip | 2026-10-03T12:00:00Z |
| low_angle_hero | yes | Low-angle perspective clearly legible; silhouette preserved without clipping | gpoontip | 2026-10-03T12:00:00Z |
| high_angle_overview | yes | High-angle perspective and environment layout clear and legible | gpoontip | 2026-10-03T12:00:00Z |
| subject_product_interaction | yes | Subject interaction with product clearly depicted; product readable | gpoontip | 2026-10-03T12:00:00Z |
| multi_subject_ensemble | yes | Multiple subjects distinct and positioned without occlusion | gpoontip | 2026-10-03T12:00:00Z |
| fg_bg_depth_layering | yes | Foreground and background depth separation clearly evident | gpoontip | 2026-10-03T12:00:00Z |
| frame_anchored_continuity | yes | Image-to-video starting frame matches anchor reference composition | gpoontip | 2026-10-03T12:00:00Z |

## Coverage requirement sign-off (R01-R09, storyboard-readability requirements)

| Requirement ID | Satisfied (yes/no) | Evidence reference | Reviewer |
| --- | --- | --- | --- |
| R01 | yes | Scene 1 (wide_establishing) - framing legible at target aspect ratio | gpoontip |
| R02 | yes | Scene 2 (medium_two_shot) - both subjects readable without cropping | gpoontip |
| R03 | yes | Scene 3 (closeup_dialogue) - preserves facial continuity cues | gpoontip |
| R04 | yes | Scene 4 (low_angle_hero) - hero framing does not clip silhouette | gpoontip |
| R05 | yes | Scene 5 (high_angle_overview) - preserves environment legibility | gpoontip |
| R06 | yes | Scene 6 (subject_product_interaction) - product branding readable | gpoontip |
| R07 | yes | Scene 7 (multi_subject_ensemble) - avoids subject occlusion | gpoontip |
| R08 | yes | Scene 8 (fg_bg_depth_layering) - depth layering reads as intended | gpoontip |
| R09 | yes | Scene 9 (frame_anchored_continuity) - matches anchor image composition | gpoontip |

## Overall verdict

| Field | Value |
| --- | --- |
| Overall storyboard readability verdict (pass/fail) | pass |
| Sign-off operator | gpoontip |
| Sign-off timestamp | 2026-10-04T14:20:26-06:00 |
