import {
  compareDecimalStrings,
  isContradictoryUnitTuple,
  isNormalizedFractionInRange,
  isPercentInRange,
  isValidAnalyteCode,
  isValidAnalyticalContextString,
  isValidDecimalString,
  normalizeDecimalString,
  type CoaResultKind,
  type CoaResultQualifier,
  type DecimalString
} from "@cco/shared";
import {
  createBatchId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  type BatchId,
  type ClientId,
  type CoaMeasurementId,
  type CoaReportId,
  type EvidenceId
} from "./identifiers.js";
import { ProductValidationError } from "./product-evidence-errors.js";

export interface CoaMeasurement {
  readonly measurementId: CoaMeasurementId;
  readonly clientId: ClientId;
  readonly reportId: CoaReportId;
  readonly reportRevision: number;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly analyte: string;
  readonly resultKind: CoaResultKind;
  readonly resultValue: DecimalString | null;
  readonly resultLimit: DecimalString | null;
  readonly resultQualifier: CoaResultQualifier | null;
  readonly unit: string;
  readonly basis: string;
  readonly context: string;
  readonly quantityKind: string;
  readonly methodAsReported: string | null;
  readonly uncertaintyAbsolute: DecimalString | null;
  readonly detectionLimit: DecimalString | null;
  readonly quantificationLimit: DecimalString | null;
  readonly analyticalQualifierCode: string | null;
  readonly analyticalQualifierExplanation: string | null;
}

export interface CreateCoaMeasurementInput {
  readonly measurementId?: CoaMeasurementId | string | undefined;
  readonly clientId: ClientId | string;
  readonly reportId: CoaReportId | string;
  readonly reportRevision: number;
  readonly batchId: BatchId | string;
  readonly evidenceId: EvidenceId | string;
  readonly evidenceRevision: number;
  readonly analyte: string;
  readonly resultKind: CoaResultKind;
  readonly resultValue?: string | null | undefined;
  readonly resultLimit?: string | null | undefined;
  readonly resultQualifier?: CoaResultQualifier | null | undefined;
  readonly unit: string;
  readonly basis: string;
  readonly context: string;
  readonly quantityKind: string;
  readonly methodAsReported?: string | null | undefined;
  readonly uncertaintyAbsolute?: string | null | undefined;
  readonly detectionLimit?: string | null | undefined;
  readonly quantificationLimit?: string | null | undefined;
  readonly analyticalQualifierCode?: string | null | undefined;
  readonly analyticalQualifierExplanation?: string | null | undefined;
}

