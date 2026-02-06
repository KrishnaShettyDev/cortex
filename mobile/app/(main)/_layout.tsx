/**
 * Main App Layout - Chat-First Architecture
 *
 * Screens:
 * - chat: Primary interface (everything flows through here)
 * - settings: Account, theme, integrations (minimal)
 * - add-memory: Quick context capture
 * - calendar: View-only calendar (actions via chat)
 */

import { Stack } from 'expo-router';
import { colors } from '../../src/theme';
import { useAnalytics } from '../../src/hooks/useAnalytics';

export default function MainLayout() {
  useAnalytics();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}
    >
      {/* Primary: Chat */}
      <Stack.Screen name="chat" />

      {/* Settings Modal */}
      <Stack.Screen
        name="settings"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />

      {/* Add Memory Modal */}
      <Stack.Screen
        name="add-memory"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />

      {/* Calendar Modal */}
      <Stack.Screen
        name="calendar"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
