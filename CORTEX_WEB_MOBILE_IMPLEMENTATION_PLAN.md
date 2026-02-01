# Cortex Web & Mobile App - Complete Implementation Plan

**Target**: Build consumer-facing (B2C) web and mobile apps with **identical features and UI styling**

**Design Reference**: iOS app colors, layout, and styling (Apple Blue design system)

**User Base**: Individual consumers (not B2B/dev/API users)

---

## 1. Feature Audit - iOS Mobile App

### Current Mobile App Features (From Codebase Analysis)

#### A. Authentication & User Management
- ✅ Google Sign In (Apple + iOS + Web client IDs)
- ✅ Apple Sign In
- ✅ JWT token management
- ✅ User profile (name, email, avatar)
- ✅ Sign out
- ✅ Delete account

#### B. Core Screens
1. **Chat Screen** (`/chat`)
   - Chat interface with AI assistant
   - Day briefing scroll
   - Insights pill row (attention needed, urgent emails, pending commitments, important dates)
   - Greeting based on time of day
   - Empty state with suggestions
   - Autonomous actions list
   - Chat history with bubbles

2. **Calendar Screen** (`/calendar`)
   - Full calendar integration with Google Calendar
   - Day/Week/Agenda view modes
   - Mini calendar date picker
   - Hour-by-hour timeline (7 AM - 11 PM)
   - Event blocks with meeting type logos (Google Meet, Zoom, Teams, Offline)
   - Current time indicator
   - Tap-to-create events
   - Find time sheet (AI suggests free slots)
   - Quick add input (natural language event creation)
   - Event details modal with:
     - Meeting type
     - Date/time
     - Location
     - Attendees
     - Description
     - Join meeting button
     - Ask Cortex button
   - Conflict detection & warnings
   - Swipe gestures for navigation
   - Pull-to-refresh
   - Skeleton loading states

3. **Settings Screen** (`/settings`)
   - Profile section (avatar, name, email)
   - Menu items:
     - Calendar
     - Contact Us (WhatsApp)
   - Appearance section (System/Light/Dark theme)
   - Connected Accounts section (expandable)
     - Google account status
     - Connect/disconnect buttons
   - Sign out
   - Delete account

4. **Connected Accounts Screen** (`/connected-accounts`)
   - Google account row (Gmail + Calendar)
   - Microsoft account row (coming soon)
   - Sync button
   - Disconnect button
   - Connection status indicators
   - Pull-to-refresh

5. **Add Memory Screen** (`/add-memory`)
   - Quick add interface
   - Memory creation form

6. **People Screen** (`/people`)
   - Contact management

7. **Notification Settings** (`/notification-settings`)
   - Notification preferences

#### C. Components & Features
- **Autonomous Actions**
  - Email reply suggestions with pre-filled drafts
  - Calendar suggestions (reschedule conflicts, focus blocks)
  - One-tap approve/dismiss cards
  - Inline edit mode
  - Service icons + confidence indicators

- **Chat Interface**
  - Message bubbles
  - Loading indicator (thinking animation)
  - Reasoning steps display
  - Rich content cards
  - Suggestion pills

- **Calendar Components**
  - Date strip scroller (horizontal scrollable days)
  - Event cards with conflict indicators
  - Meeting type logos (Google Meet, Zoom, Teams, Webex, WhatsApp)
  - Service status pills
  - Calendar skeleton loader
  - Find Time Sheet (AI-powered free slot finder)
  - Quick Add Input (natural language parsing)

- **UI Components**
  - Glass card (glassmorphic styling)
  - Glass container
  - Gradient icons
  - Bottom sheet
  - Floating action button
  - Account switcher
  - Error boundary

#### D. Integrations
- ✅ Gmail sync (via Composio)
- ✅ Google Calendar sync (via Composio)
- ✅ OAuth flow with callbacks
- ✅ Background sync workers

#### E. Theming
- **Apple Blue Design System**
- Dark mode (OLED black: `#000000`)
  - Primary: `#000000`
  - Secondary: `#1C1C1E`
  - Tertiary: `#2C2C2E`
  - Accent: `#0A84FF`
  - Text primary: `#FFFFFF`
  - Text secondary: `#8E8E93`
