import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { memoryService, speechService, api } from '../../src/services';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';
import { colors, gradients, spacing, borderRadius } from '../../src/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/chat');
  }
};

// Animated components
const AnimatedView = Reanimated.createAnimatedComponent(View);
const AnimatedTouchable = Reanimated.createAnimatedComponent(TouchableOpacity);

// Attachment button component
const AttachmentButton: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  isActive?: boolean;
  activeColor?: string;
}> = ({ icon, label, onPress, disabled, isActive, activeColor }) => {
  const scale = useSharedValue(1);

  const handlePressIn = () => {
    scale.value = withSpring(0.92, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedTouchable
      style={[
        styles.attachmentButton,
        isActive && { backgroundColor: activeColor ? `${activeColor}20` : colors.accent + '20' },
        disabled && styles.attachmentButtonDisabled,
        animatedStyle,
      ]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <View style={[
        styles.attachmentIconContainer,
        isActive && { backgroundColor: activeColor || colors.accent },
      ]}>
        <Ionicons
          name={icon}
          size={20}
          color={isActive ? '#fff' : colors.textSecondary}
        />
      </View>
      <Text style={[
        styles.attachmentLabel,
        isActive && { color: activeColor || colors.accent },
      ]}>
        {label}
      </Text>
    </AnimatedTouchable>
  );
};

// Recording waveform visualization
const RecordingWaveform: React.FC<{ isRecording: boolean }> = ({ isRecording }) => {
  const bars = [
    useSharedValue(0.3),
    useSharedValue(0.5),
    useSharedValue(0.4),
    useSharedValue(0.6),
    useSharedValue(0.3),
  ];

  useEffect(() => {
    if (isRecording) {
      bars.forEach((bar, index) => {
        bar.value = withRepeat(
          withSequence(
            withTiming(0.2 + Math.random() * 0.6, { duration: 200 + index * 50 }),
            withTiming(0.4 + Math.random() * 0.4, { duration: 200 + index * 50 })
          ),
          -1,
          true
        );
      });
    } else {
      bars.forEach((bar) => {
        bar.value = withTiming(0.3, { duration: 200 });
      });
    }
  }, [isRecording]);

  return (
    <View style={styles.waveformContainer}>
      {bars.map((bar, index) => {
        const animatedStyle = useAnimatedStyle(() => ({
          height: interpolate(bar.value, [0, 1], [8, 24], Extrapolation.CLAMP),
        }));

        return (
          <AnimatedView
            key={index}
            style={[styles.waveformBar, animatedStyle]}
          />
        );
      })}
    </View>
  );
};

export default function AddMemoryScreen() {
  const posthog = usePostHog();
  const [memoryText, setMemoryText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animations
  const saveButtonScale = useSharedValue(1);
  const inputFocused = useSharedValue(0);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 400);
  }, []);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    } else {
      setRecordingDuration(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  }, [isRecording]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSave = useCallback(async () => {
    if (!memoryText.trim() && !selectedImage) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Add Context', 'Please write something or add a photo.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading(true);

    // Animate save button
    saveButtonScale.value = withSequence(
      withSpring(0.8, { damping: 10 }),
      withSpring(1, { damping: 10 })
    );

    try {
      if (selectedImage) {
        const photoUrl = await api.uploadPhoto(selectedImage);
        await memoryService.createMemory({
          content: memoryText.trim() || 'Photo memory',
          memory_type: 'photo',
          photo_url: photoUrl,
        });

        posthog?.capture(ANALYTICS_EVENTS.PHOTO_MEMORY_CREATED, {
          caption_length: memoryText.length,
        });
      } else {
        await memoryService.createMemory({
          content: memoryText,
          memory_type: 'text',
        });

        posthog?.capture(ANALYTICS_EVENTS.TEXT_MEMORY_CREATED, {
          content_length: memoryText.length,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      goBack();
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', error.message || 'Failed to save. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [memoryText, selectedImage, posthog]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      setIsRecording(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await speechService.stopRecording();

      if (result && result.uri) {
        setIsLoading(true);

        try {
          const uploadResult = await api.uploadAudioWithTranscription(result.uri);
          const transcription = uploadResult.transcription?.trim();

          let content = memoryText.trim();
          if (transcription) {
            content = content
              ? `${transcription}\n\n[Note: ${content}]`
              : transcription;
          }

          if (!content) {
            content = '[Voice memo]';
          }

          await memoryService.createMemory({
            content,
            memory_type: 'voice',
            audio_url: uploadResult.url,
          });

          posthog?.capture(ANALYTICS_EVENTS.VOICE_MEMORY_CREATED, {
            has_transcription: !!transcription,
            has_note: !!memoryText.trim(),
          });

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          goBack();
        } catch (error: any) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert('Error', 'Failed to process voice memo.');
        } finally {
          setIsLoading(false);
        }
      }
    } else {
      const started = await speechService.startRecording();
      if (started) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setIsRecording(true);
        setSelectedImage(null);
      } else {
        Alert.alert(
          'Microphone Access',
          'Please enable microphone access in Settings.',
          [{ text: 'OK' }]
        );
      }
    }
  }, [isRecording, memoryText, posthog]);

  const handleTakePhoto = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Access', 'Please enable camera access in Settings.');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setSelectedImage(result.assets[0].uri);
      }
    } catch (error: any) {
      if (error.message?.includes('Camera not available')) {
        Alert.alert('Camera Unavailable', 'Camera is not available on this device.');
      }
    }
  }, []);

  const handlePickPhoto = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo Library', 'Please enable photo library access in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
    }
  }, []);

  const clearImage = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedImage(null);
  }, []);

  const canSave = memoryText.trim().length > 0 || selectedImage;

  const saveButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: saveButtonScale.value }],
  }));

  const inputContainerAnimatedStyle = useAnimatedStyle(() => ({
    borderColor: inputFocused.value
      ? colors.accent
      : colors.glassBorder,
  }));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.closeButton}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Add Context</Text>

        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.content}>
          {/* Recording State */}
          {isRecording && (
            <AnimatedView
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(200)}
              style={styles.recordingCard}
            >
              <View style={styles.recordingHeader}>
                <View style={styles.recordingLive}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingLiveText}>RECORDING</Text>
                </View>
                <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
              </View>

              <RecordingWaveform isRecording={isRecording} />

              <Text style={styles.recordingHint}>
                Tap the mic button again to stop and save
              </Text>
            </AnimatedView>
          )}

          {/* Image Preview */}
          {selectedImage && !isRecording && (
            <View style={styles.imageCard}>
              <Image source={{ uri: selectedImage }} style={styles.imagePreview} />
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.7)']}
                style={styles.imageOverlay}
              />
              <TouchableOpacity
                style={styles.removeImageButton}
                onPress={clearImage}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Main Input */}
          {!isRecording && (
            <AnimatedView style={[styles.inputCard, inputContainerAnimatedStyle]}>
              <TextInput
                ref={inputRef}
                style={styles.textInput}
                placeholder={selectedImage
                  ? "Add a caption for this photo..."
                  : "What should Cortex remember?\n\ne.g., My favorite coffee shop is Blue Bottle on Market Street..."
                }
                placeholderTextColor={colors.textTertiary}
                value={memoryText}
                onChangeText={setMemoryText}
                multiline
                textAlignVertical="top"
                onFocus={() => {
                  inputFocused.value = withTiming(1, { duration: 200 });
                }}
                onBlur={() => {
                  inputFocused.value = withTiming(0, { duration: 200 });
                }}
              />

              {memoryText.length > 0 && (
                <View style={styles.charCount}>
                  <Text style={styles.charCountText}>{memoryText.length}</Text>
                </View>
              )}
            </AnimatedView>
          )}

          {/* Helper Text */}
          {!isRecording && !selectedImage && (
            <Text style={styles.helperText}>
              Add personal context to make Cortex more helpful. This could be preferences,
              important dates, relationships, or anything you want remembered.
            </Text>
          )}
        </View>

        {/* Bottom Action Bar */}
        <View style={styles.bottomBar}>
          <View style={styles.attachmentRow}>
            <AttachmentButton
              icon={isRecording ? 'stop' : 'mic-outline'}
              label={isRecording ? 'Stop' : 'Voice'}
              onPress={toggleRecording}
              disabled={isLoading || !!selectedImage}
              isActive={isRecording}
              activeColor={colors.error}
            />

            <AttachmentButton
              icon="camera-outline"
              label="Camera"
              onPress={handleTakePhoto}
              disabled={isLoading || isRecording}
            />

            <AttachmentButton
              icon="images-outline"
              label="Photos"
              onPress={handlePickPhoto}
              disabled={isLoading || isRecording}
            />
          </View>

          {/* Save Button */}
          {!isRecording && (
            <AnimatedTouchable
              style={[styles.saveButton, saveButtonAnimatedStyle]}
              onPress={handleSave}
              disabled={!canSave || isLoading}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={canSave ? gradients.primary : [colors.bgTertiary, colors.bgTertiary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.saveButtonGradient}
              >
                {isLoading ? (
                  <View style={styles.loadingDots}>
                    <View style={styles.loadingDot} />
                    <View style={[styles.loadingDot, { opacity: 0.7 }]} />
                    <View style={[styles.loadingDot, { opacity: 0.4 }]} />
                  </View>
                ) : (
                  <>
                    <Text style={[
                      styles.saveButtonText,
                      !canSave && styles.saveButtonTextDisabled,
                    ]}>
                      Save
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={16}
                      color={canSave ? colors.bgPrimary : colors.textTertiary}
                    />
                  </>
                )}
              </LinearGradient>
            </AnimatedTouchable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
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
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
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

  // Recording Card
  recordingCard: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    marginBottom: spacing.md,
  },
  recordingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  recordingLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  recordingLiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
    letterSpacing: 1,
  },
  recordingTime: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 32,
    marginBottom: spacing.md,
  },
  waveformBar: {
    width: 4,
    backgroundColor: colors.error,
    borderRadius: 2,
  },
  recordingHint: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
  },

  // Image Card
  imageCard: {
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    marginBottom: spacing.md,
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: 220,
    resizeMode: 'cover',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
  },
  removeImageButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Input Card
  inputCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    minHeight: 180,
    position: 'relative',
  },
  textInput: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
    flex: 1,
  },
  charCount: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.md,
  },
  charCountText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  helperText: {
    fontSize: 13,
    color: colors.textTertiary,
    lineHeight: 18,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },

  // Bottom Bar
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  attachmentRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  attachmentButton: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
  },
  attachmentButtonDisabled: {
    opacity: 0.4,
  },
  attachmentIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  saveButton: {
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  saveButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.bgPrimary,
  },
  saveButtonTextDisabled: {
    color: colors.textTertiary,
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 4,
  },
  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgPrimary,
  },
});
