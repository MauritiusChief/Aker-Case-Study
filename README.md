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

Every DeepSeek provider exchange is saved as JSON under `server/data/llm-traces` by default. Set `AKER_LLM_TRACE_DIR` to use another directory. Unlike the safe console debug log, these files intentionally contain complete prompts, tool inputs and results, model responses, and reasoning content. They are retained until deleted manually and are ignored by Git.

Open `/api/debug/llm-traces` directly to inspect the saved exchanges. The debug viewer is served by Express, has no application navigation entry, and has no authentication. During Vite development it is available at `http://localhost:5173/api/debug/llm-traces` through the existing proxy, or directly from the server at `http://localhost:3000/api/debug/llm-traces`.

Start the client in another terminal:

```powershell
Set-Location client
npm install
npm run dev
```

Open `/morning-brief` and select **Generate brief**. Generation is manual and requires `DEEPSEEK_API_KEY`.
