# FastH3-Omni Multi-Reference Draft Evaluation Report Template

> **OPERATOR INSTRUCTIONS:**  
> This template is a **blank** evaluation form and runbook for live physical execution on dedicated NVIDIA RTX 4090 GPU render hosts (Phase B of Issue #468).  
> Per `AGENTS.md` and repository governance boundaries, automated coding agents must **never** author synthetic hardware measurements, pre-populate benchmark metrics, or assert affirmative GO/NO-GO verdicts.  
> Complete each section only after executing both the candidate FastH3-Omni run and the comparator baseline (`ref2va-turbo-4` and `canonical-base-20`) under strictly matched physical conditions.  
> See the specification document [FastH3-Omni Experiments Specification](fasth3-omni-experiments.md) for full setup instructions and hardware preflight sequences.

---

## 1. Execution Metadata & Hardware Provenance

| Field | Record / Value |
| :--- | :--- |
| **Run Identifier** | `<run-id>` |
| **Evaluation Timestamp** | `<iso-8601-timestamp>` |
| **Operator Identity** | `<operator-name-or-id>` |
| **Render Host Hostname** | `<hostname>` |
| **GPU Model & UUID** | `NVIDIA GeForce RTX 4090` / `<gpu-uuid>` |
| **NVIDIA Driver & CUDA** | `<driver-version>` / `<cuda-version>` |
| **FastVideo Source Commit** | `7203b4976eefcd70a52728ca1281797ce96734eb` |
| **FastH3-Omni DiT Weights SHA-256** | `851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80` |
| **Descriptor Digest** | `<descriptor-digest-sha256>` |
| **Candidate Execution State** | `[ ] PENDING  [ ] EXECUTED  [ ] ABORTED` |

---

## 2. Hardware Resource & Telemetry Observations

| Phase / Resource Metric | Observed Candidate (FastH3-Omni) | Observed Comparator (`ref2va-turbo-4`) | Observed Baseline (`canonical-base-20`) |
| :--- | :--- | :--- | :--- |
| **Resolution & Frames** | `<width>x<height>` / `<frames>f` | `<width>x<height>` / `<frames>f` | `<width>x<height>` / `<frames>f` |
| **Cold Start / Model Load Time (s)** | `<cold-load-seconds>` | `<cold-load-seconds>` | `<cold-load-seconds>` |
| **Conditioning / Encode Time (s)** | `<conditioning-seconds>` | `<conditioning-seconds>` | `<conditioning-seconds>` |
| **DiT Sampling Wall Time (s)** | `<sampling-seconds>` | `<sampling-seconds>` | `<sampling-seconds>` |
| **VAE Decode Time (s)** | `<decode-seconds>` | `<decode-seconds>` | `<decode-seconds>` |
| **Total Generation Wall Time (s)** | `<total-wall-seconds>` | `<total-wall-seconds>` | `<total-wall-seconds>` |
| **Peak VRAM Allocation (MB)** | `<peak-vram-mb>` | `<peak-vram-mb>` | `<peak-vram-mb>` |
| **Peak Host RAM (MB)** | `<peak-host-ram-mb>` | `<peak-host-ram-mb>` | `<peak-host-ram-mb>` |
| **Swap Usage Delta (MB)** | `<swap-delta-mb>` | `<swap-delta-mb>` | `<swap-delta-mb>` |
| **Observed Sampling Steps** | `<observed-steps>` | `<observed-steps>` | `<observed-steps>` |
| **Kernel Backend Used** | `<kernel-backend>` | `<kernel-backend>` | `<kernel-backend>` |
| **OOM or Swap Thrashing Observed** | `[ ] YES  [ ] NO` | `[ ] YES  [ ] NO` | `[ ] YES  [ ] NO` |

---

## 3. Output Stream Conformance (`ffprobe`)

| Checkpoint / Fact | Required / Target | Observed Output Video | Status |
| :--- | :--- | :--- | :--- |
| **Video Dimensions** | `<width>x<height>` | `<actual-width>x<actual-height>` | `[ ] PASS  [ ] FAIL` |
| **Frame Count** | `<target-frames>` | `<actual-frames>` | `[ ] PASS  [ ] FAIL` |
| **Nominal Frame Rate** | `24 fps` | `<actual-fps>` | `[ ] PASS  [ ] FAIL` |
| **Video Stream Codec** | `h264 / hevc` | `<codec-name>` | `[ ] PASS  [ ] FAIL` |
| **Audio Stream Present** | `true` | `[ ] YES  [ ] NO` | `[ ] PASS  [ ] FAIL` |
| **Audio Codec & Channels** | `aac / 2 channels` | `<audio-codec> / <channels>` | `[ ] PASS  [ ] FAIL` |
| **File SHA-256 Digest** | — | `<output-file-sha256>` | — |

---

## 4. Full-Video Creative & Aesthetic Rubric Evaluation

*(Assessed by human reviewer inspecting full playback at native frame rate)*

| Evaluation Dimension | Score (1–5) | Detailed Reviewer Notes & Failure Modes Observed |
| :--- | :--- | :--- |
| **Reference Identity Fidelity (Face/Hands)** | `<score-1-to-5>` | `<notes-on-facial-likeness-and-hand-structure>` |
| **Wardrobe & Product Adherence** | `<score-1-to-5>` | `<notes-on-clothing-consistency-and-brand-props>` |
| **Location & Setting Consistency** | `<score-1-to-5>` | `<notes-on-lighting-background-and-environment>` |
| **Temporal Coherence (Flicker/Drift)** | `<score-1-to-5>` | `<notes-on-subject-drift-or-background-warping>` |
| **Camera Motion Stability** | `<score-1-to-5>` | `<notes-on-panning-jitter-or-abrupt-cuts>` |
| **Audio-Visual Synchronization** | `<score-1-to-5>` | `<notes-on-soundtrack-sync-and-voice-alignment>` |

---

## 5. Comparative Trade-off Summary (Speed vs. Quality)

| Engine Candidate | Total Wall Time (s) | Effective Acceptance Rate (%) | Cost Per Accepted Clip | Creative Usability Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **FastH3-Omni (8-step INT8)** | `<wall-time-s>` | `<acceptance-rate-%>` | `<cost-per-accepted>` | `<usability-notes>` |
| **Ref2VA Turbo-4 (4-step LoRA)** | `<wall-time-s>` | `<acceptance-rate-%>` | `<cost-per-accepted>` | `<usability-notes>` |
| **Ref2VA Base-20 (20-step Ground Truth)** | `<wall-time-s>` | `100% (Ceiling)` | `<cost-per-accepted>` | `<usability-notes>` |

---

## 6. Operator Disposition & Governance Exit Gate Sign-Off

### Sign-off Checklist
- [ ] Model weights cryptographically verified locally against the audited per-file SHA-256 of the FastVideo export.
- [ ] Single RTX 4090 24GB execution completed without out-of-memory or pathological swap expansion.
- [ ] Corporate legal counsel reviewed and approved commercial licensing under MiniMax Community License.
- [ ] Matched comparator benchmark executed and logged.
- [ ] Visual review of complete video performed across all rubric dimensions.

### Final Candidate Disposition
- **Speed & Latency Sign-off:**  
  `[ ] PENDING    [ ] GO    [ ] CONDITIONAL    [ ] NO-GO`
- **Aesthetic & Reference Fidelity Sign-off:**  
  `[ ] PENDING    [ ] GO    [ ] CONDITIONAL    [ ] NO-GO`
- **Commercial Licensing Sign-off:**  
  `[ ] PENDING    [ ] GO    [ ] CONDITIONAL    [ ] NO-GO`

**Overall Operator Disposition:**  
`[ ] PENDING`  
`[ ] GO (Eligible for candidate draft profile admission in #424)`  
`[ ] CONDITIONAL (Requires specific tuning or restricted parameter envelope)`  
`[ ] NO-GO (Rejected for RTX 4090 draft rendering)`  

**Operator Signature:** `___________________________`  
**Date:** `___________________________`
