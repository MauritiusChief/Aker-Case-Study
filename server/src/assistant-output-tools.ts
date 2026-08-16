import {
  type BriefFacts,
  type ModelTool,
  type SubmissionToolName,
} from "./assistant-types.js";

function citationSchema(sourceIds: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      source_id: { type: "string", enum: sourceIds },
      path: { type: "string", maxLength: 300 },
    },
    required: ["source_id", "path"],
    additionalProperties: false,
  };
}

function tool(
  name: SubmissionToolName,
  description: string,
  parameters: Record<string, unknown>
): ModelTool {
  return { type: "function", function: { name, description, parameters } };
}

export function buildMorningBriefSubmissionTool(
  facts: BriefFacts,
  sourceIds: string[]
): ModelTool {
  return tool(
    "submit_morning_brief",
    "Terminally submit the grounded Morning Brief text. Do not include widgets; manage widgets with widget tools.",
    {
      type: "object",
      properties: {
        findings: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              id: { type: "string", maxLength: 80 },
              title: { type: "string", maxLength: 160 },
              summary: { type: "string", maxLength: 800 },
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              property_codes: {
                type: "array",
                items: { type: "string", enum: facts.scope.candidate_property_codes },
                maxItems: facts.scope.candidate_property_codes.length,
                uniqueItems: true,
              },
              evidence: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                items: citationSchema(sourceIds),
              },
              recommended_action: { type: "string", maxLength: 400 },
            },
            required: ["id", "title", "summary", "priority", "property_codes", "evidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["findings"],
      additionalProperties: false,
    }
  );
}

export function buildAssistantAnswerSubmissionTool(sourceIds: string[]): ModelTool {
  return tool(
    "submit_assistant_answer",
    "Terminally submit the grounded answer text. Do not include widgets; manage widgets with widget tools.",
    {
      type: "object",
      properties: {
        answer: { type: "string", maxLength: 4_000 },
        citations: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: citationSchema(sourceIds),
        },
      },
      required: ["answer", "citations"],
      additionalProperties: false,
    }
  );
}
