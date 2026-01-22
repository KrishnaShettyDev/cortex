# Cortex - Your Second Brain

Cortex is an iOS app that captures everything you think, say, and do - then lets you search and chat with your memories.

## Architecture

```
cortex/
├── backend/          # Python FastAPI backend
│   ├── app/
│   │   ├── api/      # API endpoints
│   │   ├── models/   # SQLAlchemy models
│   │   ├── schemas/  # Pydantic schemas
│   │   └── services/ # Business logic
│   └── migrations/   # Alembic migrations
│
└── ios/              # iOS SwiftUI app
    └── Cortex/
        └── Cortex/
            ├── App/      # App entry point
            ├── Views/    # SwiftUI views
            ├── Services/ # API services
            ├── Models/   # Data models
            └── Theme/    # Design system
```

## Tech Stack

### Backend
- Python 3.11 + FastAPI
- PostgreSQL with pgvector (Neon)
- OpenAI (embeddings + chat)
- Cloudflare R2 (file storage)
- Composio (integrations)

### iOS
- Swift + SwiftUI (iOS 17+)
- Apple Sign-In
- On-device speech recognition

## Getting Started

### Backend Setup

1. Create a virtual environment:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # macOS/Linux
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Copy environment file and configure:
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. Run migrations:
```bash
alembic upgrade head
```

5. Start the server:
```bash
uvicorn app.main:app --reload
```

### iOS Setup

1. Open `ios/Cortex/Cortex.xcodeproj` in Xcode

2. Update `Constants.swift` with your API URL

3. Configure signing & capabilities:
   - Sign in with Apple
   - Speech Recognition

4. Build and run on device (simulator has limited speech support)

## API Endpoints

### Authentication
- `POST /auth/apple` - Apple Sign-In
- `POST /auth/refresh` - Refresh token
- `DELETE /auth/account` - Delete account

### Memories
- `POST /memories` - Create memory
- `GET /memories` - List memories
- `GET /memories/search` - Search memories
- `GET /memories/:id` - Get memory
- `DELETE /memories/:id` - Delete memory

### Chat
- `POST /chat` - Chat with memories
- `POST /chat/stream` - Streaming chat (SSE)

### Integrations
- `GET /integrations/status` - Status of connections
- `GET /integrations/google/connect` - Connect Google
- `POST /integrations/sync` - Sync emails/calendar

### Upload
- `POST /upload/audio` - Upload audio file
- `POST /upload/photo` - Upload photo

## Environment Variables

```env
# Database
DATABASE_URL=postgresql+asyncpg://...

# Auth
JWT_SECRET=your-secret-key
APPLE_CLIENT_ID=com.yourcompany.cortex

# Storage (Cloudflare R2)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=cortex-uploads
R2_PUBLIC_URL=https://...

# AI
OPENAI_API_KEY=sk-...

# Integrations
COMPOSIO_API_KEY=...
```

## Docker

```bash
cd backend
docker-compose up --build
```

## License

MIT
