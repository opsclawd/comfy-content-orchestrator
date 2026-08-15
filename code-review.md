# Integration Code Review

## Findings

### 1. Incompatible Model Category Abstraction (text_encoders vs clip)
- **Severity**: high
- **File path**: `packages/infrastructure/src/comfyui/provenance/hasher.ts`, `templates/provenance.json`
- **Evidence**: `VALID_MODEL_CATEGORIES` defines `"text_encoders"` instead of `"clip"`. `resolveModelFilePath` builds the target path exactly using `resolve(comfyUiDir, "models", spec.category)`, which produces `models/text_encoders/...`. The LTX profile in `provenance.json` references `"text_encoders"`. However, ComfyUI natively stores CLIP models (like T5XXL) in the `models/clip/` directory.
- **Failure mode**: When executing on a standard ComfyUI installation, the provenance collector will look for `models/text_encoders/t5xxl_fp16.safetensors`, fail with `ENOENT`, and abort the certification process.
- **Required fix**: Change `"text_encoders"` to `"clip"` in `VALID_MODEL_CATEGORIES` (and the `ModelCategory` type) inside `hasher.ts`, and update the category string in `templates/provenance.json` to `"clip"`. Alternatively, implement a directory mapping layer in `resolveModelFilePath` so that `"text_encoders"` correctly aliases to `"clip"`.

### 2. Composition-root Omission for Provenance APIs
- **Severity**: high
- **File path**: `packages/infrastructure/src/index.ts`
- **Evidence**: The PR adds powerful new provenance collection APIs (`collectCertificationProvenance`, `CertificationProvenanceReport`, `loadCertificationProfile`, `CertificationProfile`), but does not export any of them from the `@cco/infrastructure` composition root (`packages/infrastructure/src/index.ts`).
- **Failure mode**: Other downstream tasks (such as the benchmark runner in S1-07 or the manifest generator) that depend on `@cco/infrastructure` to programmatically trigger or consume provenance data will either fail to import these modules or be forced to bypass the package boundary by importing deep internal paths.
- **Required fix**: Update `packages/infrastructure/src/index.ts` to export the public interfaces and functions from `src/comfyui/provenance/collector.ts` and `src/comfyui/provenance/profile-manifest.ts`.