- Light mode
  - Primary: `#FAFAFA`
  - Secondary: `#FFFFFF`
  - Tertiary: `#F2F2F7`
  - Accent: `#007AFF`
  - Text primary: `#1A1A1A`
  - Text secondary: `#6B6B6B`
- Glass effects (borders, backgrounds, blur)
- Service colors (Gmail: `#EA4335`, Calendar: `#4285F4`, etc.)

---

## 2. Feature Gap Analysis - Web App vs Mobile App

### Current Web App Features (From Files Read)

#### ✅ Implemented
- Landing page
- Sign-in page (Google OAuth)
- Dashboard (basic Supermemory-style UI)
- Add Memory modal (Note/Link/File/Connect tabs)
- User menu
- Chat input
- Memories section
- API client with auth
- Zustand auth store
- TypeScript types

#### ❌ Missing (Hardcoded/Non-functional)
- Calendar integration
- Settings page
- Connected accounts management
- Theme switcher
- Autonomous actions
- Chat history/bubbles
- Day briefing
- Insights pills
- Gmail sync UI
- Calendar sync UI
- Event details
- Find time feature
- Quick add events
- Conflict detection
- People/contacts
- Notification settings
- Delete account
- Profile management

---

## 3. UI/UX Specification - Mobile Style for Web

### Design Principles
1. **Identical Layout**: Web should match mobile screen layouts exactly
2. **Responsive Sizing**: Scale components proportionally for larger screens
3. **Same Colors**: Use exact same color tokens from `mobile/src/theme/colors.ts`
4. **Same Spacing**: Use spacing system from mobile (`spacing.ts`)
5. **Same Typography**: Match font sizes, weights, line heights
6. **Same Animations**: Replicate loading states, transitions, gestures
7. **Same Icons**: Use same Ionicons set

### Color System (Copy from Mobile)
```typescript
// Dark Mode (Default)
export const darkColors = {
  bgPrimary: '#000000',
  bgSecondary: '#1C1C1E',
  bgTertiary: '#2C2C2E',
  bgElevated: '#1C1C1E',
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',
  textQuaternary: '#3A3A3C',
  accent: '#0A84FF',
  accentLight: 'rgba(10, 132, 255, 0.15)',
  accentPressed: '#409CFF',
  separator: '#2C2C2E',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassBackground: 'rgba(255, 255, 255, 0.04)',
  // ... full color system
}

// Service Colors (Brand colors - same across themes)
gmail: '#EA4335',
calendar: '#4285F4',
google: '#4285F4',
microsoft: '#00A4EF',
whatsapp: '#25D366',
```

### Spacing System
```typescript
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
}
```

### Border Radius
```typescript
export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
}
```

### Component Mapping (Mobile → Web)

| Mobile Component | Web Equivalent | Status |
|-----------------|----------------|--------|
| `SafeAreaView` | `<div className="min-h-screen">` | ✅ Implemented |
| `TouchableOpacity` | `<button className="active:opacity-70">` | ✅ Implemented |
| `ScrollView` | `<div className="overflow-scroll">` | ✅ Implemented |
| `LinearGradient` | `<div className="bg-gradient-to-r">` | ❌ Need to add |
| `BlurView` | `backdrop-blur-md` | ❌ Need to add |
| `Ionicons` | Use `react-icons/io5` | ❌ Need to add |
| `GestureHandler` | Mouse/touch events | ❌ Need to add |
| `Animated` | Framer Motion or CSS transitions | ❌ Need to add |
| `Modal` | Dialog component | ✅ Partial |

---

## 4. Implementation Phases

### Phase 1: Foundation & Design System (Week 1)

**Goal**: Establish identical design system and base components

#### 1.1 Design Tokens
- Copy `mobile/src/theme/colors.ts` → `web/lib/theme/colors.ts`
- Copy `mobile/src/theme/spacing.ts` → `web/lib/theme/spacing.ts`
- Copy `mobile/src/theme/typography.ts` → `web/lib/theme/typography.ts`
- Create Tailwind config with these tokens
- Add theme context provider (light/dark/system)

