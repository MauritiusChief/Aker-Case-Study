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

The assistant loop separates model attempts, real tool rounds, and real tool calls (at most 4 rounds and 8 real calls), then issues one final tool-less request to produce the JSON summary. The system prompt is built once per run and never changes between requests. After each tool round the application injects a reserved `_budget_info` tool-result pair describing the remaining budget; this reserved tool is never registered in the tool schema and can never be cited or executed. Set `AKER_LLM_DEBUG=true` to log safe metadata (provider, phase, model attempt, tool round, finish reason, remaining budget, source ids and durations) without API keys, prompts, or business data.

Every DeepSeek provider exchange is saved as JSON under `server/data/llm-traces` by default. Set `AKER_LLM_TRACE_DIR` to use another directory. Unlike the safe console debug log, these files intentionally contain complete prompts, tool inputs and results, model responses, and reasoning content. They are retained until deleted manually and are ignored by Git.

Open `/api/debug/llm-traces` directly to inspect the saved exchanges. The debug viewer is served by Express, has no application navigation entry, and has no authentication. During Vite development it is available at `http://localhost:5173/api/debug/llm-traces` through the existing proxy, or directly from the server at `http://localhost:3000/api/debug/llm-traces`.

Start the client in another terminal:

```powershell
Set-Location client
npm install
npm run dev
```

Open `/morning-brief` and select **Generate brief**. Generation is manual and requires `DEEPSEEK_API_KEY`.
