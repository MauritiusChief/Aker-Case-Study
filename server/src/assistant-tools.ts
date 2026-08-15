import type { AppDatabase } from "./db/index.js";
import type { AvailabilityOptions } from "./analysis/availability.js";
import { queryAvailabilitySummaries } from "./analysis/availability.js";
import { computePropertySummary } from "./analysis/property-summary.js";
import { computePortfolioSummary } from "./analysis/portfolio.js";
import { computeLeaseRiskSummary, LEASE_BUCKETS } from "./analysis/lease-risk.js";
import { computeRentGapSummary } from "./analysis/rent-gap.js";
import { runDataQualityChecks } from "./analysis/quality.js";
import { summarizeDataQuality } from "./brief-facts.js";
import type {
  AssistantToolName,
  BriefFacts,
  ModelTool,
} from "./assistant-types.js";

export const ASSISTANT_TOOL_NAMES: readonly AssistantToolName[] = [
  "get_property_summary",
  "get_portfolio_comparison",
  "get_availability",
  "get_lease_risk",
  "get_rent_gap",
  "get_data_quality",
];

export function isAssistantToolName(name: string): name is AssistantToolName {
  return (ASSISTANT_TOOL_NAMES as readonly string[]).includes(name);
}

export type ToolExecutor = (
  name: AssistantToolName,
  argumentsJson: string
) => unknown;
export type ToolScope = "candidate" | "portfolio";

function propertySchema(candidateCodes: string[]): Record<string, unknown> {
  return { type: "string", enum: candidateCodes };
}

function allowedPropertyCodes(facts: BriefFacts, scope: ToolScope): string[] {
  return scope === "candidate"
    ? facts.scope.candidate_property_codes
    : facts.scope.portfolio_property_codes;
}

export function buildAssistantTools(
  facts: BriefFacts,
  scope: ToolScope = "candidate"
): ModelTool[] {
  const codes = allowedPropertyCodes(facts, scope);
  const tool = (
    name: AssistantToolName,
    description: string,
    properties: Record<string, unknown>,
    required: string[] = []
  ): ModelTool => ({
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  });
  return [
    tool(
      "get_property_summary",
      "Read deterministic summary metrics for one candidate property.",
      { property_code: propertySchema(codes) },
      ["property_code"]
    ),
    tool(
      "get_portfolio_comparison",
      "Compare candidate properties with deterministic portfolio metrics.",
      {
        property_codes: {
          type: "array",
          items: propertySchema(codes),
          maxItems: codes.length,
          uniqueItems: true,
        },
      }
    ),
    tool(
      "get_availability",
      "Read availability categories for the portfolio or one candidate property.",
      { property_code: propertySchema(codes) }
    ),
    tool(
      "get_lease_risk",
      "Read aggregate lease-expiration and loss-to-lease risk without resident records.",
      {
        property_code: propertySchema(codes),
        lease_bucket: { type: "string", enum: LEASE_BUCKETS },
      }
    ),
    tool(
      "get_rent_gap",
      "Read aggregate market-rent versus scheduled-base-rent calculations.",
      { property_code: propertySchema(codes) }
    ),
    tool(
      "get_data_quality",
      "Read aggregated data-quality counts with no resident identifiers.",
      { property_code: propertySchema(codes) }
    ),
  ];
}

function parseObject(argumentsJson: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new Error("Tool arguments must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function assertKeys(args: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(args).some((key) => !allowed.includes(key))) {
    throw new Error("Tool call contains unsupported arguments");
  }
}

function candidateProperty(
  args: Record<string, unknown>,
  allowedCodes: string[],
  required = false
): string | undefined {
  const value = args.property_code;
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== "string" ||
    !allowedCodes.includes(value)
  ) {
    throw new Error("property_code is outside the allowed scope");
  }
  return value;
}

function filterPropertyCodes(value: unknown, allowedCodes: string[]): string[] {
  if (value === undefined) return allowedCodes;
  if (
    !Array.isArray(value) ||
    value.some(
      (code) =>
        typeof code !== "string" || !allowedCodes.includes(code)
    )
  ) {
    throw new Error("property_codes contains a property outside the allowed scope");
  }
  return [...new Set(value as string[])];
}

