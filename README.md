# Aker Case Study Document

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
