# fastlearn

An AI-powered learning tool that turns notes into practice questions, provides AI grading, and supports personalized learning and progress tracking.

## Docker

1. Create a `.env` file in the repo root:

```env
GOOGLE_API_KEY=your_google_api_key
```

2. Start the full stack:

```bash
docker compose up --build
```

3. Open the services after startup:

- Frontend: `http://127.0.0.1:3000`
- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`

The Docker stack includes:

- `postgres`: stores generated quiz history
- `backend`: FastAPI + LangGraph + PostgreSQL persistence
- `frontend`: React + TypeScript + Vite UI served by Nginx

## Develop Use

### Backend

1. Start PostgreSQL first:

```bash
docker compose up -d postgres
```

2. Add these values to `.env`:

```env
GOOGLE_API_KEY=your_google_api_key
DATABASE_URL=postgresql+psycopg://fastlearn:fastlearn@localhost:5432/fastlearn
```

3. Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

4. Start the backend:

```bash
uvicorn app.main:app --reload
```

### Frontend

1. Install frontend dependencies:

```bash
cd frontend
npm install
```

2. Start the frontend dev server:

```bash
npm run dev
```

3. Open the dev app:

- Frontend: `http://127.0.0.1:5173`
- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`

## API Example

```bash
curl -X POST 'http://127.0.0.1:8000/api/quiz/run' \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "牛頓第一運動定律描述物體在不受外力時會維持原本的運動狀態。",
    "difficulty": "medium",
    "preference": "偏重觀念理解",
    "numbers": 5
  }'
```
