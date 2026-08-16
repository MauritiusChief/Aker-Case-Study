import type { AppDatabase } from "./db/index.js";
import type { AvailabilityOptions } from "./analysis/availability.js";
import { queryAvailabilitySummaries } from "./analysis/availability.js";
import { computePropertySummary, type PropertyMetrics } from "./analysis/property-summary.js";
import { computePortfolioSummary } from "./analysis/portfolio.js";
import {
  computeLeaseRiskSummary,
  LEASE_BUCKETS,
  type LeaseRiskMetrics,
} from "./analysis/lease-risk.js";
import {
  computeRentGapSummary,
  type RentGapGroup,
  type RentGapMetrics,
} from "./analysis/rent-gap.js";
import { runDataQualityChecks } from "./analysis/quality.js";
import { splitNetLeaseGap, summarizeDataQuality } from "./brief-facts.js";
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

function splitAverageLeaseGap(value: number | null): {
  average_loss_to_lease: number | null;
  average_gain_to_lease: number | null;
} {
  if (value === null) {
    return { average_loss_to_lease: null, average_gain_to_lease: null };
  }
  return {
    average_loss_to_lease: value > 0 ? value : 0,
    average_gain_to_lease: value < 0 ? Math.abs(value) : 0,
  };
}

function modelLeaseGapDefinitions(definitions: Record<string, string>): Record<string, string> {
  const hidden = new Set([
    "loss_to_lease",
    "loss_to_lease_pct",
    "positive_loss_to_lease",
    "premium",
  ]);
  return {
    ...Object.fromEntries(Object.entries(definitions).filter(([key]) => !hidden.has(key))),
    net_loss_to_lease:
      "Positive magnitude of the net amount by which Market Rent exceeds Scheduled Base Rent; zero when the net direction is gain.",
    net_gain_to_lease:
      "Positive magnitude of the net amount by which Scheduled Base Rent exceeds Market Rent; zero when the net direction is loss.",
    average_loss_to_lease:
      "Positive average Loss-to-Lease magnitude; mutually exclusive with average_gain_to_lease.",
    average_gain_to_lease:
      "Positive average Gain-to-Lease magnitude; mutually exclusive with average_loss_to_lease.",
    loss_to_lease_unit_count: "Comparable units whose Market Rent exceeds Scheduled Base Rent.",
    gain_to_lease_unit_count: "Comparable units whose Scheduled Base Rent exceeds Market Rent.",
  };
}

function modelPropertyMetrics(metrics: PropertyMetrics) {
  const {
    total_loss_to_lease,
    avg_loss_to_lease,
    positive_loss_to_lease_count,
    premium_count,
    ...rest
  } = metrics;
  return {
    ...rest,
    ...splitNetLeaseGap(total_loss_to_lease),
    ...splitAverageLeaseGap(avg_loss_to_lease),
    loss_to_lease_unit_count: positive_loss_to_lease_count,
    gain_to_lease_unit_count: premium_count,
  };
}

function modelLeaseRiskMetrics(metrics: LeaseRiskMetrics) {
  const {
    total_loss_to_lease,
    positive_loss_to_lease_count,
    premium_count,
    ...rest
  } = metrics;
  return {
    ...rest,
    ...splitNetLeaseGap(total_loss_to_lease),
    loss_to_lease_unit_count: positive_loss_to_lease_count,
    gain_to_lease_unit_count: premium_count,
  };
}

function modelRentGapMetrics(metrics: RentGapMetrics) {
  const {
    total_loss_to_lease,
    avg_loss_to_lease,
    positive_loss_to_lease_count,
    positive_loss_to_lease_amount: _positiveLossToLeaseAmount,
    premium_count,
    ...rest
  } = metrics;
  return {
    ...rest,
    ...splitNetLeaseGap(total_loss_to_lease),
    ...splitAverageLeaseGap(avg_loss_to_lease),
    loss_to_lease_unit_count: positive_loss_to_lease_count,
    gain_to_lease_unit_count: premium_count,
  };
}

function modelRentGapGroup(group: RentGapGroup) {
  const {
    total_loss_to_lease,
    avg_loss_to_lease,
    positive_count,
    premium_count,
    ...rest
  } = group;
  return {
    ...rest,
    ...splitNetLeaseGap(total_loss_to_lease),
    ...splitAverageLeaseGap(avg_loss_to_lease),
    loss_to_lease_unit_count: positive_count,
    gain_to_lease_unit_count: premium_count,
  };
}

function modelRentGapComparison(group: RentGapGroup | undefined) {
  return {
    comparable_units: group?.comparable_units ?? 0,
    ...splitNetLeaseGap(group?.total_loss_to_lease ?? null),
    ...splitAverageLeaseGap(group?.avg_loss_to_lease ?? null),
    loss_to_lease_unit_count: group?.positive_count ?? 0,
    gain_to_lease_unit_count: group?.premium_count ?? 0,
  };
}

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
      "Read aggregate lease-expiration and Loss-to-Lease or Gain-to-Lease risk without resident records.",
      {
        property_code: propertySchema(codes),
        lease_bucket: { type: "string", enum: LEASE_BUCKETS },
      }
    ),
    tool(
      "get_rent_gap",
      "Read aggregate market-rent versus scheduled-base-rent Loss-to-Lease and Gain-to-Lease calculations.",
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
        metrics: modelPropertyMetrics(summary.metrics),
        availability: summary.availability,
        lease_expiration_buckets: summary.lease_expiration_buckets,
        charge_codes: summary.charge_codes,
        definitions: modelLeaseGapDefinitions(summary.definitions),
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
            ...modelRentGapComparison(rentByProperty.get(row.property_code)),
          })),
        portfolio_distribution: portfolio.metrics.property_priority.map((row) => ({
          ...row,
          ...modelRentGapComparison(rentByProperty.get(row.property_code)),
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
        metrics: modelLeaseRiskMetrics(summary.metrics),
        definitions: modelLeaseGapDefinitions(summary.definitions),
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
        ...(propertyCode
          ? { property: property ? modelRentGapGroup(property) : null }
          : { metrics: modelRentGapMetrics(summary.metrics) }),
        portfolio_metrics: modelRentGapMetrics(summary.metrics),
        by_property: propertyCode
          ? []
          : summary.by_property.filter((row) =>
              allowedCodes.includes(row.key)
            ).map(modelRentGapGroup),
        by_unit_type: propertyCode ? [] : summary.by_unit_type.map(modelRentGapGroup),
        definitions: modelLeaseGapDefinitions(summary.definitions),
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
