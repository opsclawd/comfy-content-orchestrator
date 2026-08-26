# Infrastructure Component Governance Registry

Per PRD §2.4 and §9.6, external infrastructure components and dependencies are tracked with their license source, deployment model, and review date.

---

## MinIO S3-Compatible Object Store

| Attribute | Specification |
|---|---|
| **Component** | MinIO Object Storage |
| **Container Image / Version** | `minio/minio:RELEASE.2024-01-18T22-51-28Z` ([Docker Hub](https://hub.docker.com/r/minio/minio/tags?name=RELEASE.2024-01-18T22-51-28Z)) |
| **Source Repository** | [minio/minio (GitHub)](https://github.com/minio/minio/tree/RELEASE.2024-01-18T22-51-28Z) |
| **License** | [GNU AGPLv3](https://github.com/minio/minio/blob/RELEASE.2024-01-18T22-51-28Z/LICENSE) |
| **Review Date** | 2026-08-26 |
| **Deployment Model** | Standalone, unmodified separate network service deployed via Docker Compose (`compose.yaml`) on Hetzner CPX31 Control Plane |
| **Network Boundary** | Tailscale WireGuard mesh only (`storage-01.godzspeed-internal.ts.net:9000`); no public WAN listener |
| **Admin Separation** | MinIO Console (port 9001) bound to loopback/operator ACLs (`OPERATOR_BIND_IP`); not accessible to general review clients |
| **Integration Architecture** | Clean Architecture `@cco/infrastructure` adapters communicating strictly via standard S3 API (`@aws-sdk/client-s3`) over Tailscale network |

### Compliance & Governance Policy

1. **Unmodified Standalone Service:** MinIO is deployed strictly as an unmodified upstream container service. It is never embedded into proprietary Node.js/TypeScript application binaries or linked into application artifacts.
2. **Backend Portability:** Application domain and use cases depend exclusively on `ObjectStoragePort` and `ReviewMediaDeliveryPort` abstractions in `@cco/application`. Any S3-compliant store (e.g. AWS S3, Cloudflare R2, Ceph) can replace MinIO without touching domain or application business logic.
3. **Conditional Policy & Legal Scope:** MinIO is permitted solely under this repository's conditional policy as an unmodified separate network service. No legal approval beyond this conditional policy is claimed. Any modification to MinIO source code or redistribution requires formal OSS legal review before deployment.

---

## S3 Bucket Lifecycle & Retention Semantics

The Godzspeed platform provisions four bucket classes (PRD §2.3):

| Bucket Class | Purpose | Configured S3 Expiry Rule | Retention Policy Semantics |
|---|---|---|---|
| `godzspeed-temp` | Rejected candidates, transient intermediates, temporary render stems | **14 days** (`godzspeed-temp-retention-14d`) | Automated deletion 14 days after object creation. |
| `godzspeed-review` | Storyboard candidates, WebP keyframes, proxy MP4s, review audio | **60 days** (`godzspeed-review-retention-60d`) | Automated deletion 60 days after object creation. |
| `godzspeed-reference` | Active client logos, reference previews, compact brand assets | **None** (No S3 expiry rule) | Retained **while client is active**. Managed by application/operator workflows. S3 object-age deletion would unsafely delete active client assets. |
| `godzspeed-delivery` | Approved delivery copies awaiting client handoff | **None** (Documented retention gap) | Retained **90 days after campaign completion**. S3 lifecycle rules cannot natively calculate campaign completion status. Automated upload-age deletion is intentionally omitted to prevent premature deletion of live deliveries. |

### Documented Delivery Retention Gap

The PRD requires `godzspeed-delivery` objects to be retained for 90 days *after campaign completion*.
- S3 lifecycle configurations only evaluate object creation/upload age or object tags/prefixes.
- The campaign completion event tagging workflow is scheduled for a future sprint when campaign completion lifecycle transitions are implemented.
- Applying a naive 90-day-from-upload S3 lifecycle rule would delete delivery copies for long-running campaigns while they are still awaiting client review or handoff.
- Therefore, automated S3 expiry is omitted for `godzspeed-delivery` until campaign completion tagging is operational.
