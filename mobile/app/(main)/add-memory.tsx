import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { memoryService } from '../../src/services';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';
import { spacing, borderRadius, useTheme } from '../../src/theme';

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/chat');
  }
};

// Animated components
const AnimatedView = Reanimated.createAnimatedComponent(View);

export default function AddMemoryScreen() {
  const posthog = usePostHog();
  const { colors: themeColors } = useTheme();
  const [memoryText, setMemoryText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Input focus animation
  const inputFocused = useSharedValue(0);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 400);
  }, []);

  const handleSave = useCallback(async () => {
    if (!memoryText.trim()) {
      return;
    }

    // Dismiss keyboard immediately
    Keyboard.dismiss();
    setIsLoading(true);

    try {
      await memoryService.createMemory({
        content: memoryText,
        memory_type: 'text',
      });

      posthog?.capture(ANALYTICS_EVENTS.TEXT_MEMORY_CREATED, {
        content_length: memoryText.length,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      goBack();
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', error.message || 'Failed to save. Please try again.');
      setIsLoading(false);
    }
  }, [memoryText, posthog]);

  const canSave = memoryText.trim().length > 0;

  const inputContainerAnimatedStyle = useAnimatedStyle(() => ({
    borderColor: inputFocused.value
      ? themeColors.accent
      : themeColors.glassBorder,
  }));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors.bgPrimary }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={[styles.closeButton, { backgroundColor: themeColors.bgSecondary }]}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={24} color={themeColors.textSecondary} />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: themeColors.textPrimary }]}>Add Context</Text>

        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.content}>
          {/* Main Input */}
          <AnimatedView style={[styles.inputCard, { backgroundColor: themeColors.bgSecondary }, inputContainerAnimatedStyle]}>
            <TextInput
              ref={inputRef}
              style={[styles.textInput, { color: themeColors.textPrimary }]}
              placeholder="What should Cortex remember?\n\ne.g., My favorite coffee shop is Blue Bottle on Market Street..."
              placeholderTextColor={themeColors.textTertiary}
              value={memoryText}
              onChangeText={setMemoryText}
              multiline
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit={true}
              onSubmitEditing={handleSave}
              onFocus={() => {
                inputFocused.value = withTiming(1, { duration: 200 });
              }}
              onBlur={() => {
                inputFocused.value = withTiming(0, { duration: 200 });
              }}
            />

            {memoryText.length > 0 && (
              <View style={styles.charCount}>
                <Text style={[styles.charCountText, { color: themeColors.textTertiary }]}>{memoryText.length}</Text>
              </View>
            )}
          </AnimatedView>

          {/* Helper Text */}
          <Text style={[styles.helperText, { color: themeColors.textTertiary }]}>
            Add personal context to make Cortex more helpful. This could be preferences,
            important dates, relationships, or anything you want remembered.
          </Text>
        </View>

        {/* Bottom Action Bar */}
        <View style={styles.bottomBar}>
          {/* Save Button */}
          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: canSave ? themeColors.accent : themeColors.bgTertiary }
            ]}
            onPress={handleSave}
            disabled={!canSave || isLoading}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.saveButtonText,
              !canSave && { color: themeColors.textTertiary },
            ]}>
              {isLoading ? 'Saving...' : 'Save Context'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },

  // Input Card
  inputCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    minHeight: 200,
    position: 'relative',
  },
  textInput: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    fontSize: 17,
    lineHeight: 24,
    flex: 1,
    letterSpacing: -0.41,
  },
  charCount: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.md,
  },
  charCountText: {
    fontSize: 12,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },

  // Bottom Bar
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  saveButton: {
    borderRadius: borderRadius.full,
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.41,
  },
});
