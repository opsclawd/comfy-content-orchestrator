# H3 Acceptance Evidence — Final Multi-Scene Acceptance (#332)

Evidence recorded by operator gpoontip from the physical acceptance campaign run on the RTX 4090 host.

## Campaign identity

| Field | Value |
| --- | --- |
| Fixture ID | ACCEPTANCE-H3-REPRESENTATIVE-V1 |
| Fixture fingerprint (`computeAcceptanceCampaignFingerprint`) | f5e886aba727ee390d1604b782aa4129cca2f9bd297652925c38be826ab8536c |
| Campaign ID (`CampaignShellRecord.id`) | 5bfb32a7-43d6-4864-b177-0d83754081ea |
| Campaign production run ID | 01a0fec6-ff46-7d5a-bb87-b08c07b79de8 |
| Run date | 2026-10-03 |
| Operator name | gpoontip |
| Render host | RTX 4090 (100.95.22.126) |

## Per-scene production acceptance

| Scene case | ProductionAttempt ID | Accepted (yes/no) | Notes | Reviewer |
| --- | --- | --- | --- | --- |
| wide_establishing | 2be9e22d-08bc-4635-a2bf-d9f45d7f97be | yes | Golden hour landscape aesthetic and framing accepted (Attempt 2) | gpoontip |
| medium_two_shot | 129bc8e9-a27f-42ef-8d00-9355f9e95e59 | yes | Dolly-in interior motion and two-shot composition accepted (Attempt 2) | gpoontip |
| closeup_dialogue | 3ae98634-c775-4fa5-b209-47fd53b37656 | yes | High-key lighting and close-up facial rendering accepted (Attempt 1) | gpoontip |
| low_angle_hero | 025bd882-f2d8-4af2-bca5-da65f1effe61 | yes | Tracking low-angle dramatic motion accepted (Attempt 1) | gpoontip |
| high_angle_overview | 34076687-fbf6-45e0-ac7b-dfcdd377c4ac | yes | Pan-left high-angle motion and environment accepted (Attempt 1) | gpoontip |
| subject_product_interaction | 1813df08-1360-4017-8c39-c9c67c5cb043 | yes | Tracking studio product interaction accepted (Attempt 1) | gpoontip |
| multi_subject_ensemble | fcc22168-dfbf-45ba-9c70-b7676043290c | yes | Static ensemble framing with distinct subjects accepted (Attempt 1) | gpoontip |
| fg_bg_depth_layering | 1279f240-eab8-41e1-900c-3da5c375f18f | yes | Dolly-out depth parallax accepted (Attempt 1) | gpoontip |
| frame_anchored_continuity | e0b5af66-7419-464a-bb6a-06dfcb4a893b | yes | Frame-anchored I2V motion from start-frame anchor accepted (Attempt 1) | gpoontip |

## Coverage requirement sign-off (R10-R27, multi-scene acceptance requirements)

| Requirement ID | Satisfied (yes/no) | Evidence reference | Reviewer |
| --- | --- | --- | --- |
| R10 | yes | Reference-directed mode exercised across Scenes 1-8 | gpoontip |
| R11 | yes | Frame-anchored mode exercised by Scene 9 | gpoontip |
| R12 | yes | subject_identity reference role bound and conditioned Scenes 1-8 | gpoontip |
| R13 | yes | product reference role bound and conditioned Scenes 1-8 | gpoontip |
| R14 | yes | location reference role bound and conditioned Scenes 1-8 | gpoontip |
| R15 | yes | style reference role bound and conditioned Scenes 1-8 | gpoontip |
| R16 | yes | composition reference role bound and conditioned Scenes 1-8 | gpoontip |
| R17 | yes | Explicit routingMode declared on all 9 scenes | gpoontip |
| R18 | yes | Campaign scene count matches 9 declared representative scenes | gpoontip |
| R19 | yes | All asset slots resolved to hash-pinned fixture files | gpoontip |
| R20 | yes | Covers low-angle (Scene 4) and high-angle (Scene 5) variation | gpoontip |
| R21 | yes | Covers multi-subject (Scene 7) and fg/bg depth (Scene 8) | gpoontip |
| R22 (static camera intent) | yes | Static camera exercised in Scenes 1, 3, 7, 9 | gpoontip |
| R23 (dolly/pan/tracking movement intent) | yes | Dolly (2, 8), pan (5), and tracking (4, 6) exercised | gpoontip |
| R24 (indoor environment intent) | yes | Indoor environment exercised in Scenes 2, 3, 6, 7 | gpoontip |
| R25 (outdoor environment intent) | yes | Outdoor environment exercised in Scenes 1, 4, 5, 8, 9 | gpoontip |
| R26 (lighter/commercial lighting intent) | yes | Commercial/golden hour lighting in Scenes 1, 3, 7, 8, 9 | gpoontip |
| R27 (darker/dramatic lighting intent) | yes | Low-key dramatic lighting in Scene 4 | gpoontip |

## Final delivery reel

| Field | Value |
| --- | --- |
| AssemblyManifest ID | asm-08e8ff00ad993c09e831813018889398 |
| Final delivery reel location | campaigns/5bfb32a7-43d6-4864-b177-0d83754081ea/assemblies/asm-08e8ff00ad993c09e831813018889398/output.mp4 |
| Director watch/download confirmation | yes — watched 46.5s delivery reel in web dashboard; confirmed video quality and download |

## Overall verdict

| Field | Value |
| --- | --- |
| Overall multi-scene acceptance verdict (pass/fail) | pass |
| Sign-off operator | gpoontip |
| Sign-off timestamp | 2026-10-04T14:20:26-06:00 |