#### 1.2 Base Components Library
Create identical versions of mobile components:

**File**: `web/components/ui/GlassCard.tsx`
```tsx
// Glassmorphic card matching mobile BlurView
export function GlassCard({ children, className }: Props) {
  return (
    <div className="backdrop-blur-[25px] bg-white/[0.04] border border-white/[0.08] rounded-lg">
      {children}
    </div>
  );
}
```

**File**: `web/components/ui/Button.tsx`
```tsx
// Match mobile TouchableOpacity behavior
export function Button({ variant, children, ...props }: Props) {
  return (
    <button
      className="active:opacity-70 transition-opacity"
      {...props}
    >
      {children}
    </button>
  );
}
```

**File**: `web/components/ui/ServiceIcon.tsx`
```tsx
// Match mobile service icons
export function GmailIcon() { /* ... */ }
export function CalendarIcon() { /* ... */ }
export function GoogleMeetIcon() { /* ... */ }
```

**Components to Create**:
- `GlassCard.tsx`
- `GlassContainer.tsx`
- `Button.tsx` (variants: primary, secondary, ghost)
- `IconButton.tsx`
- `ServiceIcon.tsx` (Gmail, Calendar, Meet, Zoom, Teams, etc.)
- `LoadingSpinner.tsx`
- `Skeleton.tsx`
- `Modal.tsx` / `Sheet.tsx`
- `Input.tsx`
- `Textarea.tsx`
- `Select.tsx`
- `Switch.tsx`

#### 1.3 Icon System
- Install `react-icons`
- Create icon wrapper matching Ionicons API
- Export icon set from `web/components/icons/index.ts`

#### 1.4 Animation System
- Install `framer-motion`
- Create reusable animation variants matching mobile
- Spring configs, easing curves

---

### Phase 2: Authentication & Profile (Week 1-2)

**Goal**: Complete auth flow and user profile management

#### 2.1 Auth Screens
**Already exists but needs styling updates**:
- `/auth/signin` - Update to match mobile split-screen design
- Add Apple Sign In button (web SDK)
- Match exact styling from mobile

#### 2.2 Settings Screen
**File**: `web/app/settings/page.tsx`

Match mobile layout exactly:
- Profile section (avatar, name, email)
- Menu items (Calendar, Contact Us)
- Appearance section (theme switcher)
- Connected Accounts expandable
- Sign out button
- Delete account button

**Components**:
- `ProfileHeader.tsx` (avatar + name + email)
- `MenuRow.tsx` (reusable menu item)
- `ThemeSelector.tsx` (system/light/dark)
- `ConnectedAccountRow.tsx` (collapsible)

#### 2.3 Connected Accounts Screen
**File**: `web/app/connected-accounts/page.tsx`

Features:
- Google account row with status
- Microsoft account row (coming soon)
- Sync buttons
- Disconnect confirmation dialog
- Pull-to-refresh (simulated with button)

---

### Phase 3: Calendar Integration (Week 2-3)

**Goal**: Full-featured calendar matching mobile app

#### 3.1 Calendar Core
**File**: `web/app/calendar/page.tsx`

**Features to implement**:
1. **View Modes**:
   - Day view (hour-by-hour timeline)
   - 3-Day view (compact week view)
   - Agenda view (list of upcoming events)

2. **Header**:
   - Month/Year selector
   - Mini calendar toggle
   - View mode switcher

3. **Mini Calendar**:
   - Month grid with dates
   - Today indicator
   - Selected date highlight
   - Month navigation arrows

4. **Date Strip Scroller**:
   - Horizontal scrollable days
   - Event count dots per day
   - Snap to day on scroll

5. **Timeline**:
   - Hour labels (7 AM - 11 PM)
   - Grid lines
   - Current time indicator (red line)
   - Event blocks with overlap handling

