# Cortex Mobile - App Store Production Checklist

## Completed Items

### Code Configuration
- [x] Environment configuration system (`src/config/env.ts`)
- [x] Production API URL configuration
- [x] Dev Login removed from production builds
- [x] Console.log statements replaced with production-safe logger
- [x] Privacy Policy and Terms of Service added
- [x] Legal links in auth screen
- [x] Account deletion functionality

### EAS Build Configuration
- [x] `eas.json` configured with development, preview, and production profiles
- [x] `app.json` updated with runtime version policy
- [x] iOS and Android build settings configured

### Assets
- [x] App icon generated (1024x1024)
- [x] Adaptive icon for Android generated (1024x1024)
- [x] Splash screen generated (1284x2778)
- [x] Favicon generated (48x48)

---

## Before Submitting to App Store

### 1. EAS Project Setup
```bash
# Login to EAS
eas login

# Link to EAS project (creates project ID)
eas init

# This will update app.json with your actual project ID
```

### 2. Update Configuration
Update `app.json`:
- Replace `"your-project-id"` with actual EAS project ID
- Replace `"your-eas-project-id"` in extra.eas.projectId

Update `eas.json` submit section:
- Replace `"your-apple-id@example.com"` with your Apple ID
- Replace `"your-app-store-connect-app-id"` with ASC app ID
- Replace `"YOUR_TEAM_ID"` with your Apple Developer Team ID

### 3. Apple Developer Account Requirements
- [ ] Enroll in Apple Developer Program ($99/year)
- [ ] Create App Store Connect app listing
- [ ] Configure app capabilities (Sign in with Apple)
- [ ] Create provisioning profiles via EAS

### 4. Google OAuth Configuration
For production, update Google Cloud Console:
- [ ] Add production redirect URIs
- [ ] Configure OAuth consent screen for production
- [ ] Request verification if accessing sensitive scopes (Gmail, Calendar)
- [ ] Add production bundle ID to authorized iOS apps

### 5. Backend Configuration
- [ ] Deploy backend to production server
- [ ] Update `EXPO_PUBLIC_API_URL` in `eas.json` production profile
- [ ] Configure production database
- [ ] Set up SSL certificates
- [ ] Configure production OAuth credentials

### 6. App Store Requirements
- [ ] Privacy Policy URL (host the policy online)
- [ ] Support URL
- [ ] Marketing URL (optional)
- [ ] App screenshots (6.7", 6.5", 5.5" for iPhone)
- [ ] App description and keywords
- [ ] Age rating questionnaire
- [ ] Export compliance information

---

## Build Commands

### Development Build (for testing)
```bash
eas build --profile development --platform ios
```

### Preview Build (internal testing)
```bash
eas build --profile preview --platform ios
```

### Production Build
```bash
eas build --profile production --platform ios
```

### Submit to App Store
```bash
eas submit --platform ios
```

---

## Environment Variables

### Development
- API URL: `http://192.168.1.34:8000`
- Dev Login: Enabled

### Preview/Production
- API URL: `https://api.cortex.app` (update to your actual URL)
- Dev Login: Disabled

---

## Testing Before Submission

### Functional Tests
- [ ] Sign in with Apple works
- [ ] Sign in with Google works
- [ ] Chat functionality works
- [ ] Voice recording works
- [ ] Photo capture works
- [ ] Google account connection works
- [ ] Email sync works
- [ ] Calendar sync works
- [ ] Account deletion works
- [ ] Sign out works

### UI Tests
- [ ] All screens render correctly
- [ ] Dark mode displays properly
- [ ] Safe area handling on all device sizes
- [ ] Keyboard avoidance works
- [ ] Loading states display correctly
- [ ] Error messages display correctly

### Performance Tests
- [ ] App launches in < 3 seconds
- [ ] Smooth scrolling in chat
- [ ] No memory leaks

---

## Custom App Icons

The generated icons are placeholder designs. For a polished App Store listing:

1. Design custom icon matching your brand
2. Place in `assets/` folder:
   - `icon.png` - 1024x1024 (iOS App Store)
   - `adaptive-icon.png` - 1024x1024 (Android foreground layer)
   - `splash.png` - 1284x2778 (splash screen)
   - `favicon.png` - 48x48 (web)

To regenerate placeholder icons:
```bash
node scripts/generate-icons.js
```

---

## Support Resources

- [Expo EAS Build Docs](https://docs.expo.dev/build/introduction/)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [EAS Submit Docs](https://docs.expo.dev/submit/introduction/)
