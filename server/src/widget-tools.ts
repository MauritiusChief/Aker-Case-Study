import {
  WIDGET_TYPES,
  type ModelTool,
  type SemanticWidget,
  type WidgetOperation,
  type WidgetToolName,
  type WidgetType,
} from "./assistant-types.js";

const MAX_WIDGETS = 6;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${label} contains unsupported fields`);
  }
}

function string(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function parseArguments(argumentsJson: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new Error("Widget tool arguments must be valid JSON");
  }
  return object(value, "Widget tool arguments");
}

function propertyCodes(value: unknown, allowedCodes: string[], label: string): string[] {
  if (!Array.isArray(value) || value.length > allowedCodes.length) {
    throw new Error(`${label} must be an array within the property scope`);
  }
  const codes = value.map((item, index) => string(item, `${label}[${index}]`, 100));
  if (codes.some((code) => !allowedCodes.includes(code))) {
    throw new Error(`${label} contains a property outside the allowed scope`);
  }
  return [...new Set(codes)];
}

function scope(
  value: unknown,
  allowedCodes: string[],
  label: string
): SemanticWidget["scope"] {
  const row = object(value, label);
  assertKeys(row, ["level", "property_codes"], label);
  const level = string(row.level, `${label}.level`, 20);
  if (!("portfolio property comparison".split(" ")).includes(level)) {
    throw new Error(`${label}.level is unsupported`);
  }
  const codes = propertyCodes(row.property_codes, allowedCodes, `${label}.property_codes`);
  if (level === "property" && codes.length !== 1) {
    throw new Error(`${label} requires exactly one property for property level`);
  }
  return {
    level: level as SemanticWidget["scope"]["level"],
    property_codes: codes,
  };
}

function widgetIntent(
  value: unknown,
  allowedCodes: string[],
  label: string
): SemanticWidget {
  const row = object(value, label);
  assertKeys(row, ["id", "type", "title", "scope"], label);
  const type = string(row.type, `${label}.type`, 50) as WidgetType;
  if (!(WIDGET_TYPES as readonly string[]).includes(type)) {
    throw new Error(`${label}.type is unsupported`);
  }
  return {
    id: string(row.id, `${label}.id`, 80),
    type,
    title: string(row.title, `${label}.title`, 160),
    scope: scope(row.scope, allowedCodes, `${label}.scope`),
    source_ids: ["brief_facts"],
  };
}

function widgetSchema(propertyCodeEnum: string[], includeId: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    type: { type: "string", enum: WIDGET_TYPES },
    title: { type: "string", maxLength: 160 },
    scope: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["portfolio", "property", "comparison"] },
        property_codes: {
          type: "array",
          items: { type: "string", enum: propertyCodeEnum },
          maxItems: propertyCodeEnum.length,
          uniqueItems: true,
        },
      },
      required: ["level", "property_codes"],
      additionalProperties: false,
    },
  };
  if (includeId) properties.id = { type: "string", maxLength: 80 };
  return {
    type: "object",
    properties,
    required: includeId ? ["id", "type", "title", "scope"] : [],
    additionalProperties: false,
  };
}

function tool(
  name: WidgetToolName,
  description: string,
  parameters: Record<string, unknown>
): ModelTool {
  return { type: "function", function: { name, description, parameters } };
}

export function buildWidgetTools(propertyCodeEnum: string[]): ModelTool[] {
  return [
    tool(
      "create_widget",
      "Create one semantic widget in the transactional draft. Widget values are materialized deterministically by the application.",
      {
        type: "object",
        properties: { widget: widgetSchema(propertyCodeEnum, true) },
        required: ["widget"],
        additionalProperties: false,
      }
    ),
    tool(
      "get_widgets",
      "Read the current non-citable widget draft. Omit widget_id to list all widgets.",
      {
        type: "object",
        properties: { widget_id: { type: "string", maxLength: 80 } },
        additionalProperties: false,
      }
    ),
    tool(
      "update_widget",
      "Update an existing editable widget. The widget id cannot be changed.",
      {
        type: "object",
        properties: {
          widget_id: { type: "string", maxLength: 80 },
          changes: widgetSchema(propertyCodeEnum, false),
        },
        required: ["widget_id", "changes"],
        additionalProperties: false,
      }
    ),
    tool(
      "delete_widget",
      "Delete one editable widget from the transactional draft.",
      {
        type: "object",
        properties: { widget_id: { type: "string", maxLength: 80 } },
        required: ["widget_id"],
        additionalProperties: false,
      }
    ),
  ];
}

export function isWidgetToolName(name: string): name is WidgetToolName {
  return ["create_widget", "get_widgets", "update_widget", "delete_widget"].includes(name);
}

export class WidgetDraftStore {
  private readonly widgets: Map<string, SemanticWidget>;
  private readonly operations: WidgetOperation[];

  constructor(
    initial: SemanticWidget[],
    private readonly allowedCodes: string[],
    private readonly protectedIds: Set<string> = new Set(),
    operations: WidgetOperation[] = []
  ) {
    if (initial.length > MAX_WIDGETS) throw new Error(`Widget draft cannot exceed ${MAX_WIDGETS} items`);
    this.widgets = new Map(
      initial.map((widget) => {
        const validated = widgetIntent(
          {
            id: widget.id,
            type: widget.type,
            title: widget.title,
            scope: widget.scope,
          },
          allowedCodes,
          `widget ${widget.id}`
        );
        const normalized: SemanticWidget = {
          ...validated,
          source_ids: [...widget.source_ids],
          ...(widget.filters === undefined ? {} : { filters: { ...widget.filters } }),
        };
        return [normalized.id, normalized];
      })
    );
    if (this.widgets.size !== initial.length) throw new Error("Widget ids must be unique");
    this.operations = [...operations];
  }

  clone(): WidgetDraftStore {
    return new WidgetDraftStore(
      this.state(),
      this.allowedCodes,
      new Set(this.protectedIds),
      this.operations
    );
  }

  state(): SemanticWidget[] {
    return [...this.widgets.values()];
  }

  operationLog(): WidgetOperation[] {
    return [...this.operations];
  }

  execute(name: WidgetToolName, argumentsJson: string): unknown {
    const args = parseArguments(argumentsJson);
    if (name === "get_widgets") {
      assertKeys(args, ["widget_id"], "get_widgets arguments");
      const widgetId = args.widget_id === undefined
        ? undefined
        : string(args.widget_id, "get_widgets.widget_id", 80);
      const selected = widgetId === undefined
        ? this.state()
        : [this.widgets.get(widgetId)].filter((widget): widget is SemanticWidget => widget !== undefined);
      return {
        widgets: selected.map((widget) => ({
          ...widget,
          editable: !this.protectedIds.has(widget.id),
        })),
      };
    }

    if (name === "create_widget") {
      assertKeys(args, ["widget"], "create_widget arguments");
      const widget = widgetIntent(args.widget, this.allowedCodes, "create_widget.widget");
      if (this.protectedIds.has(widget.id)) throw new Error(`Widget is protected: ${widget.id}`);
      if (this.widgets.has(widget.id)) throw new Error(`Widget already exists: ${widget.id}`);
      if (this.widgets.size >= MAX_WIDGETS) throw new Error(`Widget draft cannot exceed ${MAX_WIDGETS} items`);
      this.widgets.set(widget.id, widget);
      this.operations.push({ op: "upsert", widget });
      return { status: "created", widget };
    }

    if (name === "update_widget") {
      assertKeys(args, ["widget_id", "changes"], "update_widget arguments");
      const widgetId = string(args.widget_id, "update_widget.widget_id", 80);
      if (this.protectedIds.has(widgetId)) throw new Error(`Widget is protected: ${widgetId}`);
      const current = this.widgets.get(widgetId);
      if (!current) throw new Error(`Widget does not exist: ${widgetId}`);
      const changes = object(args.changes, "update_widget.changes");
      assertKeys(changes, ["type", "title", "scope"], "update_widget.changes");
      if (Object.keys(changes).length === 0) throw new Error("update_widget.changes must not be empty");
      const widget = widgetIntent(
        {
          id: current.id,
          type: changes.type ?? current.type,
          title: changes.title ?? current.title,
          scope: changes.scope ?? current.scope,
        },
        this.allowedCodes,
        "update_widget"
      );
      const updated = {
        ...widget,
        source_ids: [...current.source_ids],
        ...(current.filters === undefined ? {} : { filters: { ...current.filters } }),
      };
      this.widgets.set(widgetId, updated);
      this.operations.push({ op: "upsert", widget: updated });
      return { status: "updated", widget: updated };
    }

    assertKeys(args, ["widget_id"], "delete_widget arguments");
    const widgetId = string(args.widget_id, "delete_widget.widget_id", 80);
    if (this.protectedIds.has(widgetId)) throw new Error(`Widget is protected: ${widgetId}`);
    if (!this.widgets.delete(widgetId)) throw new Error(`Widget does not exist: ${widgetId}`);
    this.operations.push({ op: "remove", widget_id: widgetId });
    return { status: "deleted", widget_id: widgetId };
  }
}
