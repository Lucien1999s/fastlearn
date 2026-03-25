# fastlearn

An AI-powered learning tool that turns notes into practice questions, provides AI grading, and supports personalized learning and progress tracking.

## Backend Quick Start

1. Create a `.env` file in the repo root and set:

```env
GOOGLE_API_KEY=your_google_api_key
```

2. Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

3. Start the backend:

```bash
uvicorn app.main:app --reload
```

## Swagger

After the server starts, open:

- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`