6. **Event Blocks**:
   - Meeting type logo (Meet/Zoom/Teams/Offline)
   - Event title
   - Time range
   - Location
   - Attendees count
   - Join button (if video meeting)
   - Conflict warning badge

7. **Event Details Modal**:
   - Full event info
   - Join meeting button
   - Ask Cortex button
   - Conflict list (if any)

8. **Interactions**:
   - Click hour slot → Create event
   - Click event → Show details
   - Swipe left/right → Navigate days (mouse drag on web)
   - Pull to refresh

#### 3.2 Calendar Components

**File**: `web/components/calendar/CalendarHeader.tsx`
```tsx
export function CalendarHeader({ selectedDate, onDateChange, viewMode, onViewModeChange }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
      <button>← Back</button>
      <button onClick={toggleMiniCalendar}>
        <span>{month} {year}</span>
        <ChevronDown />
      </button>
      <GradientIcon />
    </div>
  );
}
```

**File**: `web/components/calendar/MiniCalendar.tsx`
- Month grid
- Date selection
- Navigation

**File**: `web/components/calendar/DateStripScroller.tsx`
- Horizontal scrollable days
- Event indicators

**File**: `web/components/calendar/Timeline.tsx`
- Hour grid
- Current time indicator
- Event rendering

**File**: `web/components/calendar/EventBlock.tsx`
- Event card with all details
- Meeting type logo
- Join button

**File**: `web/components/calendar/EventModal.tsx`
- Event details sheet
- Action buttons

**File**: `web/components/calendar/FindTimeSheet.tsx`
- AI-powered free slot finder
- Slot suggestions

**File**: `web/components/calendar/QuickAddInput.tsx`
- Natural language event creation
- "Add event..." input
- Parse and create

**File**: `web/components/calendar/ConflictIndicator.tsx`
- Warning badge
- Conflict banner

#### 3.3 Calendar Logic
**File**: `web/lib/calendar/helpers.ts`
- Date formatting
- Event layout calculation (overlap handling)
- Conflict detection
- Time parsing

**File**: `web/hooks/useCalendar.ts`
```tsx
export function useCalendar() {
  // Fetch events for month (cache in Zustand store)
  // Filter events by selected date
  // Detect conflicts
  // Provide navigation functions
  return { events, isLoading, goToDate, refresh };
}
```

**File**: `web/stores/calendarStore.ts`
```typescript
// Zustand store for calendar state
interface CalendarStore {
  events: CalendarEvent[];
  selectedDate: Date;
  viewMode: 'day' | 'week' | 'agenda';
  cachedMonthKey: string;
  setEvents: (events, monthKey) => void;
  // ...
}
```

---

### Phase 4: Chat & Autonomous Actions (Week 3-4)

**Goal**: Complete chat interface with autonomous suggestions

#### 4.1 Chat Screen Enhancement
**File**: `web/app/dashboard/page.tsx` (or rename to `/chat`)

**Current features** (from AddMemoryModal analysis):
- ✅ Chat input
- ✅ Memories section
- ❌ Chat bubbles (need to add)
- ❌ Day briefing scroll (need to add)
- ❌ Insights pills (need to add)
- ❌ Autonomous actions list (need to add)

**New components needed**:

**File**: `web/components/chat/ChatBubble.tsx`
```tsx
export function ChatBubble({ message, isUser }: Props) {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[80%] px-4 py-3 rounded-2xl bg-zinc-800">
        <p className="text-white">{message.content}</p>
      </div>
    </div>
  );
}
```

**File**: `web/components/chat/DayBriefingScroll.tsx`
- Horizontal scrollable cards
- Briefing items (emails, meetings, tasks)
- Tap to expand

**File**: `web/components/chat/InsightsPillRow.tsx`
```tsx
export function InsightsPillRow({ insights }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto">
      <InsightPill icon="mail" count={insights.urgent_emails} label="Urgent" />
      <InsightPill icon="calendar" count={insights.pending_commitments} label="Pending" />
      {/* ... */}
    </div>
  );
}
```