export function createToolExecutor(
  db: AppDatabase,
  options: AvailabilityOptions & { monthYear: string },
  facts: BriefFacts,
  scope: ToolScope = "candidate"
): ToolExecutor {
  const allowedCodes = allowedPropertyCodes(facts, scope);
  return (name, argumentsJson) => {
    if (!isAssistantToolName(name)) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const args = parseObject(argumentsJson);

    if (name === "get_property_summary") {
      assertKeys(args, ["property_code"]);
      const propertyCode = candidateProperty(args, allowedCodes, true) as string;
      const summary = computePropertySummary(db, options, propertyCode);
      if (!summary) throw new Error("Candidate property no longer exists");
      return {
        as_of_date: summary.as_of_date,
        month_year: summary.month_year,
        property: summary.property,
        metrics: summary.metrics,
        availability: summary.availability,
        lease_expiration_buckets: summary.lease_expiration_buckets,
        charge_codes: summary.charge_codes,
        definitions: summary.definitions,
        coverage: summary.coverage,
        data_quality: summarizeDataQuality(summary.data_quality),
      };
    }

    if (name === "get_portfolio_comparison") {
      assertKeys(args, ["property_codes"]);
      const propertyCodes = filterPropertyCodes(args.property_codes, allowedCodes);
      const portfolio = computePortfolioSummary(db, options);
      const rentGap = computeRentGapSummary(db, options);
      const rentByProperty = new Map(rentGap.by_property.map((row) => [row.key, row]));
      return {
        as_of_date: facts.as_of_date,
        month_year: facts.month_year,
        portfolio: facts.portfolio,
        properties: portfolio.metrics.property_priority
          .filter((row) => propertyCodes.includes(row.property_code))
          .map((row) => ({
            ...row,
            total_loss_to_lease:
              rentByProperty.get(row.property_code)?.total_loss_to_lease ?? null,
            comparable_units:
              rentByProperty.get(row.property_code)?.comparable_units ?? 0,
          })),
        portfolio_distribution: portfolio.metrics.property_priority.map((row) => ({
          ...row,
          total_loss_to_lease:
            rentByProperty.get(row.property_code)?.total_loss_to_lease ?? null,
          comparable_units:
            rentByProperty.get(row.property_code)?.comparable_units ?? 0,
        })),
        coverage: facts.coverage,
      };
    }

    if (name === "get_availability") {
      assertKeys(args, ["property_code"]);
      const propertyCode = candidateProperty(args, allowedCodes);
      const rows = queryAvailabilitySummaries(db, options).filter(
        (row) =>
          propertyCode === undefined
            ? allowedCodes.includes(row.property_code)
            : row.property_code === propertyCode
      );
      return {
        as_of_date: facts.as_of_date,
        filters: propertyCode ? { property_code: propertyCode } : {},
        portfolio: {
          total_units: facts.portfolio.total_units,
          available_units: facts.portfolio.available_units,
          physical_occupancy_pct: facts.portfolio.physical_occupancy_pct,
          leased_pct: facts.portfolio.leased_pct,
        },
        properties: rows,
      };
    }

    if (name === "get_lease_risk") {
      assertKeys(args, ["property_code", "lease_bucket"]);
      const propertyCode = candidateProperty(args, allowedCodes);
      const leaseBucket = args.lease_bucket;
      if (
        leaseBucket !== undefined &&
        (typeof leaseBucket !== "string" || !(LEASE_BUCKETS as readonly string[]).includes(leaseBucket))
      ) {
        throw new Error("lease_bucket is invalid");
      }
      const summary = computeLeaseRiskSummary(
        db,
        options,
        {
          property: propertyCode,
          bucket: leaseBucket as Parameters<typeof computeLeaseRiskSummary>[2]["bucket"],
        },
        1
      );
      return {
        as_of_date: summary.as_of_date,
        month_year: summary.month_year,
        filters: summary.filters,
        metrics: summary.metrics,
        definitions: summary.definitions,
        coverage: summary.coverage,
        data_quality: summarizeDataQuality(
          propertyCode
            ? summary.data_quality.filter((issue) => issue.property_code === propertyCode)
            : summary.data_quality
        ),
      };
    }

    if (name === "get_rent_gap") {
      assertKeys(args, ["property_code"]);
      const propertyCode = candidateProperty(args, allowedCodes);
      const summary = computeRentGapSummary(db, options);
      const property = propertyCode
        ? summary.by_property.find((row) => row.key === propertyCode) ?? null
        : undefined;
      return {
        as_of_date: summary.as_of_date,
        month_year: summary.month_year,
        filters: propertyCode ? { property_code: propertyCode } : {},
        scope: propertyCode ? "property" : "portfolio",
        ...(propertyCode ? { property } : { metrics: summary.metrics }),
        portfolio_metrics: summary.metrics,
        by_property: propertyCode
          ? []
          : summary.by_property.filter((row) =>
              allowedCodes.includes(row.key)
            ),
        by_unit_type: propertyCode ? [] : summary.by_unit_type,
        definitions: summary.definitions,
        coverage: summary.coverage,
      };
    }

    assertKeys(args, ["property_code"]);
    const propertyCode = candidateProperty(args, allowedCodes);
    const issues = runDataQualityChecks(db, options).filter(
      (issue) => propertyCode === undefined || issue.property_code === propertyCode
    );
    return {
      as_of_date: facts.as_of_date,
      filters: propertyCode ? { property_code: propertyCode } : {},
      summary: summarizeDataQuality(issues),
    };
  };
}
