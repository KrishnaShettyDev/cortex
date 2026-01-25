/**
 * ThinkingIndicator - Claude-style animated status
 *
 * Shows immediately when processing starts. Single line that
 * smoothly updates as different actions happen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../theme';

interface ThinkingIndicatorProps {
  /** Current status message to display */
  status?: string;
  /** Tool being executed */
  tool?: string;
  /** Whether actively processing */
  isActive: boolean;
}

// Map tool names to icons
const TOOL_ICONS: Record<string, string> = {
  // Email tools
  summarize_unread_emails: 'mail',
  search_emails: 'mail',
  get_email_thread: 'mail',
  send_email: 'send',
  reply_to_email: 'return-down-back',
  get_awaiting_replies: 'mail-unread',
  draft_email_reply: 'create',
  analyze_my_writing_style: 'text',

  // Calendar tools
  find_free_time: 'calendar',
  create_calendar_event: 'calendar',
  update_calendar_event: 'calendar',
  delete_calendar_event: 'calendar',
  detect_conflicts: 'warning',
  get_day_summary: 'today',
  reorganize_schedule: 'swap-horizontal',
  block_focus_time: 'time',

  // Places
  search_places: 'location',

  // Tasks & Reminders
  create_reminder: 'alarm',
  list_reminders: 'list',
  list_tasks: 'checkbox',

  // Memory
  searching_memories: 'search',
};

export function ThinkingIndicator({ status, tool, isActive }: ThinkingIndicatorProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const dotAnims = [
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
  ];
  const [displayStatus, setDisplayStatus] = useState(status || 'Thinking');

  // Fade in on mount
  useEffect(() => {
    if (isActive) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [isActive]);

  // Animate dots
  useEffect(() => {
    if (!isActive) return;

    const animations = dotAnims.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 150),
          Animated.timing(dot, {
            toValue: 1,
            duration: 300,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 300,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
        ])
      )
    );

    animations.forEach(anim => anim.start());

    return () => {
      animations.forEach(anim => anim.stop());
    };
  }, [isActive]);

  // Smoothly transition status text
  useEffect(() => {
    if (status && status !== displayStatus) {
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
      setDisplayStatus(status);
    }
  }, [status]);

  if (!isActive) return null;

  // Get icon - only show for tools, not for "Thinking"
  const icon = tool ? TOOL_ICONS[tool] : null;
  const showIcon = icon && status !== 'Thinking';

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <BlurView intensity={20} tint="dark" style={styles.blur}>
        <View style={styles.content}>
          {showIcon && (
            <Ionicons
              name={`${icon}-outline` as any}
              size={12}
              color={colors.accent}
            />
          )}
          <Animated.Text style={[styles.text, { opacity: pulseAnim }]}>
            {displayStatus}
          </Animated.Text>
          <View style={styles.dots}>
            {dotAnims.map((dot, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  { opacity: dot }
                ]}
              />
            ))}
          </View>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  blur: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  text: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  dots: {
    flexDirection: 'row',
    gap: 2,
    marginLeft: 1,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.accent,
  },
});