**File**: `web/components/chat/AutonomousActionsList.tsx`
```tsx
export function AutonomousActionsList() {
  const { data: actions } = useAutonomousActions();

  return (
    <div className="space-y-3">
      <h3 className="text-sm text-zinc-400">Actions I Can Handle</h3>
      {actions.map(action => (
        <AutonomousActionCard key={action.id} action={action} />
      ))}
    </div>
  );
}
```

#### 4.2 Autonomous Action Card
**File**: `web/components/autonomous/AutonomousActionCard.tsx`

Match mobile `AutonomousActionCard.tsx`:
- Glassmorphic card
- Service icon (Gmail/Calendar)
- Confidence indicator
- Title + reason
- Editable content preview
- Edit/Dismiss/Approve buttons
- Inline edit mode

**Features**:
- Email reply: Show draft preview, allow editing
- Calendar reschedule: Show new time slot, allow changing
- One-tap approve → Execute action
- Dismiss with reason
- Edit mode with form fields

#### 4.3 Hooks & Services
**File**: `web/hooks/useAutonomousActions.ts`
```tsx
export function useAutonomousActions() {
  return useQuery({
    queryKey: ['autonomousActions'],
    queryFn: () => api.request('/autonomous-actions'),
    refetchInterval: 2 * 60 * 1000, // Refresh every 2 minutes
  });
}
```

**File**: `web/hooks/useChat.ts`
```tsx
export function useChat() {
  const [messages, setMessages] = useState([]);
  const sendMessage = async (content: string) => {
    // Send to /api/chat
    // Stream response
    // Update messages
  };
  return { messages, sendMessage, isLoading };
}
```

---

### Phase 5: Memories & Search (Week 4)

**Goal**: Complete memory management

#### 5.1 Update Add Memory Modal
**Already exists**: `web/components/AddMemoryModal.tsx`

**Enhancements needed**:
- Match mobile glassmorphic styling
- Add file upload tab (functional)
- Add link preview when URL pasted
- Better Gmail connection flow (match mobile OAuth)

#### 5.2 Memories Display
**File**: `web/components/memories/MemoriesList.tsx`
- Grid or list view
- Memory cards with metadata
- Search/filter
- Pagination

**File**: `web/components/memories/MemoryCard.tsx`
- Source icon (note/link/file/email/event)
- Content preview
- Timestamp
- Edit/Delete actions

---

### Phase 6: Integrations & Sync (Week 5)

**Goal**: Complete integration flows

#### 6.1 Gmail Integration UI
**File**: `web/components/integrations/GmailConnection.tsx`
- Connect button
- OAuth popup flow (same as current)
- Sync status
- Last synced timestamp
- Manual sync button
- Disconnect confirmation

#### 6.2 Calendar Integration UI
**Already handled in Calendar screen**

#### 6.3 Sync Status Indicators
**File**: `web/components/integrations/SyncStatusPill.tsx`
```tsx
export function SyncStatusPill({ status }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-800">
      {status === 'syncing' && <Spinner size="sm" />}
      {status === 'connected' && <CheckIcon className="text-green-500" />}
      <span className="text-xs">{label}</span>
    </div>
  );
}
```

---

### Phase 7: Polish & Performance (Week 5-6)

#### 7.1 Loading States
- Skeleton loaders for all screens (matching mobile)
- Shimmer effects
- Loading indicators
- Error states with retry

#### 7.2 Responsive Design
- Desktop layout (max-width with centered content)
- Tablet breakpoints
- Mobile web (match native app exactly)

#### 7.3 Animations
- Framer Motion page transitions
- Spring animations for interactions
- Skeleton shimmer
- Smooth scrolling

#### 7.4 Performance
- React Query for caching
- Optimistic updates
- Prefetching
- Code splitting
- Image optimization

#### 7.5 Accessibility
- Keyboard navigation
- ARIA labels
- Focus management
- Screen reader support

---

## 5. File Structure

### Web App (`apps/web/`)