export function createCoaMeasurement(input: CreateCoaMeasurementInput): CoaMeasurement {
  const clientId = createClientId(String(input.clientId));
  const reportId = createCoaReportId(String(input.reportId));
  const batchId = createBatchId(String(input.batchId));
  const evidenceId = createEvidenceId(String(input.evidenceId));
  const measurementId = input.measurementId
    ? createCoaMeasurementId(String(input.measurementId))
    : createCoaMeasurementId(crypto.randomUUID());

  if (!Number.isInteger(input.reportRevision) || input.reportRevision < 1) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["reportRevision"],
        message: "reportRevision must be a positive integer >= 1."
      }
    ]);
  }

  if (!Number.isInteger(input.evidenceRevision) || input.evidenceRevision < 1) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["evidenceRevision"],
        message: "evidenceRevision must be a positive integer >= 1."
      }
    ]);
  }

  if (!isValidAnalyteCode(input.analyte)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["analyte"],
        message: "analyte must be 1–128 characters without control characters."
      }
    ]);
  }
  const analyte = input.analyte.trim();

  if (!isValidAnalyticalContextString(input.unit)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["unit"],
        message: "unit must be 1–64 characters without control characters."
      }
    ]);
  }
  const unit = input.unit.trim();

  if (!isValidAnalyticalContextString(input.basis)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["basis"],
        message: "basis must be 1–64 characters without control characters."
      }
    ]);
  }
  const basis = input.basis.trim();

  if (!isValidAnalyticalContextString(input.context)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["context"],
        message: "context must be 1–64 characters without control characters."
      }
    ]);
  }
  const context = input.context.trim();

  if (!isValidAnalyticalContextString(input.quantityKind)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["quantityKind"],
        message: "quantityKind must be 1–64 characters without control characters."
      }
    ]);
  }
  const quantityKind = input.quantityKind.trim();

  if (isContradictoryUnitTuple(unit, quantityKind)) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["unit", "quantityKind"],
        message: `Unit "${unit}" is contradictory with quantityKind "${quantityKind}".`
      }
    ]);
  }

  let methodAsReported: string | null = null;
  if (input.methodAsReported !== null && input.methodAsReported !== undefined) {
    const trimmed = input.methodAsReported.trim();
    if (trimmed.length === 0 || trimmed.length > 128 || !isValidAnalyticalContextString(trimmed)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["methodAsReported"],
          message: "methodAsReported must be 1–128 characters without control characters."
        }
      ]);
    }
    methodAsReported = trimmed;
  }

  // Analytical qualifiers
  let analyticalQualifierCode: string | null = null;
  let analyticalQualifierExplanation: string | null = null;
  if (input.analyticalQualifierCode !== null && input.analyticalQualifierCode !== undefined) {
    const code = input.analyticalQualifierCode.trim();
    if (code.length === 0 || code.length > 64) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["analyticalQualifierCode"],
          message: "analyticalQualifierCode cannot be empty or > 64 chars."
        }
      ]);
    }
    analyticalQualifierCode = code;
  }
  if (
    input.analyticalQualifierExplanation !== null &&
    input.analyticalQualifierExplanation !== undefined
  ) {
    const expl = input.analyticalQualifierExplanation.trim();
    if (expl.length === 0 || expl.length > 512) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["analyticalQualifierExplanation"],
          message: "analyticalQualifierExplanation cannot be empty or > 512 chars."
        }
      ]);
    }
    analyticalQualifierExplanation = expl;
  }

  if (analyticalQualifierCode !== null && analyticalQualifierExplanation === null) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["analyticalQualifierExplanation"],
        message:
          "analyticalQualifierExplanation is required when analyticalQualifierCode is supplied."
      }
    ]);
  }
  if (analyticalQualifierCode === null && analyticalQualifierExplanation !== null) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["analyticalQualifierCode"],
        message:
          "analyticalQualifierCode is required when analyticalQualifierExplanation is supplied."
      }
    ]);
  }

  // Result kind branching
  let resultValue: DecimalString | null = null;
  let resultLimit: DecimalString | null = null;
  let resultQualifier: CoaResultQualifier | null = null;

  const isPercentUnit =
    unit.toLowerCase() === "percent_w_w" || unit.toLowerCase() === "percent_v_v";
  const isFractionUnit =
    unit.toLowerCase() === "fraction" ||
    unit.toLowerCase() === "fraction_w_w" ||
    unit.toLowerCase() === "fraction_v_v" ||
    (quantityKind.toLowerCase() === "mass_fraction" && unit.toLowerCase() === "fraction_w_w");

  if (input.resultKind === "quantified") {
    if (input.resultValue === null || input.resultValue === undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultValue"],
          message: "resultValue is required when resultKind is 'quantified'."
        }
      ]);
    }
    if (!isValidDecimalString(input.resultValue)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["resultValue"],
          message: `resultValue "${input.resultValue}" must be a valid decimal string.`
        }
      ]);
    }
    resultValue = normalizeDecimalString(input.resultValue, "resultValue");

    if (input.resultLimit !== null && input.resultLimit !== undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultLimit"],
          message: "resultLimit must be null when resultKind is 'quantified'."
        }
      ]);
    }
    if (input.resultQualifier !== null && input.resultQualifier !== undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultQualifier"],
          message: "resultQualifier must be null when resultKind is 'quantified'."
        }
      ]);
    }

    // Negative quantified value check
    if (compareDecimalStrings(resultValue, "0") < 0) {
      if (analyticalQualifierCode !== "negative_as_reported") {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["analyticalQualifierCode"],
            message:
              "Negative quantified values require analyticalQualifierCode 'negative_as_reported' and explanation."
          }
        ]);
      }
    }

    // Bounds checking
    if (isPercentUnit) {
      if (!isPercentInRange(resultValue)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["resultValue"],
            message: `resultValue "${resultValue}" out of percent bounds (0..100).`
          }
        ]);
      }
    } else if (isFractionUnit) {
      if (!isNormalizedFractionInRange(resultValue)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["resultValue"],
            message: `resultValue "${resultValue}" out of normalized fraction bounds (0..1).`
          }
        ]);
      }
    }
  } else if (input.resultKind === "below_limit") {
    if (input.resultValue !== null && input.resultValue !== undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultValue"],
          message: "resultValue must be null when resultKind is 'below_limit'."
        }
      ]);
    }
    if (input.resultLimit === null || input.resultLimit === undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultLimit"],
          message: "resultLimit is required when resultKind is 'below_limit'."
        }
      ]);
    }
    if (!isValidDecimalString(input.resultLimit)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["resultLimit"],
          message: `resultLimit "${input.resultLimit}" must be a valid decimal string.`
        }
      ]);
    }
    resultLimit = normalizeDecimalString(input.resultLimit, "resultLimit");
    if (compareDecimalStrings(resultLimit, "0") <= 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultLimit"],
          message: `resultLimit "${resultLimit}" must be strictly positive (> 0).`
        }
      ]);
    }

    if (input.resultQualifier !== "lt" && input.resultQualifier !== "lte") {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultQualifier"],
          message: "resultQualifier must be 'lt' or 'lte' when resultKind is 'below_limit'."
        }
      ]);
    }
    resultQualifier = input.resultQualifier;

    // Bounds checking
    if (isPercentUnit) {
      if (!isPercentInRange(resultLimit)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["resultLimit"],
            message: `resultLimit "${resultLimit}" out of percent bounds (0..100).`
          }
        ]);
      }
    } else if (isFractionUnit) {
      if (!isNormalizedFractionInRange(resultLimit)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["resultLimit"],
            message: `resultLimit "${resultLimit}" out of normalized fraction bounds (0..1).`
          }
        ]);
      }
    }
  } else if (input.resultKind === "not_detected") {
    if (input.resultValue !== null && input.resultValue !== undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultValue"],
          message: "resultValue must be null when resultKind is 'not_detected'."
        }
      ]);
    }
    if (input.resultLimit !== null && input.resultLimit !== undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultLimit"],
          message: "resultLimit must be null when resultKind is 'not_detected'."
        }
      ]);
    }
    if (input.resultQualifier !== null && input.resultQualifier !== undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["resultQualifier"],
          message: "resultQualifier must be null when resultKind is 'not_detected'."
        }
      ]);
    }
  } else {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["resultKind"],
        message: `Unknown resultKind: "${String(input.resultKind)}"`
      }
    ]);
  }

  // Decimal metadata: uncertainty, LOD, LOQ
  let uncertaintyAbsolute: DecimalString | null = null;
  if (input.uncertaintyAbsolute !== null && input.uncertaintyAbsolute !== undefined) {
    if (!isValidDecimalString(input.uncertaintyAbsolute)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["uncertaintyAbsolute"],
          message: "uncertaintyAbsolute must be a valid decimal string."
        }
      ]);
    }
    uncertaintyAbsolute = normalizeDecimalString(input.uncertaintyAbsolute, "uncertaintyAbsolute");
    if (compareDecimalStrings(uncertaintyAbsolute, "0") < 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["uncertaintyAbsolute"],
          message: "uncertaintyAbsolute cannot be negative."
        }
      ]);
    }
    if (isPercentUnit && !isPercentInRange(uncertaintyAbsolute)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["uncertaintyAbsolute"],
          message: `uncertaintyAbsolute "${uncertaintyAbsolute}" out of percent bounds (0..100).`
        }
      ]);
    } else if (isFractionUnit && !isNormalizedFractionInRange(uncertaintyAbsolute)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["uncertaintyAbsolute"],
          message: `uncertaintyAbsolute "${uncertaintyAbsolute}" out of normalized fraction bounds (0..1).`
        }
      ]);
    }
  }

  let detectionLimit: DecimalString | null = null;
  if (input.detectionLimit !== null && input.detectionLimit !== undefined) {
    if (!isValidDecimalString(input.detectionLimit)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["detectionLimit"],
          message: "detectionLimit must be a valid decimal string."
        }
      ]);
    }
    detectionLimit = normalizeDecimalString(input.detectionLimit, "detectionLimit");
    if (compareDecimalStrings(detectionLimit, "0") < 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["detectionLimit"],
          message: "detectionLimit cannot be negative."
        }
      ]);
    }
    if (isPercentUnit && !isPercentInRange(detectionLimit)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["detectionLimit"],
          message: `detectionLimit "${detectionLimit}" out of percent bounds (0..100).`
        }
      ]);
    } else if (isFractionUnit && !isNormalizedFractionInRange(detectionLimit)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["detectionLimit"],
          message: `detectionLimit "${detectionLimit}" out of normalized fraction bounds (0..1).`
        }
      ]);
    }
  }

  let quantificationLimit: DecimalString | null = null;
  if (input.quantificationLimit !== null && input.quantificationLimit !== undefined) {
    if (!isValidDecimalString(input.quantificationLimit)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["quantificationLimit"],
          message: "quantificationLimit must be a valid decimal string."
        }
      ]);
    }
    quantificationLimit = normalizeDecimalString(input.quantificationLimit, "quantificationLimit");
    if (compareDecimalStrings(quantificationLimit, "0") < 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["quantificationLimit"],
          message: "quantificationLimit cannot be negative."
        }
      ]);
    }
    if (isPercentUnit && !isPercentInRange(quantificationLimit)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["quantificationLimit"],
          message: `quantificationLimit "${quantificationLimit}" out of percent bounds (0..100).`
        }
      ]);
    } else if (isFractionUnit && !isNormalizedFractionInRange(quantificationLimit)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["quantificationLimit"],
          message: `quantificationLimit "${quantificationLimit}" out of normalized fraction bounds (0..1).`
        }
      ]);
    }
  }

  if (detectionLimit !== null && quantificationLimit !== null) {
    if (compareDecimalStrings(detectionLimit, quantificationLimit) > 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["detectionLimit", "quantificationLimit"],
          message: `detectionLimit (${detectionLimit}) cannot exceed quantificationLimit (${quantificationLimit}).`
        }
      ]);
    }
  }

  return Object.freeze({
    measurementId,
    clientId,
    reportId,
    reportRevision: input.reportRevision,
    batchId,
    evidenceId,
    evidenceRevision: input.evidenceRevision,
    analyte,
    resultKind: input.resultKind,
    resultValue,
    resultLimit,
    resultQualifier,
    unit,
    basis,
    context,
    quantityKind,
    methodAsReported,
    uncertaintyAbsolute,
    detectionLimit,
    quantificationLimit,
    analyticalQualifierCode,
    analyticalQualifierExplanation
  });
}

