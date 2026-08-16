# Agent 调查循环与预算注入执行计划

## 背景

Morning Brief 使用 DeepSeek Function Calling 调查候选物业。当前循环将模型调用轮次、工具调查轮次和最终输出轮次混在同一个 `MAX_MODEL_ROUNDS = 4` 中，因此模型在第 4 轮继续调用工具时会直接触发：

```text
Model exceeded the bounded investigation limit
```

当前实现已进一步迁移到工具化提交：DeepSeek 不再通过普通正文输出最终 JSON，而是调用专用 submission tool；Widget 状态由独立 CRUD 工具维护。

`reference` 目录中的成熟实现已经验证了虚拟 `_budget_info` tool pair 对模型预算理解更稳定。本项目采用该机制，不在不同模型请求之间动态改写 system prompt。

## 目标

- 明确区分模型请求次数、真实工具轮次和真实工具调用次数。
- 允许最多 4 轮真实工具调查和 8 次真实工具调用。
- 最终文本和 citations 只允许通过专用 submission tool 提交。
- Widget 使用独立的、非引用型 CRUD 工具维护事务草稿。
- 使用应用注入的虚拟 `_budget_info` tool pair 告知模型最新预算。
- system prompt 在一次 Agent run 中保持完全不变。
- 保留现有确定性事实、物业范围、引用校验和 Widget 数据契约。
- 防止模型伪造 `_budget_info` 或绕过工具预算。
- 增加足够的安全调试信息，但不记录 API Key、完整 prompt 或业务数据。

## 非目标

- 不引入多 Agent dispatch。
- 不引入 OpenRouter 或多模态能力。
- 不流式输出未经验证的正文或工具参数。
- 不持久化完整 prompt、reasoning 或工具结果 trace。
- 不并行执行当前同步 SQLite 工具。
- 不引入 fuzzy search 或 reference 中的 search-shape 逻辑。
- 不降低现有引用、范围和输出验证强度。

## 已确认的设计决策

### 1. System Prompt 固定

每次 Agent run 开始时只构造一次 system prompt，之后所有模型请求复用同一内容。system prompt 静态声明预算协议和初始上限：

```text
This run allows at most 4 investigation tool rounds and 8 real tool calls.
The application may provide trusted budget updates through reserved
_budget_info tool-result pairs. This reserved tool is never available for
you to call. Use the latest injected budget status when planning further
investigation.
```

每轮变化的剩余预算不写回 system prompt。

### 2. 使用虚拟 `_budget_info` Tool Pair

每轮真实工具全部执行完成后，应用向消息历史追加一个 synthetic assistant/tool pair：

```ts
messages.push({
  role: "assistant",
  content: null,
  tool_calls: [{
    id: `_budget_info_${runId}_${round}`,
    type: "function",
    function: {
      name: "_budget_info",
      arguments: "{}",
    },
  }],
});

messages.push({
  role: "tool",
  tool_call_id: `_budget_info_${runId}_${round}`,
  content: JSON.stringify({
    source: "application_control",
    remaining_tool_calls: remainingToolCalls,
    remaining_tool_rounds: remainingToolRounds,
    total_tool_calls: maxToolCalls,
    instruction: remainingToolRounds > 0
      ? "Plan further investigation within this budget."
      : "Investigation is complete. Call the submission tool.",
  }),
});
```

该 pair 是 OpenAI-compatible 消息历史的一部分，但 `_budget_info` 不会作为可调用工具发送给 DeepSeek。

### 3. 三个独立上限

```ts
maxModelAttempts: 6
maxToolRounds: 4
maxRealToolCalls: 8
maxWidgetToolCalls: 8
```

- `modelAttempts`：每次 provider 请求都计数，包括空响应重试和最终汇总。
- `toolRounds`：只有模型返回并成功执行至少一个真实工具时才计数。
- `realToolCalls`：只统计真实业务工具，不统计 `_budget_info`。
- 正常最坏路径为 4 次工具响应加 1 次最终汇总，共 5 次模型请求。
- 第 6 次模型请求只为一次有界空响应恢复保留，不能形成无限重试。

### 4. Submission 独立于业务与 Widget 预算

正常轮次同时开放当前仍有预算的业务工具、Widget CRUD 工具和当前工作流的 submission tool，并使用 `tool_choice: "required"`。达到预算边界或最后一次模型机会时，只开放 submission tool。