```
web/
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Landing page
│   ├── auth/
│   │   └── signin/
│   │       └── page.tsx              # Sign-in (split-screen design)
│   ├── dashboard/                    # OR rename to /chat
│   │   └── page.tsx                  # Main chat screen
│   ├── calendar/
│   │   └── page.tsx                  # Calendar screen
│   ├── settings/
│   │   └── page.tsx                  # Settings screen
│   ├── connected-accounts/
│   │   └── page.tsx                  # Account management
│   └── globals.css                   # Tailwind + custom styles
├── components/
│   ├── ui/                           # Base components
│   │   ├── Button.tsx
│   │   ├── GlassCard.tsx
│   │   ├── GlassContainer.tsx
│   │   ├── IconButton.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   ├── Sheet.tsx
│   │   ├── Skeleton.tsx
│   │   ├── Spinner.tsx
│   │   └── Switch.tsx
│   ├── icons/                        # Icon wrappers
│   │   └── index.tsx
│   ├── auth/
│   │   ├── GoogleSignInButton.tsx
│   │   └── AppleSignInButton.tsx
│   ├── chat/
│   │   ├── ChatBubble.tsx
│   │   ├── ChatInput.tsx
│   │   ├── DayBriefingScroll.tsx
│   │   ├── InsightsPillRow.tsx
│   │   └── LoadingBubble.tsx
│   ├── calendar/
│   │   ├── CalendarHeader.tsx
│   │   ├── MiniCalendar.tsx
│   │   ├── DateStripScroller.tsx
│   │   ├── Timeline.tsx
│   │   ├── EventBlock.tsx
│   │   ├── EventModal.tsx
│   │   ├── FindTimeSheet.tsx
│   │   ├── QuickAddInput.tsx
│   │   ├── ConflictIndicator.tsx
│   │   └── CalendarSkeleton.tsx
│   ├── autonomous/
│   │   ├── AutonomousActionCard.tsx
│   │   └── AutonomousActionsList.tsx
│   ├── memories/
│   │   ├── MemoriesList.tsx
│   │   ├── MemoryCard.tsx
│   │   └── AddMemoryModal.tsx        # Already exists
│   ├── integrations/
│   │   ├── GmailConnection.tsx
│   │   ├── CalendarConnection.tsx
│   │   └── SyncStatusPill.tsx
│   ├── settings/
│   │   ├── ProfileHeader.tsx
│   │   ├── MenuRow.tsx
│   │   ├── ThemeSelector.tsx
│   │   └── ConnectedAccountRow.tsx
│   ├── UserMenu.tsx                  # Already exists
│   └── index.ts                      # Barrel export
├── lib/
│   ├── theme/
│   │   ├── colors.ts                 # Copy from mobile
│   │   ├── spacing.ts                # Copy from mobile
│   │   ├── typography.ts             # Copy from mobile
│   │   └── ThemeProvider.tsx         # Theme context
│   ├── calendar/
│   │   ├── helpers.ts
│   │   └── conflictDetection.ts
│   ├── api/
│   │   └── client.ts                 # Already exists
│   └── utils.ts
├── hooks/
│   ├── useMemories.ts                # Already exists
│   ├── useSearch.ts                  # Already exists
│   ├── useCalendar.ts                # NEW
│   ├── useAutonomousActions.ts       # NEW
│   ├── useChat.ts                    # NEW
│   └── useTheme.ts                   # NEW
├── stores/
│   ├── authStore.ts                  # Already exists (Zustand)
│   ├── calendarStore.ts              # NEW
│   └── chatStore.ts                  # NEW
├── types/
│   ├── memory.ts                     # Already exists
│   ├── calendar.ts                   # NEW
│   ├── chat.ts                       # NEW
│   └── autonomousAction.ts           # NEW
└── tailwind.config.ts                # Update with theme tokens
```

---

## 6. Supermemory-Inspired Features (From Screenshots)

Based on the 10 screenshots provided, these additional features should be considered:

### 6.1 Profile Settings Page
- User info section
- Organization (if applicable)
- Plan info (Free/Pro)
- Memory count (e.g., "1 / 200 memories")
- Upgrade button

