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

Start the client in another terminal:

```powershell
Set-Location client
npm install
npm run dev
```

Open `/morning-brief` and select **Generate brief**. Generation is manual and requires `DEEPSEEK_API_KEY`.
