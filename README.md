# Aker Case Study

## Install

```powershell
py -m venv data\.venv
data\.venv\Scripts\python.exe -m pip install -r data\requirements.txt
```

## Convert Data

Put Excel into `data/raw` and run these under root directory:

```powershell
data\.venv\Scripts\python.exe data\rent_roll_to_csv.py
data\.venv\Scripts\python.exe data\unit_availability_to_csv.py
```

## Run The Application

Install and seed the server:

```powershell
Set-Location server
npm install
npm run seed
```

Create the local environment file and add the DeepSeek credentials:

```powershell
Copy-Item .env.example .env
notepad .env
npm run dev
```

The server loads `server/.env` through `dotenv`. The file is ignored by Git; only `.env.example` is committed. `AKER_LLM_TIMEOUT_MS` optionally controls the provider timeout and defaults to `30000`. The application does not generate template content when DeepSeek is unavailable; the Morning Brief page reports the specific provider error instead.

The assistant loop separates model attempts, business investigation rounds, business tool calls, and non-citable Widget draft calls. Business tools produce citable `tool_N` sources; Widget CRUD tools transactionally manage semantic Widget state; `submit_morning_brief` and `submit_assistant_answer` terminally submit only grounded text and citations. DeepSeek receives the available tools without `tool_choice` so its default Thinking Mode can select tools autonomously; when work budgets are exhausted, only the relevant submission tool remains available. After each work round the application injects a reserved `_budget_info` tool-result pair describing the remaining budget; this reserved tool is never registered, executed, or cited. Set `AKER_LLM_DEBUG=true` to log safe metadata without API keys, prompts, or business data.

Every DeepSeek provider exchange is saved as JSON under `server/data/llm-traces` by default. Set `AKER_LLM_TRACE_DIR` to use another directory. Unlike the safe console debug log, these files intentionally contain complete prompts, tool inputs and results, model responses, and reasoning content. They are retained until deleted manually and are ignored by Git.

Open `/api/debug/llm-traces` directly to inspect the saved exchanges. The debug viewer is served by Express, has no application navigation entry, and has no authentication. During Vite development it is available at `http://localhost:5173/api/debug/llm-traces` through the existing proxy, or directly from the server at `http://localhost:3000/api/debug/llm-traces`.

Start the client in another terminal:

```powershell
Set-Location client
npm install
npm run dev
```

Open `/morning-brief` and select **Generate brief**. Generation is manual and requires `DEEPSEEK_API_KEY`.