### 6.2 Integrations Page
Similar to Settings → Connected Accounts but with more options:
- **Productivity Tools**:
  - Apple Shortcuts
  - Raycast Extension
  - Chrome Extension
- **Cloud Storage Connections**:
  - Google Drive
  - Notion
  - OneDrive
- Each with project selector dropdown

### 6.3 Billing Page
- Current plan display
- Memory usage bar
- Upgrade options
- Feature comparison table
- Subscription management

### 6.4 Support Page
- **Contact Options**:
  - Message on X (Twitter)
  - Email support
- **FAQ Section**:
  - Common questions
  - Documentation links

### 6.5 Add Memory Modal (Enhanced)
**Already implemented** but match Supermemory styling:
- Note tab (textarea)
- Link tab (URL input with preview)
- File tab (upload area)
- Connect tab (triggers Gmail OAuth)

**Implementation Note**: The current web app has this modal but needs visual polish to match Supermemory's glassmorphic design.

---

## 7. Technology Stack Alignment

### Mobile (Existing)
- React Native (Expo)
- TypeScript
- Zustand (state management)
- React Query (data fetching)
- Reanimated + Gesture Handler (animations)
- Ionicons
- PostHog (analytics)

### Web (Target)
- Next.js 15 (App Router, static export)
- TypeScript
- Tailwind CSS (with theme tokens from mobile)
- Zustand (state management)
- React Query (data fetching)
- Framer Motion (animations)
- react-icons/io5 (Ionicons equivalent)
- PostHog (analytics)

---

## 8. Backend API Requirements

All features require these backend endpoints (already exist or need to be added):

### Authentication
- ✅ `POST /auth/google` - Google Sign In
- ✅ `POST /auth/apple` - Apple Sign In
- ✅ `POST /auth/refresh` - Refresh token
- ✅ `GET /auth/me` - Get current user
- ❌ `DELETE /auth/account` - Delete account (add to backend)

### Memories
- ✅ `GET /api/memories` - List memories
- ✅ `POST /api/memories` - Create memory
- ✅ `PATCH /api/memories/:id` - Update memory
- ✅ `DELETE /api/memories/:id` - Delete memory
- ✅ `POST /api/search` - Search memories
- ✅ `POST /api/chat` - Chat with memories

### Integrations
- ✅ `GET /integrations/status` - Get connection status
- ✅ `POST /integrations/gmail/connect` - Connect Gmail
- ✅ `POST /integrations/calendar/connect` - Connect Calendar
- ✅ `POST /integrations/gmail/sync` - Trigger Gmail sync
- ✅ `POST /integrations/calendar/sync` - Trigger Calendar sync
- ✅ `DELETE /integrations/:provider` - Disconnect integration

### Calendar
- ❌ `GET /api/calendar/events` - Get events (add)
- ❌ `POST /api/calendar/events` - Create event (add)
- ❌ `PUT /api/calendar/events/:id` - Update event (add)
- ❌ `DELETE /api/calendar/events/:id` - Delete event (add)
- ❌ `POST /api/calendar/find-time` - AI find free slots (add)
- ❌ `POST /api/calendar/parse-event` - Parse natural language (add)

### Autonomous Actions
- ❌ `GET /api/autonomous-actions` - Get pending actions (add)
- ❌ `POST /api/autonomous-actions/generate` - Generate new actions (add)
- ❌ `POST /api/autonomous-actions/:id/approve` - Approve action (add)
- ❌ `POST /api/autonomous-actions/:id/dismiss` - Dismiss action (add)

### Chat
- ✅ `POST /api/chat` - Send message (exists)
- ❌ `GET /api/chat/history` - Get chat history (add)
- ❌ `GET /api/chat/briefing` - Get day briefing (add if not exists)
- ❌ `GET /api/chat/insights` - Get insights (add if not exists)

---

## 9. Implementation Priorities

### P0 - Must Have (MVP)
1. ✅ Design system setup (colors, spacing, components)
2. ✅ Settings screen (theme, accounts)
3. ⚠️ Calendar integration (full feature parity with mobile)
4. ⚠️ Chat screen enhancements (bubbles, briefing, insights)
5. ⚠️ Autonomous actions (email/calendar suggestions)

