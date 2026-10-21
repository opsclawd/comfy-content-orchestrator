import { describe, expect, it } from "vitest";
import { createCoaMeasurement, rehydrateCoaMeasurement } from "./coa-measurement.js";
import {
  createBatchId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId
} from "./identifiers.js";
import { ProductValidationError } from "./product-evidence-errors.js";

describe("CoaMeasurement Domain Invariants", () => {
  const baseInput = {
    measurementId: createCoaMeasurementId("018f6f00-0000-7000-8000-000000000001"),
    clientId: createClientId("018f6f00-0000-7000-8000-000000000002"),
    reportId: createCoaReportId("018f6f00-0000-7000-8000-000000000003"),
    reportRevision: 1,
    batchId: createBatchId("018f6f00-0000-7000-8000-000000000004"),
    evidenceId: createEvidenceId("018f6f00-0000-7000-8000-000000000005"),
    evidenceRevision: 1,
    analyte: "THCA",
    resultKind: "quantified" as const,
    resultValue: "24.5000",
    unit: "percent_w_w",
    basis: "dry_weight",
    context: "flower",
    quantityKind: "mass_fraction",
    methodAsReported: "HPLC-DAD",
    uncertaintyAbsolute: "0.25",
    detectionLimit: "0.01",
    quantificationLimit: "0.05"
  };

  it("creates a valid quantified measurement with exact decimal spelling", () => {
    const m = createCoaMeasurement(baseInput);
    expect(m.analyte).toBe("THCA");
    expect(m.resultValue).toBe("24.5000");
    expect(m.unit).toBe("percent_w_w");
    expect(m.quantityKind).toBe("mass_fraction");
    expect(m.uncertaintyAbsolute).toBe("0.25");
    expect(m.detectionLimit).toBe("0.01");
    expect(m.quantificationLimit).toBe("0.05");
  });

  it("rejects quantified measurement without resultValue or with non-decimal strings", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultValue: undefined
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultValue: "24.5% "
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultValue: "1e-2"
      })
    ).toThrow(ProductValidationError);
  });

  it("rejects quantified measurement when limit or qualifier are provided", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultLimit: "0.05"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultQualifier: "lt"
      })
    ).toThrow(ProductValidationError);
  });

  it("enforces negative quantified value policy: requires negative_as_reported qualifier and explanation", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        unit: "mg_per_l",
        quantityKind: "mass_concentration",
        resultValue: "-0.05"
      })
    ).toThrow(ProductValidationError);

    const m = createCoaMeasurement({
      ...baseInput,
      unit: "mg_per_l",
      quantityKind: "mass_concentration",
      resultValue: "-0.05",
      analyticalQualifierCode: "negative_as_reported",
      analyticalQualifierExplanation:
        "Baseline instrument baseline noise offset reported by laboratory"
    });
    expect(m.resultValue).toBe("-0.05");
    expect(m.analyticalQualifierCode).toBe("negative_as_reported");
  });

  it("enforces percent 0..100 bounds strictly", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultValue: "100.0001"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultValue: "-0.0001",
        analyticalQualifierCode: "negative_as_reported",
        analyticalQualifierExplanation: "Negative baseline"
      })
    ).toThrow(ProductValidationError); // Qualifiers never excuse invalid percent bounds
  });

  it("creates valid below_limit measurement with strictly positive threshold and qualifier", () => {
    const m = createCoaMeasurement({
      ...baseInput,
      resultKind: "below_limit",
      resultValue: null,
      resultLimit: "0.050",
      resultQualifier: "lt"
    });
    expect(m.resultLimit).toBe("0.050");
    expect(m.resultQualifier).toBe("lt");
    expect(m.resultValue).toBeNull();
  });

  it("rejects below_limit with non-positive limit or missing qualifier", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultKind: "below_limit",
        resultValue: null,
        resultLimit: "0",
        resultQualifier: "lt"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultKind: "below_limit",
        resultValue: null,
        resultLimit: "-0.01",
        resultQualifier: "lt"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultKind: "below_limit",
        resultValue: null,
        resultLimit: "0.05",
        resultQualifier: undefined
      })
    ).toThrow(ProductValidationError);
  });

  it("creates valid not_detected measurement", () => {
    const m = createCoaMeasurement({
      ...baseInput,
      resultKind: "not_detected",
      resultValue: null,
      resultLimit: null,
      resultQualifier: null
    });
    expect(m.resultKind).toBe("not_detected");
    expect(m.resultValue).toBeNull();
    expect(m.resultLimit).toBeNull();
  });

  it("rejects not_detected when value or limit is provided", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultKind: "not_detected",
        resultValue: "0",
        resultLimit: null
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        resultKind: "not_detected",
        resultValue: null,
        resultLimit: "0.05"
      })
    ).toThrow(ProductValidationError);
  });

  it("rejects contradictory unit and quantityKind combinations", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        unit: "percent_w_w",
        quantityKind: "volume_fraction"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        unit: "mg_per_g",
        quantityKind: "mass_concentration"
      })
    ).toThrow(ProductValidationError);
  });

  it("enforces LOD <= LOQ consistency", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        detectionLimit: "0.10",
        quantificationLimit: "0.05"
      })
    ).toThrow(ProductValidationError);
  });

  it("enforces fraction 0..1 bounds strictly", () => {
    const fractionInput = {
      ...baseInput,
      unit: "fraction_w_w",
      quantityKind: "mass_fraction",
      resultValue: "0.2450",
      uncertaintyAbsolute: "0.0025",
      detectionLimit: "0.0001",
      quantificationLimit: "0.0005"
    };
    const m = createCoaMeasurement(fractionInput);
    expect(m.resultValue).toBe("0.2450");

    expect(() =>
      createCoaMeasurement({
        ...fractionInput,
        resultValue: "1.0001"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...fractionInput,
        resultValue: "-0.0001"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...fractionInput,
        uncertaintyAbsolute: "1.05"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...fractionInput,
        detectionLimit: "1.01"
      })
    ).toThrow(ProductValidationError);
  });

  it("enforces percent 0..100 bounds strictly on limits and uncertainty", () => {
    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        uncertaintyAbsolute: "100.1"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        detectionLimit: "100.5"
      })
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaMeasurement({
        ...baseInput,
        quantificationLimit: "101.0"
      })
    ).toThrow(ProductValidationError);
  });

  it("rehydrates correctly and freezes object", () => {
    const m = createCoaMeasurement(baseInput);
    const rehydrated = rehydrateCoaMeasurement(m);
    expect(rehydrated).toEqual(m);
    expect(Object.isFrozen(rehydrated)).toBe(true);
  });
});
