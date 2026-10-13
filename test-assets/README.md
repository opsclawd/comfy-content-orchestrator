# Issue #423 feasibility-matrix input assets

All images here are reused from `certification/minimax-h3/minimax-ref2v-visual-qa-001/reference-images/`
(free-license Unsplash stock photos, standard free tier, no attribution
required — see that directory's README for the original sourcing table),
not newly introduced content.

- `trinidad_subject.jpg`, `trinidad_product.jpg`, `trinidad_location.jpg`,
  `trinidad_style.jpg` — unmodified copies, used as the Ref2V reference set
  (same 4 images, same roles, as the prior certified 124-frame run).
- `trinidad_subject_16x9.jpg` — **derived** from `trinidad_subject.jpg`:
  center-cropped from 1024x819 to 1024x585 (ratio 1.7504, vs. the 1344x768
  canvas's 1.75 — within the harness's 5% deviation limit) so it can be used
  as the I2V single start frame, which the harness's aspect-ratio check
  otherwise rejects at the original 1024x819 (1.2503, 28.6% deviation). This
  is the only reference image whose content (a person) is appropriate for
  judging #423's "identity/wardrobe fidelity" and "human action" acceptance
  criteria — `trinidad_location.jpg` is the only one of the four that passes
  the aspect-ratio check unmodified, but has no subject in it.
