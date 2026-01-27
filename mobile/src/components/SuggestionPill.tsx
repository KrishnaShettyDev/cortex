import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing, useTheme } from '../theme';
import type { ServiceIcon } from '../types';

interface SuggestionPillProps {
  text: string;
  onPress: () => void;
  services?: ServiceIcon;
}

// Service icon URLs - Official brand icons from CDNs
const SERVICE_ICONS: Record<string, string> = {
  // Google services
  gmail: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png',
  calendar: 'https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png',
  drive: 'https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png',
  docs: 'https://www.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png',
  sheets: 'https://www.gstatic.com/images/branding/product/2x/sheets_2020q4_48dp.png',
  slides: 'https://www.gstatic.com/images/branding/product/2x/slides_2020q4_48dp.png',
  maps: 'https://www.gstatic.com/images/branding/product/2x/maps_2020q4_48dp.png',

  // Microsoft services
  outlook: 'https://img.icons8.com/fluency/96/microsoft-outlook-2019.png',
  teams: 'https://img.icons8.com/fluency/96/microsoft-teams-2019.png',

  // Collaboration & Project Management
  slack: 'https://img.icons8.com/color/96/slack-new.png',
  notion: 'https://img.icons8.com/color/96/notion--v1.png',
  linear: 'https://img.icons8.com/color/96/linear.png',
  jira: 'https://img.icons8.com/color/96/jira.png',
  asana: 'https://img.icons8.com/color/96/asana.png',
  trello: 'https://img.icons8.com/color/96/trello.png',
  github: 'https://img.icons8.com/ios-filled/100/github.png',

  // Communication
  discord: 'https://img.icons8.com/color/96/discord-logo.png',
  telegram: 'https://img.icons8.com/color/96/telegram-app--v1.png',
  whatsapp: 'https://img.icons8.com/color/96/whatsapp--v1.png',

  // Other
  spotify: 'https://img.icons8.com/color/96/spotify--v1.png',
};

// Service icon component that renders the appropriate icon
function ServiceIconBadge({ service }: { service: string }) {
  const iconUrl = SERVICE_ICONS[service];

  if (!iconUrl) {
    return null;
  }

  return (
    <Image
      source={{ uri: iconUrl }}
      style={pillStyles.iconImage}
    />
  );
}

const pillStyles = StyleSheet.create({
  iconImage: {
    width: 18,
    height: 18,
    borderRadius: 3,
  },
});

export function SuggestionPill({ text, onPress, services = 'none' }: SuggestionPillProps) {
  const { colors: themeColors } = useTheme();

  const renderServiceIcons = () => {
    // Handle special cases
    if (services === 'none') {
      return null;
    }

    if (services === 'note') {
      return (
        <View style={styles.iconsContainer}>
          <View style={styles.noteIcon}>
            <Ionicons name="document-text" size={12} color={themeColors.textSecondary} />
          </View>
        </View>
      );
    }

    // Handle combined services (e.g., 'gmail-calendar')
    if (services.includes('-')) {
      const serviceList = services.split('-');
      return (
        <View style={styles.iconsContainer}>
          {serviceList.map((service) => (
            <ServiceIconBadge key={service} service={service} />
          ))}
        </View>
      );
    }

    // Single service icon
    if (SERVICE_ICONS[services]) {
      return (
        <View style={styles.iconsContainer}>
          <ServiceIconBadge service={services} />
        </View>
      );
    }

    return null;
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.touchable}>
      <View style={[
        styles.container,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder }
      ]}>
        {renderServiceIcons()}
        <Text style={[styles.text, { color: themeColors.textPrimary }]} numberOfLines={2}>{text}</Text>
      </View>
    </TouchableOpacity>
  );
}

// Suggest actions button component (like Iris)
interface SuggestActionsButtonProps {
  onPress: () => void;
}

export function SuggestActionsButton({ onPress }: SuggestActionsButtonProps) {
  const { colors: themeColors } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.suggestButton,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder }
      ]}
    >
      <Ionicons name="bulb-outline" size={14} color={themeColors.textSecondary} />
      <Text style={[styles.suggestButtonText, { color: themeColors.textSecondary }]}>Suggest actions</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    gap: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  iconsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  noteIcon: {
    width: 16,
    height: 16,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 18,
  },
  // Suggest actions button styles
  suggestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm - 2,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  suggestButtonText: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
  },
});
