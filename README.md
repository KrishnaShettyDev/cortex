# Cortex - Your Second Brain

Cortex is a mobile app that captures everything you think, say, and do - then lets you search and chat with your memories using AI.

## Architecture

```
cortex/
├── backend/              # Python FastAPI backend
│   ├── app/
│   │   ├── api/          # API endpoints
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   └── services/     # Business logic
│   └── tests/            # API tests
│
└── mobile/               # React Native (Expo) app
    ├── app/              # Expo Router screens
    │   ├── (main)/       # Main app screens
    │   └── auth.tsx      # Authentication
    └── src/
        ├── components/   # Reusable UI components
        ├── services/     # API services
        ├── hooks/        # Custom React hooks
        ├── stores/       # Zustand state stores
        ├── context/      # React contexts
        ├── lib/          # Utilities & integrations
        ├── theme/        # Design system
        └── types/        # TypeScript definitions
```

## Tech Stack

### Backend
- Python 3.11 + FastAPI
- PostgreSQL with pgvector (Neon)
- OpenAI (embeddings + chat)
- Cloudflare R2 (file storage)
- Composio (Google/Microsoft integrations)

### Mobile
- React Native + Expo SDK 54
- TypeScript
- Expo Router (file-based navigation)
- Zustand (state management)
- React Query (data fetching)
- Apple & Google Sign-In
- Push notifications
- Offline support with SQLite

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

### Mobile Setup

1. Install dependencies:
```bash
cd mobile
npm install
```

2. Start the development server:
```bash
npm start
```

3. Run on device:
```bash
# iOS Simulator
npm run ios

# Android Emulator
npm run android

# Physical device
# Scan QR code with Expo Go app
```

4. For development builds (push notifications, etc.):
```bash
npx expo prebuild
npx expo run:ios  # or run:android
```

## API Endpoints

### Authentication
- `POST /auth/apple` - Apple Sign-In
- `POST /auth/google` - Google Sign-In
- `POST /auth/refresh` - Refresh token
- `DELETE /auth/account` - Delete account

### Memories
- `POST /memories` - Create memory (text/voice/photo)
- `GET /memories` - List memories
- `GET /memories/search` - Semantic search
- `DELETE /memories/:id` - Delete memory

### Chat
- `POST /chat/stream` - AI chat with memories (SSE streaming)
- `POST /chat/actions/execute` - Execute pending actions

### Integrations
- `GET /integrations/status` - Connection status
- `GET /integrations/google/connect` - OAuth flow
- `POST /integrations/sync` - Sync emails/calendar
- `GET /integrations/calendar/events` - Get calendar events
- `POST /integrations/calendar/events` - Create calendar event

### People Intelligence
- `GET /people` - List people from memories
- `GET /people/:name` - Person profile
- `GET /people/:name/context` - Meeting context

## Environment Variables

### Backend (.env)
```env
# Database
DATABASE_URL=postgresql+asyncpg://...

# Auth
JWT_SECRET=your-secret-key
APPLE_CLIENT_ID=com.yourcompany.cortex
GOOGLE_CLIENT_ID=...

# Storage (Cloudflare R2)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=cortex-uploads

# AI
OPENAI_API_KEY=sk-...

# Integrations
COMPOSIO_API_KEY=...
```

### Mobile (eas.json / env)
```env
EXPO_PUBLIC_API_URL=https://api.cortex.app
EXPO_PUBLIC_SENTRY_DSN=...
EXPO_PUBLIC_POSTHOG_API_KEY=...
```

## Testing

### Backend
```bash
cd backend
pytest
```

### Mobile
```bash
cd mobile
npm test
```

## Building for Production

### Mobile (EAS Build)
```bash
cd mobile

# iOS
eas build --platform ios --profile production

# Android
eas build --platform android --profile production
```

## License

MIT
