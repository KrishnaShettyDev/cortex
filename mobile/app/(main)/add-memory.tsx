import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { memoryService, speechService, api } from '../../src/services';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';
import { colors, gradients, spacing, borderRadius } from '../../src/theme';

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/chat');
  }
};

type MemoryMode = 'voice' | 'photo' | 'text';

export default function AddMemoryScreen() {
  const posthog = usePostHog();
  const [mode, setMode] = useState<MemoryMode>('text');
  const [memoryText, setMemoryText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      return () => {
        pulse.stop();
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    } else {
      pulseAnim.setValue(1);
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

  const handleSaveText = async () => {
    if (!memoryText.trim()) {
      Alert.alert('Error', 'Please enter some text');
      return;
    }

    setIsLoading(true);
    try {
      await memoryService.createMemory({
        content: memoryText,
        memory_type: 'text',
      });

      // Track text memory created
      posthog?.capture(ANALYTICS_EVENTS.TEXT_MEMORY_CREATED, {
        content_length: memoryText.length,
      });

      // Memory saved instantly - entities/embeddings are processed in background
      Alert.alert('Saved', 'Memory captured successfully.', [
        { text: 'OK', onPress: goBack },
      ]);
    } catch (error: any) {
      console.error('Save error:', error);
      Alert.alert('Error', error.message || 'Failed to save memory');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      setIsRecording(false);
      const result = await speechService.stopRecording();

      if (result && result.uri) {
        const description = memoryText.trim();

        Alert.alert(
          'Processing',
          'Your voice memo is being transcribed...',
          [{ text: 'OK', onPress: goBack }]
        );

        processVoiceMemo(result.uri, description).catch((error) => {
          console.error('Background processing error:', error);
        });
      }
    } else {
      const started = await speechService.startRecording();
      if (started) {
        setIsRecording(true);
      } else {
        Alert.alert(
          'Microphone Access',
          'Please enable microphone access in Settings to record voice notes.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const processVoiceMemo = async (audioUri: string, description: string) => {
    try {
      console.log('Background: Uploading audio for transcription...');
      const uploadResult = await api.uploadAudioWithTranscription(audioUri);

      const transcription = uploadResult.transcription?.trim();

      let content: string;
      if (transcription && description) {
        content = `${transcription}\n\n[User note: ${description}]`;
      } else if (transcription) {
        content = transcription;
      } else if (description) {
        content = description;
      } else {
        content = '[Voice memo - transcription unavailable]';
      }

      await memoryService.createMemory({
        content,
        memory_type: 'voice',
        audio_url: uploadResult.url,
      });

      // Track voice memory created
      posthog?.capture(ANALYTICS_EVENTS.VOICE_MEMORY_CREATED, {
        has_transcription: !!transcription,
        has_description: !!description,
      });

      console.log('Background: Voice memo saved successfully');
    } catch (error: any) {
      console.error('Background: Failed to process voice memo:', error);
      throw error;
    }
  };

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera Access',
          'Please enable camera access in Settings to take photos.',
          [{ text: 'OK' }]
        );
        return;
      }

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
        Alert.alert(
          'Camera Unavailable',
          'Camera is not available on this device. Please use the photo library instead.',
          [{ text: 'OK' }]
        );
      } else {
        console.error('Camera error:', error);
      }
    }
  };

  const handlePickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo Library Access',
        'Please enable photo library access in Settings.',
        [{ text: 'OK' }]
      );
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
  };

  const handleSavePhoto = async () => {
    if (!selectedImage) {
      Alert.alert('Error', 'Please take or select a photo');
      return;
    }

    const caption = memoryText.trim();
    if (!caption) {
      Alert.alert('Error', 'Please add a caption for your photo');
      return;
    }

    setIsLoading(true);

    Alert.alert(
      'Saving',
      'Your photo memory is being saved...',
      [{ text: 'OK', onPress: goBack }]
    );

    processPhotoMemory(selectedImage, caption).catch((error) => {
      console.error('Background processing error:', error);
    });

    setIsLoading(false);
  };

  const processPhotoMemory = async (imageUri: string, caption: string) => {
    try {
      console.log('Background: Uploading photo...');
      const photoUrl = await api.uploadPhoto(imageUri);

      await memoryService.createMemory({
        content: caption,
        memory_type: 'photo',
        photo_url: photoUrl,
      });

      // Track photo memory created
      posthog?.capture(ANALYTICS_EVENTS.PHOTO_MEMORY_CREATED, {
        caption_length: caption.length,
      });

      console.log('Background: Photo memory saved successfully');
    } catch (error: any) {
      console.error('Background: Failed to process photo:', error);
      throw error;
    }
  };

  const clearSelectedImage = () => {
    setSelectedImage(null);
  };

  const canSaveText = memoryText.trim().length > 0;
  const canSavePhoto = selectedImage && memoryText.trim().length > 0;

  const tabs = [
    { key: 'text' as MemoryMode, icon: 'document-text-outline' as const, label: 'Note' },
    { key: 'voice' as MemoryMode, icon: 'mic-outline' as const, label: 'Voice' },
    { key: 'photo' as MemoryMode, icon: 'camera-outline' as const, label: 'Photo' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Sheet Handle */}
      <View style={styles.handleContainer}>
        <View style={styles.handle} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.cancelButton} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Context</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Segmented Control */}
      <View style={styles.segmentedControl}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.segment, mode === tab.key && styles.segmentActive]}
            onPress={() => {
              if (mode !== tab.key) {
                posthog?.capture(ANALYTICS_EVENTS.MEMORY_MODE_SWITCHED, {
                  from_mode: mode,
                  to_mode: tab.key,
                });
              }
              setMode(tab.key);
            }}
            disabled={isRecording}
            activeOpacity={0.7}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={mode === tab.key ? colors.textPrimary : colors.textTertiary}
            />
            <Text style={[styles.segmentText, mode === tab.key && styles.segmentTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Text Mode */}
          {mode === 'text' && (
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>What would you like Cortex to remember?</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g., My favorite restaurant is..."
                  placeholderTextColor={colors.textTertiary}
                  value={memoryText}
                  onChangeText={setMemoryText}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                />
              </View>
              <Text style={styles.inputHint}>
                This helps Cortex provide more personalized responses.
              </Text>
            </View>
          )}

          {/* Voice Mode */}
          {mode === 'voice' && (
            <>
              <View style={styles.voiceSection}>
                <Animated.View style={[styles.recordButtonContainer, { transform: [{ scale: pulseAnim }] }]}>
                  <TouchableOpacity
                    onPress={toggleRecording}
                    activeOpacity={0.8}
                    disabled={isLoading}
                  >
                    <LinearGradient
                      colors={isRecording ? [colors.error, colors.error] : gradients.primary}
                      style={styles.recordButton}
                    >
                      <Ionicons
                        name={isRecording ? 'stop' : 'mic'}
                        size={32}
                        color={isRecording ? colors.textPrimary : colors.bgPrimary}
                      />
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>
                <Text style={styles.recordText}>
                  {isRecording
                    ? `Recording ${formatDuration(recordingDuration)}`
                    : 'Tap to record'}
                </Text>
                {isRecording && (
                  <Text style={styles.recordHint}>Tap again to stop</Text>
                )}
              </View>

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>
                  Add a note (optional)
                </Text>
                <View style={styles.inputContainerSmall}>
                  <TextInput
                    style={styles.textInputSmall}
                    placeholder="Additional context..."
                    placeholderTextColor={colors.textTertiary}
                    value={memoryText}
                    onChangeText={setMemoryText}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                  />
                </View>
              </View>
            </>
          )}

          {/* Photo Mode */}
          {mode === 'photo' && (
            <>
              {selectedImage ? (
                <View style={styles.imagePreviewContainer}>
                  <Image source={{ uri: selectedImage }} style={styles.imagePreview} />
                  <TouchableOpacity style={styles.removeImageButton} onPress={clearSelectedImage}>
                    <View style={styles.removeImageIcon}>
                      <Ionicons name="close" size={16} color={colors.textPrimary} />
                    </View>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.photoButtons}>
                  <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto} activeOpacity={0.7}>
                    <Ionicons name="camera-outline" size={24} color={colors.textSecondary} />
                    <Text style={styles.photoButtonText}>Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.photoButton} onPress={handlePickPhoto} activeOpacity={0.7}>
                    <Ionicons name="images-outline" size={24} color={colors.textSecondary} />
                    <Text style={styles.photoButtonText}>Library</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>Add a caption</Text>
                <View style={styles.inputContainerSmall}>
                  <TextInput
                    style={styles.textInputSmall}
                    placeholder="Describe this photo..."
                    placeholderTextColor={colors.textTertiary}
                    value={memoryText}
                    onChangeText={setMemoryText}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                  />
                </View>
              </View>
            </>
          )}
        </ScrollView>

        {/* Save Bar - Chat style */}
        <View style={styles.footer}>
          <View style={styles.saveBarWrapper}>
            <Text style={styles.saveBarText}>
              {mode === 'text' ? 'Save memory' : mode === 'voice' ? 'Save note' : 'Save photo'}
            </Text>
            <TouchableOpacity
              onPress={mode === 'photo' ? handleSavePhoto : handleSaveText}
              disabled={(mode === 'text' && !canSaveText) || (mode === 'photo' && !canSavePhoto) || (mode === 'voice' && !canSaveText && !isRecording) || isLoading}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.saveBarButton,
                  ((mode === 'text' && !canSaveText) || (mode === 'photo' && !canSavePhoto) || (mode === 'voice' && !canSaveText && !isRecording)) && styles.saveBarButtonDisabled
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color="#0D0D0D" size="small" />
                ) : (
                  <Ionicons name="arrow-up" size={18} color="#0D0D0D" />
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.textTertiary,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cancelButton: {
    minWidth: 60,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSpacer: {
    minWidth: 60,
  },
  segmentedControl: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    padding: 4,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: 6,
  },
  segmentActive: {
    backgroundColor: colors.bgTertiary,
  },
  segmentText: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: colors.textPrimary,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  // Input Section
  inputSection: {
    width: '100%',
  },
  inputLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  inputContainer: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  inputContainerSmall: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  textInput: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 150,
    lineHeight: 22,
  },
  textInputSmall: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 80,
    lineHeight: 22,
  },
  inputHint: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  // Voice Section
  voiceSection: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.lg,
  },
  recordButtonContainer: {
    marginBottom: spacing.md,
  },
  recordButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordText: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '500',
    textAlign: 'center',
  },
  recordHint: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  // Photo Section
  photoButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  photoButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderStyle: 'dashed',
    gap: spacing.sm,
  },
  photoButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  imagePreviewContainer: {
    position: 'relative',
    marginBottom: spacing.lg,
  },
  imagePreview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: borderRadius.lg,
    resizeMode: 'cover',
  },
  removeImageButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  removeImageIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Footer - Chat style save bar
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
  },
  saveBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.full,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  saveBarText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 16,
  },
  saveBarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBarButtonDisabled: {
    opacity: 0.4,
  },
});