- `toolRounds === maxToolRounds`
- `realToolCalls === maxRealToolCalls`
- 模型调用 submission tool

达到业务工具轮次上限时不再开放业务工具；如果 Widget 预算仍有剩余，模型仍可调整 Widget 草稿或直接提交。

强制提交请求在 Agent 层使用：

```ts
model.complete({
  messages,
  tools: [submissionTool],
  toolChoice: { type: "function", function: { name: submissionTool.function.name } },
});
```

普通轮次使用 `tool_choice: "required"`，不再发送 JSON response mode。

### 5. Schema 限制与 Hallucination 清理同时保留

两者职责不同，不互相替代：

- `_budget_info` 不注册到工具 schema，避免模型将其视为可用能力。
- 模型仍可能模仿历史消息生成同名调用，因此必须清理 hallucination。
- provider 新返回的 response 完全由模型生成，其中任何 `_budget_info` 都不可信。
- 应用注入的合法 `_budget_info` 已经位于历史 `messages` 中，不会出现在新的 provider response 对象中。

因此不能仅凭 ID 正则将模型返回的 `_budget_info` 判为合法。处理方式为：

```ts
const rawCalls = response.tool_calls ?? [];
const hallucinatedBudgetCalls = rawCalls.filter(
  (call) => call.function.name === "_budget_info"
);
const realCalls = rawCalls.filter(
  (call) => call.function.name !== "_budget_info"
);
response.tool_calls = realCalls;
```

处理规则：

- 混合真实工具和 `_budget_info`：移除 `_budget_info`，继续处理真实工具。
- 同时存在 submission 和 `_budget_info`：移除 `_budget_info`，继续验证 submission arguments。
- 只有 `_budget_info`：视为无合法工具调用并拒绝。
- 不执行模型返回的 `_budget_info`。
- 不为模型返回的 `_budget_info` 追加 tool result。
- 记录一次安全 debug event。

### 6. 虚拟预算信息与业务 Sources 隔离

只有真实工具结果进入可引用 source map：

```ts
sources.set(`tool_${realToolCalls}`, result);
```

`_budget_info` 必须满足：

- 不生成 `tool_N` source ID。
- 不进入 `sources`。
- 不计入 `investigation.tool_calls`。
- 不允许 findings、answers 或 widgets 引用。
- 不参与 JSON Pointer citation 验证。
- trace 中标记为 `source: "application_control"` 或 `source: "injected"`。

### 7. 预算由服务端强制执行

虚拟预算信息用于帮助模型规划，不是安全边界。真实工具执行前仍需检查：

```ts
if (realCalls.length > remainingToolCalls) {
  throw new LlmError(
    "llm_investigation_limit",
    "Model requested more tools than the remaining investigation budget"
  );
}
```

同一轮整体校验通过后才开始执行，不能只执行预算内的前几个工具。还必须检查：

- tool call ID 非空且本轮不重复。
- 工具名属于 `AssistantToolName`。
- 工具名存在于当前轮开放的真实工具集合。
- arguments 是合法 JSON object。
- 不包含 schema 之外的参数。
- `property_code` 和 `property_codes` 位于当前 candidate 或 portfolio scope。
- 总调用数不会超过剩余预算。

## 目标消息流程

```text
固定 system
user task + brief_facts

模型响应：真实 tool calls
应用响应：真实 tool results
应用注入：assistant _budget_info call
应用注入：tool _budget_info result

模型响应：下一轮真实 tool calls
应用响应：真实 tool results
应用注入：assistant _budget_info call
应用注入：tool _budget_info result

达到 4 个真实工具轮次
应用注入：remaining_tool_rounds = 0
DeepSeek 请求：不提供 tools/tool_choice
模型响应：最终 JSON
应用：结构、引用、范围和 Widget 校验
```

模型如果在预算耗尽前返回无工具内容，则直接进入现有最终输出校验，不再额外请求一次。

## 文件级执行步骤

### 1. `server/src/assistant-types.ts`

- 为 `ModelMessage` 增加可选 `finish_reason`。
- 将真实业务工具名与保留控制工具名分开。
- 新增 `llm_investigation_limit` 错误码。
- 增加 Agent 调查状态和安全事件类型。
- 保持 `ChatModel` provider-neutral，不绑定 DeepSeek 细节。

