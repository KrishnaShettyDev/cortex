# Cortex Mobile App (React Native / Expo)

A React Native implementation of Cortex - your AI-powered second brain.

## Features

- Dark glassmorphic Japanese minimal UI
- Apple Sign-In authentication
- Google Sign-In authentication (requires setup)
- Dev login for testing
- AI chat powered by GPT-4o
- Memory creation and search
- Hybrid search with vector + full-text

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (Mac only) or Android Emulator
- Expo Go app on your physical device

### Installation

```bash
cd mobile
npm install
```

### Running the App

```bash
# Start Expo development server
npm start

# Or specifically for iOS
npm run ios

# Or for Android
npm run android
```

### Connecting to Backend

1. Make sure the backend server is running:
   ```bash
   cd ../backend
   source venv/bin/activate
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. Update the API URL in `src/services/constants.ts`:
   - For iOS Simulator: `http://localhost:8000`
   - For physical device: `http://<your-computer-ip>:8000`

   Find your IP with:
   ```bash
   # Mac
   ipconfig getifaddr en0
   ```

### Testing on Physical Device

1. Install Expo Go from App Store / Play Store
2. Scan the QR code from the terminal
3. Make sure your phone is on the same WiFi network
4. Update the API_BASE_URL to your computer's local IP

## Project Structure

```
mobile/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout
│   ├── index.tsx           # Entry point (redirects)
│   ├── auth.tsx            # Auth screen
│   └── (main)/             # Main app screens
│       ├── _layout.tsx
│       ├── chat.tsx        # Main chat screen
│       ├── settings.tsx    # Settings modal
│       └── add-memory.tsx  # Add memory modal
├── src/
│   ├── components/         # Reusable components
│   ├── context/            # React contexts (Auth)
│   ├── services/           # API services
│   ├── theme/              # Colors, typography, styles
│   └── types/              # TypeScript types
└── assets/                 # App icons and splash
```

## Configuration

### Apple Sign-In

Apple Sign-In is configured for Expo. For production builds:
1. Add "Sign In with Apple" capability in App Store Connect
2. Configure your Apple Developer account

### Google Sign-In

Google Sign-In requires additional setup:
1. Create OAuth credentials in Google Cloud Console
2. Configure `expo-auth-session` with your client IDs
3. Update the auth flow in `AuthContext.tsx`

## Building for Production

```bash
# Create a development build
npx expo prebuild

# Build for iOS
npx expo run:ios --configuration Release

# Build for Android
npx expo run:android --variant release
```

Or use EAS Build:

```bash
npm install -g eas-cli
eas build --platform all
```

## Tech Stack

- React Native 0.76
- Expo SDK 52
- Expo Router 4 (file-based routing)
- TypeScript
- Expo Secure Store (token storage)
- Expo Linear Gradient (glassmorphic effects)
