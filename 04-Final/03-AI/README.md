# 03-AI — GDG assistant

The platform's Arabic assistant (**المساعد**) lives in [`Anas_Musleh/`](Anas_Musleh/README.md): a Python 3.13 FastAPI service built on Gemini.

- **Private:** browsers never reach it. The backend forwards `POST /api/assistant` to it with the shared secret `CHATBOT_INTERNAL_KEY`.
- **Read-only:** it reads platform data only through `GET /api/assistant/data/*` and a few other GET endpoints, always with the signed-in user's own token. Each user therefore sees exactly what their role and campus allow in the app.
- **Quick answers:** questions about how to use the platform, "my points" and "my team's points this month" are answered without calling Gemini. They keep working when the Gemini quota is used up.

**Run locally:**
```bash
cd Anas_Musleh
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows; on macOS/Linux use .venv/bin/pip
uvicorn app.server:app --host 127.0.0.1 --port 8000
```

**Production:** see [`DEPLOYMENT_GUIDE.md` §2](../DEPLOYMENT_GUIDE.md). Required variables: `BACKEND_MODE=real`, `BACKEND_URL`, `CHATBOT_INTERNAL_KEY` and `GEMINI_API_KEY`.

**Tests:** `python -m pytest -q` (no API key needed).