建议类型边界：

```ts
type AssistantToolName =
  | "get_property_summary"
  | "get_portfolio_comparison"
  | "get_availability"
  | "get_lease_risk"
  | "get_rent_gap"
  | "get_data_quality";

type WidgetToolName = "create_widget" | "get_widgets" | "update_widget" | "delete_widget";
type SubmissionToolName = "submit_morning_brief" | "submit_assistant_answer";
type ReservedControlToolName = "_budget_info";
type MessageToolName = AssistantToolName | WidgetToolName | SubmissionToolName | ReservedControlToolName;
```

### 2. `server/src/assistant-tools.ts`

- 将 `ToolExecutor` 的工具名参数从 `string` 收紧为 `AssistantToolName`。
- 新增 `isAssistantToolName()` 类型守卫。
- 保持现有动态物业 enum schema。
- 保持运行时 scope 和参数校验。
- 不把 `_budget_info` 加入 `ASSISTANT_TOOL_NAMES` 或 `buildAssistantTools()`。
- 当前工具继续串行执行，因为它们是同步 SQLite 计算。

### 3. 新增 `server/src/grounded-agent.ts`

抽取通用调查循环，供 Morning Brief 和 Q&A 共用。该模块负责：

- 模型、业务工具、Widget 工具计数器和上限。
- provider response 的 `_budget_info` hallucination 清理。
- 真实工具白名单、ID 和预算预检查。
- 真实工具执行及 source ID 分配。
- 应用 `_budget_info` pair 注入。
- `tool_choice: "required"` 和 named submission 状态机。
- submit-wins 及同轮 Widget mutation 原子事务。
- 安全事件和错误分类。
- 返回结构化 submission arguments、Widget 草稿、sources 和调查统计。

该模块不负责：

- Morning Brief 字段验证。
- Q&A 字段验证。
- citation JSON Pointer 验证。
- 文本和 citation 业务字段验证。

### 4. `server/src/assistant-workflow.ts`

- 移除当前混合语义的 `MAX_MODEL_ROUNDS` 循环。
- 保留 `validateBrief()`、`validateAnswer()` 和引用验证。
- 保留固定 `SYSTEM_PROMPT`。
- Morning Brief 与 Q&A 通过配置调用 `grounded-agent.ts`。
- Morning Brief 有 findings 时继续要求至少一次真实调查工具调用。
- 优化任务文本，提示模型在一次响应中批量请求互相独立的调查工具。
- 保留空 findings 和 widgets 为合法结果。

### 5. `server/src/deepseek.ts`

- 解析并保留 `choices[0].finish_reason`。
- 转发 `required` 和 named `tool_choice`。
- 不再发送 `response_format: json_object`。
- 保留 timeout、auth、rate limit 和 provider error 映射。
- 不打印 Authorization header、API Key、完整请求或完整响应。

### 6. `server/src/config.ts` 和 `server/.env.example`

新增：

```env
AKER_LLM_DEBUG=false
```

启用后仅记录：

- provider 和 model。
- phase 和 model attempt。
- real tool round。
- `finish_reason`。
- `has_content`。
- 真实工具名称和数量。
- 被移除的 `_budget_info` hallucination 数量。
- 剩余真实调用和轮次。
- source ID 和耗时。
- 最终验证错误类型。

禁止记录：

- API Key。
- Authorization header。
- 完整 prompt。
- 模型正文。
- 工具 arguments 原文。
- 工具结果。
- resident 数据。
- hidden reasoning。

### 7. `server/src/routes/assistant.routes.ts`

- 将 `llm_investigation_limit` 映射为独立错误响应。
- HTTP status 继续使用 `502`，表示上游模型未能遵守应用调查边界。
- 保持其他 provider 错误状态不变。

### 8. Client 错误展示

涉及文件：

- `client/src/types.ts`
- `client/src/api/client.ts`
- `client/src/pages/MorningBriefPage.tsx`

新增客户端错误码：

```text
INVESTIGATION_LIMIT
```

用于区分：

- provider 返回的格式无效。
- Agent 未能在应用调查预算内完成。

该错误不得修改已有 workspace 内容，并允许用户 retry。

### 9. 文档

更新：

