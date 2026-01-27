/**
 * ActionSuggestionPill - iOS-style action suggestion
 *
 * Clean, minimal tappable row with service icon and action text.
 * Tapping opens the action review modal.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AutonomousAction } from '../types';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { colors, spacing, borderRadius, useTheme } from '../theme';

interface ActionSuggestionPillProps {
  action: AutonomousAction;
  onPress: (action: AutonomousAction) => void;
}

export function ActionSuggestionPill({ action, onPress }: ActionSuggestionPillProps) {
  const { colors } = useTheme();

  // Get icons based on action type
  const renderIcons = () => {
    const icons: React.ReactNode[] = [];

    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        if (action.source_type === 'calendar' || action.action_type === 'followup') {
          icons.push(<GoogleCalendarIcon key="cal" size={16} />);
        }
        icons.push(<GmailIcon key="gmail" size={16} />);
        break;
      case 'calendar_create':
      case 'calendar_reschedule':
      case 'meeting_prep':
        icons.push(<GoogleCalendarIcon key="cal" size={16} />);
        if (action.source_type === 'email') {
          icons.push(<GmailIcon key="gmail" size={16} />);
        }
        break;
      default:
        icons.push(<GoogleCalendarIcon key="cal" size={16} />);
    }

    return icons;
  };

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.fill }]}
      onPress={() => onPress(action)}
      activeOpacity={0.6}
    >
      {/* Service icons */}
      <View style={styles.iconRow}>
        {renderIcons()}
      </View>

      {/* Action text */}
      <Text style={[styles.text, { color: colors.textPrimary }]} numberOfLines={2}>
        {action.title}
      </Text>

      {/* Chevron indicator */}
      <Ionicons
        name="chevron-forward"
        size={16}
        color={colors.textQuaternary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    minHeight: 52,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  text: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
    letterSpacing: -0.24,
  },
});
