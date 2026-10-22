# Verified-Batch Operator Workspace Acceptance Matrix (Phase 1 / #477)

## Overview & Authority Notice

This document establishes the acceptance matrix and evidence gates for **Issue #477 ([469 / VPM-P1.8])**: the minimal verified-batch operator workspace in Review Hub and the Phase 1 end-to-end evidence gate.

> [!IMPORTANT]
> **Authenticity Separation & Non-Certification Notice:**
> Autonomous CI testing verifies software contracts, tenant isolation, schema parsing, decimal preservation, and state transitions. **CI tests NEVER certify real-world physical authenticity, generative fidelity, or regulatory legal compliance of cannabis or consumer products.** Real-world authenticity and accuracy of physical documents require independent human operator evaluation as detailed in [docs/verified-batch-operator-runbook.md](verified-batch-operator-runbook.md).
> Furthermore, Phase 1 completion does not certify compliance of any external distribution or generative fidelity; downstream campaign template pinning, assembly admission, and generative reels remain gated.

---

## 1. Acceptance Matrix

| Gate ID | Capability / Invariant | Validation Method | Automated Test Reference | Gate Status |
| :--- | :--- | :--- | :--- | :--- |
| **GATE-1** | **Client Chooser & Scoped Navigation**<br>Operators select from authorized clients; workspace scopes routes to `/clients/[clientId]/products` and `/batches/[batchId]`. Reversible breadcrumbs and back navigation. | Unit + E2E | `apps/web/src/app/api/authorized-clients/route.test.ts`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-2** | **SKU & Lot Management**<br>Create canonical SKU and physical lot identifier. Set origin kind (`own_production`, `partner_origin`, `unknown`) and producer name. | Unit + E2E | `apps/web/src/components/product-evidence/batch-facts-panel.test.tsx`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-3** | **Safe Source Inspection**<br>Display cryptographic SHA-256, byte length, MIME, capture date, precision, and retention tier without leaking MinIO paths, bucket names, or internal keys. | Unit + E2E | `apps/web/src/components/product-evidence/source-inspection-panel.test.tsx`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-4** | **Ephemeral Media Inspection**<br>Component requests short-lived presigned URL (300-second TTL) on demand. URL expires from memory without becoming a permanent database record. | Unit + E2E | `apps/web/src/api/product-evidence-forwarder.test.ts`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-5** | **Lossless Decimal Transcription**<br>Transcribe CoA measurements preserving exact string notation (e.g. `24.5000`) without floating-point IEEE 754 coercion or rounding. | Unit + E2E | `apps/web/src/components/product-evidence/format-decimal.test.ts`<br>`apps/web/src/components/product-evidence/coa-reports-panel.test.tsx`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-6** | **Provenance Dimensions Visibly Distinct**<br>Operators distinguish `Reported`, `Operator-Attested`, `Operator-Reviewed`, `Independently Sourced`, `Unknown`, and `Blocked` without reading raw JSON manifests. | Unit + E2E | `apps/web/src/components/product-evidence/provenance-badges.test.tsx`<br>`apps/web/src/components/product-evidence/batch-dossier-summary.test.tsx`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-7** | **Deep-Link SKU Verification & Tenant Scoping**<br>A URL requesting `/clients/[clientId]/products/[skuId]/batches/[batchId]` verifies lot ownership. Mismatched SKUs fail safely; foreign client data is inaccessible. | Unit + E2E | `apps/web/src/api/product-evidence-forwarder.test.ts`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-8** | **Evidence Linkage & Invalidation Cascades**<br>Claims without active evidence links are blocked. Linking valid, reviewed CoA evidence unlocks support eligibility. Superseding/archiving evidence blocks dependent claims. | Unit + E2E | `apps/web/src/components/product-evidence/product-claims-panel.test.tsx`<br>`e2e/tests/verified-batch-workspace.spec.ts` | **VERIFIED (Unit/Component) / PENDING E2E EXECUTION** |
| **GATE-9** | **Decoupled Architecture Boundaries**<br>Web frontend imports exclusively from `@cco/contracts` and `@cco/shared`. Zero illegal dependencies into `@cco/application`, `@cco/domain`, or `@cco/infrastructure`. | Architecture Linter | `pnpm boundaries` (1011 modules cruised, 0 errors) | **PASS (Automated)** |
| **GATE-10** | **Human Operator Data-Accuracy Verification**<br>Manual verification of one real-world sample lot against original physical PDF/paper records. | Manual Inspection | Documented in `docs/verified-batch-operator-runbook.md` | **PENDING OPERATOR** |

---

## 2. Test Execution Summary

The software gate has been verified through unit and component test suites:
- **Web Components & Provenance Panels**: 27 unit/component tests passed across 7 suites (`pnpm vitest run apps/web/src/components/product-evidence/`).
- **Web App Router Endpoints & API Forwarder**: 127 tests passed across 5 suites (`pnpm vitest run apps/web/src/api/`).
- **Architecture Integrity**: `pnpm boundaries` passed with 0 violations.
- **E2E Playwright Specifications**: `e2e/tests/verified-batch-workspace.spec.ts` defines the end-to-end integration gate covering synthetic batch lifecycle, deep-link security mismatch, reachable media delivery, and separation of duties. (Run via Playwright test environment in CI or operator integration run).

## 3. Operator Review Sign-off Template

*(To be executed by a human compliance/QA operator on a designated staging environment. Do NOT fill via automated agents.)*

```markdown
### Verification Checklist
- [ ] Review Hub URL accessed via authorized Tailscale director session: <staging-url>
- [ ] Sample non-public SKU created: <sample-sku-id>
- [ ] Sample physical Lot created: <sample-lot-id>
- [ ] Original lab certificate uploaded and SHA-256 confirmed against local file: <local-sha256>
- [ ] Transcribed CoA measurements manually matched against PDF values without discrepancy.
- [ ] Claim proposed, linked, and reviewed by separate authorized reviewer.
- [ ] Source retention policy confirmed (`source_evidence_archive` with designated retention policy version).

### Phase 1 Sign-Off
- Reviewing Operator: <operator-name>
- Role / Department: <compliance-or-qa-title>
- Review Date: <YYYY-MM-DD>
- Recommendation: [ ] GO  /  [ ] NO-GO
- Notes / Observations:
  <operator-notes>
```
