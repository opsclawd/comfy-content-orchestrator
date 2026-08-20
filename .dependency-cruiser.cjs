/**
 * Clean Architecture / DDD boundary enforcement.
 *
 * Rules transcribed from PRD §3.6.2. Dependency direction is an architectural
 * constraint enforced mechanically in CI, not a style preference.
 *
 * Layer order (a layer may only depend on layers below it):
 *
 *   apps/control-api, apps/render-worker   composition roots (wire everything)
 *   apps/web                               contracts + presentation-safe types
 *   infrastructure                         domain types + application ports
 *   application                            domain, contracts, shared
 *   domain                                 shared
 *   shared                                 nothing
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are forbidden (PRD §3.6.2).",
      from: {},
      to: { circular: true }
    },
    {
      name: "domain-only-shared",
      severity: "error",
      comment:
        "`domain` may depend only on `shared`. It contains no PostgreSQL, HTTP, ComfyUI, " +
        "MinIO, provider SDK, FFmpeg, filesystem, or Tailscale code.",
      from: { path: "^packages/domain" },
      to: {
        path: "^(packages/(application|infrastructure|contracts)|apps)"
      }
    },
    {
      name: "application-no-infrastructure",
      severity: "error",
      comment:
        "`application` depends on `domain`, `contracts`, and `shared`; it must not import " +
        "infrastructure adapters. Provider selection, retry, and fallback are application " +
        "concerns expressed through ports.",
      from: { path: "^packages/application" },
      to: { path: "^(packages/infrastructure|apps)" }
    },
    {
      name: "infrastructure-no-application-use-cases",
      severity: "error",
      comment:
        "`infrastructure` implements application ports and may import domain types plus " +
        "application port contracts — not application use cases. Adapters execute requests; " +
        "they never decide scene progression, retry policy, or provider routing.",
      from: { path: "^packages/infrastructure" },
      to: {
        path: "^packages/application/(?!src/ports)",
        pathNot: "^packages/application/src/ports"
      }
    },
    {
      name: "infrastructure-not-in-apps",
      severity: "error",
      comment: "`infrastructure` must not import from any app.",
      from: { path: "^packages/infrastructure" },
      to: { path: "^apps" }
    },
    {
      name: "web-no-server-packages",
      severity: "error",
      comment:
        "`web` consumes `contracts` and presentation-safe shared/domain types only. It must " +
        "not import server application or infrastructure packages.",
      from: { path: "^apps/web" },
      to: { path: "^packages/(application|infrastructure)" }
    },
    {
      name: "contracts-are-standalone",
      severity: "error",
      comment: "`contracts` are stable cross-process schemas; they may depend only on `shared`.",
      from: { path: "^packages/contracts" },
      to: {
        path: "^(packages/(domain|application|infrastructure)|apps)"
      }
    },
    {
      name: "shared-is-a-sink",
      severity: "error",
      comment: "`shared` holds pure cross-cutting primitives and may not depend on any layer.",
      from: { path: "^packages/shared" },
      to: { path: "^(packages/(domain|application|infrastructure|contracts)|apps)" }
    },
    {
      name: "apps-do-not-cross-wire",
      severity: "error",
      comment:
        "Composition roots wire packages, not each other. Cross-layer wiring occurs only in " +
        "apps/control-api and apps/render-worker.",
      from: { path: "^apps/([^/]+)" },
      to: {
        path: "^apps/([^/]+)",
        pathNot: "^apps/$1"
      }
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Modules reachable from nothing are usually dead code.",
      from: { orphan: true, pathNot: "\\.(d\\.ts|config\\.[cm]?[jt]s)$" },
      to: {}
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(\\.next|dist|coverage)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"]
    },
    reporterOptions: {
      text: { highlightFocused: true }
    }
  }
};