export function rehydrateCoaMeasurement(raw: CoaMeasurement): CoaMeasurement {
  return Object.freeze({
    measurementId: createCoaMeasurementId(raw.measurementId),
    clientId: createClientId(raw.clientId),
    reportId: createCoaReportId(raw.reportId),
    reportRevision: Number(raw.reportRevision),
    batchId: createBatchId(raw.batchId),
    evidenceId: createEvidenceId(raw.evidenceId),
    evidenceRevision: Number(raw.evidenceRevision),
    analyte: String(raw.analyte).trim(),
    resultKind: raw.resultKind,
    resultValue: raw.resultValue ? normalizeDecimalString(raw.resultValue) : null,
    resultLimit: raw.resultLimit ? normalizeDecimalString(raw.resultLimit) : null,
    resultQualifier: raw.resultQualifier ?? null,
    unit: String(raw.unit).trim(),
    basis: String(raw.basis).trim(),
    context: String(raw.context).trim(),
    quantityKind: String(raw.quantityKind).trim(),
    methodAsReported: raw.methodAsReported ? String(raw.methodAsReported).trim() : null,
    uncertaintyAbsolute: raw.uncertaintyAbsolute
      ? normalizeDecimalString(raw.uncertaintyAbsolute)
      : null,
    detectionLimit: raw.detectionLimit ? normalizeDecimalString(raw.detectionLimit) : null,
    quantificationLimit: raw.quantificationLimit
      ? normalizeDecimalString(raw.quantificationLimit)
      : null,
    analyticalQualifierCode: raw.analyticalQualifierCode
      ? String(raw.analyticalQualifierCode).trim()
      : null,
    analyticalQualifierExplanation: raw.analyticalQualifierExplanation
      ? String(raw.analyticalQualifierExplanation).trim()
      : null
  });
}