### P1 - Should Have
6. Gmail sync UI improvements
7. Memory management enhancements
8. Profile settings page
9. Support page
10. Loading states & animations

### P2 - Nice to Have
11. Billing page (if monetizing)
12. Advanced integrations (Drive, Notion, etc.)
13. Keyboard shortcuts
14. Advanced accessibility
15. Offline support

---

## 10. Testing Strategy

### Unit Tests
- Component tests (React Testing Library)
- Hook tests
- Utility function tests
- Store tests

### Integration Tests
- API client tests
- Auth flow tests
- Calendar sync tests
- Autonomous action flow tests

### E2E Tests
- Critical user flows (Playwright)
  - Sign in → Connect Gmail → View calendar
  - Create memory → Search → Chat
  - Approve autonomous action

### Visual Regression
- Percy or Chromatic
- Ensure web matches mobile designs

---

## 11. Deployment Strategy

### Web App
- ✅ Cloudflare Pages (already deployed)
- Subdomain: `app.askcortex.plutas.in`
- Build: `npm run build` (static export)
- Environment variables:
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
  - `NEXT_PUBLIC_APPLE_CLIENT_ID`
  - `NEXT_PUBLIC_POSTHOG_KEY`

### Backend
- ✅ Cloudflare Workers (already deployed)
- Subdomain: `askcortex.plutas.in`
- CORS: Allow `app.askcortex.plutas.in`

---

## 12. Timeline Estimate

### Week 1: Foundation
- Design system setup
- Base components library
- Icon system
- Theme provider
- Auth screen styling update

### Week 2: Settings & Accounts
- Settings screen
- Connected accounts screen
- Profile management
- Theme switcher
- OAuth flow improvements

### Week 3: Calendar (Part 1)
- Calendar header
- Mini calendar
- Date strip scroller
- Timeline with events
- Event blocks rendering

### Week 4: Calendar (Part 2) + Chat
- Find time sheet
- Quick add input
- Conflict detection
- Event modal
- Chat bubbles
- Day briefing
- Insights pills

### Week 5: Autonomous Actions + Integrations
- Autonomous action cards
- Email reply suggestions
- Calendar reschedule suggestions
- Gmail sync UI
- Calendar sync UI
- Sync status indicators

### Week 6: Polish & Testing
- Loading states
- Animations
- Performance optimizations
- Accessibility
- Bug fixes
- E2E tests

---

## 13. Success Criteria

✅ **Visual Parity**: Web app looks identical to mobile app (same colors, spacing, layout)

✅ **Feature Parity**: Web app has all features from mobile app

✅ **Performance**: Web app loads in < 2s, interactions feel instant

✅ **Responsive**: Works on desktop (1920px), tablet (768px), mobile (375px)

✅ **Cross-browser**: Works on Chrome, Safari, Firefox, Edge

✅ **Accessible**: Passes WCAG 2.1 AA standards

---

## 14. Next Steps

1. **Review & Approve**: User reviews this plan
2. **Setup Phase 1**: Create design system
3. **Implement iteratively**: Build one screen at a time
4. **Test continuously**: Unit + integration tests
5. **Deploy incrementally**: Deploy features as they're completed
6. **Gather feedback**: User testing, iterate

---

## 15. Questions for User

Before starting implementation, clarify:

1. **Billing**: Do you want to implement billing/subscription features now or later?
2. **Analytics**: Confirm PostHog integration for web?
3. **Advanced Integrations**: Priority for Drive/Notion/OneDrive connections?
4. **Mobile Web**: Should mobile web redirect to iOS app or work standalone?
5. **PWA**: Do you want Progressive Web App features (install, offline)?
6. **Notifications**: Web push notifications?
7. **Multi-language**: i18n support needed?

---

**End of Implementation Plan**

This plan provides a complete roadmap to build the Cortex web app with identical features and UI styling as the iOS mobile app. All screens, components, and features are documented with file paths, code examples, and implementation details.