- `README.md`
- `server/.env.example`

说明固定 system prompt、虚拟预算消息、工具化提交、Widget 草稿和安全 debug 开关。

## 测试计划

### `server/test/grounded-agent.test.ts`

- 连续业务工具调用后通过 submission tool 返回结构化文本。
- 连续工具轮次后正确注入匹配的 `_budget_info` assistant/tool pair。
- 每个 synthetic call ID 唯一。
- `_budget_info` 不计入真实工具调用数。
- `_budget_info` 不进入 sources。
- 第 4 个工具轮次后注入 `remaining_tool_rounds: 0`。
- 预算耗尽后最终请求只开放 named submission tool。
- 普通正文永远不能替代 submission tool。
- 一轮请求多个真实工具时只增加 1 个 tool round。
- 总计恰好 8 次真实调用允许执行。
- 第 9 次真实调用在任何工具执行前被拒绝。
- 单轮超过剩余预算时不部分执行。
- 未开放或未知工具不执行。
- 本轮重复 tool call ID 被拒绝。
- 混合真实工具和伪造 `_budget_info` 时只执行真实工具。
- submit 和伪造 `_budget_info` 同时出现时清理控制调用并验证 submit。
- 同轮 Widget mutations 与 submit 原子提交。
- 同轮业务查询与 submit 时忽略业务查询。
- 达到 `maxModelAttempts` 后明确失败，不无限循环。

### `server/test/assistant-workflow.test.ts`

- 保留原有 grounded citation 测试。
- 保留 Morning Brief finding 强制调查测试。
- 保留 Q&A prior brief 和 Widget 操作测试。
- 增加当前 4 个候选式连续调查后成功汇总的回归测试。
- 确认最终引用只能指向 `brief_facts` 或真实 `tool_N`。
- 确认引用 `_budget_info` 会失败。

### `server/test/deepseek.test.ts`

- 空工具请求的 HTTP body 不包含 `tools`。
- 空工具请求的 HTTP body 不包含 `tool_choice`。
- 普通请求包含 `tool_choice: "required"`，强制提交请求包含 named choice。
- `finish_reason` 被正确解析。
- 现有配置、认证、限流、超时和 malformed payload 测试继续通过。

### Client 验证

- `llm_investigation_limit` 正确映射为 `INVESTIGATION_LIMIT`。
- 页面展示独立错误文案。
- 失败响应不覆盖 brief、chat、widgets、snapshot 或 revision。
- Retry 使用原有失败请求机制。

## 验证命令

Server：

```powershell
npm run build
npm test
```

工作目录：`server`

Client：

```powershell
npm run typecheck
npm run build
```

工作目录：`client`

真实 DeepSeek smoke test：

- 使用当前 4 个候选物业生成 Morning Brief。
- 确认可以完成 4 个工具轮次并调用 submission tool。
- 确认不再出现 `Model exceeded the bounded investigation limit`。
- 开启 debug 时确认日志只包含安全元数据。
- 关闭 debug 时确认没有 Agent 循环调试输出。

## 验收标准

- 一次 run 内所有 provider 请求使用完全相同的 system prompt。
- `_budget_info` 从不出现在发送给模型的工具 schema 中。
- 每轮真实工具执行后都有应用注入的预算状态。
- 模型生成的 `_budget_info` 永远不会执行。
- 应用注入的 `_budget_info` 不可引用且不计入调查统计。
- 4 个真实工具轮次后仍有一次 named submission 机会。
- 最终 DeepSeek 请求只开放对应 submission tool。
- 工具调用预算在执行前强制检查，不发生部分超支执行。
- 现有事实范围和 citation 契约保持不变；Widget 改为事务型 CRUD 草稿。
- Server build、全部 Server tests、Client typecheck 和 Client build 全部通过。

## 推荐实施顺序

1. 增加类型和独立错误码。
2. 收紧真实工具名称和执行器类型。
3. 实现通用 grounded Agent 循环和 `_budget_info` 注入。
4. 将 Morning Brief 与 Q&A 接入新循环。
5. 修正 DeepSeek 空工具请求。
6. 增加 Server 单元测试和回归测试。
7. 增加安全 debug 日志。
8. 更新 route 和 Client 错误映射。
9. 更新文档。
10. 完成 build、test 和真实 DeepSeek smoke test。
