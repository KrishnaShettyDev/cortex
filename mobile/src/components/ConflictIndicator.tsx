import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../theme';

interface ConflictIndicatorProps {
  size?: 'small' | 'medium' | 'large';
  count?: number;
  showLabel?: boolean;
}

// Conflict warning color (amber/orange)
export const CONFLICT_COLOR = '#F59E0B';
export const CONFLICT_BG_COLOR = 'rgba(245, 158, 11, 0.15)';
export const CONFLICT_BORDER_COLOR = '#F59E0B';

const ICON_SIZES = {
  small: 12,
  medium: 16,
  large: 20,
};

const CONTAINER_SIZES = {
  small: 16,
  medium: 22,
  large: 28,
};

export const ConflictIndicator: React.FC<ConflictIndicatorProps> = ({
  size = 'small',
  count,
  showLabel = false,
}) => {
  const iconSize = ICON_SIZES[size];
  const containerSize = CONTAINER_SIZES[size];

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.container,
          {
            width: containerSize,
            height: containerSize,
            borderRadius: containerSize / 2,
          },
        ]}
      >
        <Ionicons name="warning" size={iconSize} color={CONFLICT_COLOR} />
        {count && count > 1 && size !== 'small' && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )}
      </View>
      {showLabel && (
        <Text style={styles.label}>Conflict</Text>
      )}
    </View>
  );
};

interface ConflictBannerProps {
  conflictCount: number;
  onPress?: () => void;
}

export const ConflictBanner: React.FC<ConflictBannerProps> = ({
  conflictCount,
  onPress,
}) => {
  return (
    <View style={styles.banner}>
      <Ionicons name="warning" size={16} color={CONFLICT_COLOR} />
      <Text style={styles.bannerText}>
        {conflictCount === 1
          ? 'This event overlaps with another event'
          : `This event overlaps with ${conflictCount} other events`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  container: {
    backgroundColor: CONFLICT_BG_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: CONFLICT_COLOR,
    borderRadius: 8,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    color: CONFLICT_COLOR,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: CONFLICT_BG_COLOR,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: CONFLICT_BORDER_COLOR,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: CONFLICT_COLOR,
    fontWeight: '500',
  },
});

export default ConflictIndicator;
