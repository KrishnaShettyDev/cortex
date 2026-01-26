/**
 * ActionSuggestionPill - Simple tappable action suggestion
 *
 * Clean, minimal pill showing service icons + action text.
 * Tapping opens the action review modal.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AutonomousAction } from '../types';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { colors, spacing, borderRadius } from '../theme';

interface ActionSuggestionPillProps {
  action: AutonomousAction;
  onPress: (action: AutonomousAction) => void;
}

export function ActionSuggestionPill({ action, onPress }: ActionSuggestionPillProps) {
  // Get icons based on action type
  const renderIcons = () => {
    const icons: React.ReactNode[] = [];

    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        // Email actions show Gmail icon
        if (action.source_type === 'calendar' || action.action_type === 'followup') {
          icons.push(<GoogleCalendarIcon key="cal" size={18} />);
        }
        icons.push(<GmailIcon key="gmail" size={18} />);
        break;
      case 'calendar_create':
      case 'calendar_reschedule':
      case 'meeting_prep':
        // Calendar actions show Calendar icon
        icons.push(<GoogleCalendarIcon key="cal" size={18} />);
        if (action.source_type === 'email') {
          icons.push(<GmailIcon key="gmail" size={18} />);
        }
        break;
      default:
        icons.push(<GoogleCalendarIcon key="cal" size={18} />);
    }

    return icons;
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(action)}
      activeOpacity={0.7}
    >
      <View style={styles.iconRow}>
        {renderIcons()}
      </View>
      <Text style={styles.text} numberOfLines={2}>
        {action.title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  text: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 20,
  },
});
