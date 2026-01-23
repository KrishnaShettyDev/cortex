import { AudioModule, RecordingPresets, type AudioRecorder, IOSOutputFormat, AudioQuality } from 'expo-audio';
import { logger } from '../utils/logger';

export interface RecordingResult {
  uri: string;
  duration: number;
}

// Custom recording preset optimized for Whisper API compatibility
// Uses LinearPCM encoding which outputs a .wav file - universally compatible
const WHISPER_COMPATIBLE_PRESET = {
  extension: '.wav',
  sampleRate: 16000, // 16kHz - optimal for speech recognition
  numberOfChannels: 1, // Mono - better for speech
  bitRate: 256000,
  android: {
    outputFormat: 'default',
    audioEncoder: 'default',
  },
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM, // Linear PCM = WAV format
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/wav',
    bitsPerSecond: 256000,
  },
};

// Standalone recording functions using the new expo-audio API
let recordingStartTime: number = 0;
let audioRecorder: AudioRecorder | null = null;

export async function requestAudioPermissions(): Promise<boolean> {
  try {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    return status.granted;
  } catch (error) {
    logger.error('Error requesting audio permissions:', error);
    return false;
  }
}

export async function startRecording(): Promise<boolean> {
  try {
    // Request permissions
    const granted = await requestAudioPermissions();
    if (!granted) {
      logger.log('Microphone permission not granted');
      return false;
    }

    // Enable recording mode on iOS
    await AudioModule.setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    // Create the recorder with Whisper-compatible preset
    audioRecorder = new AudioModule.AudioRecorder(WHISPER_COMPATIBLE_PRESET as any);

    // Prepare and start recording
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();

    recordingStartTime = Date.now();
    logger.log('Recording started');
    return true;
  } catch (error) {
    logger.error('Error starting recording:', error);
    return false;
  }
}

export async function stopRecording(): Promise<RecordingResult | null> {
  try {
    if (!audioRecorder) {
      logger.log('No active recording to stop');
      return null;
    }

    audioRecorder.stop();
    const uri = audioRecorder.uri;
    const duration = Date.now() - recordingStartTime;

    // Reset audio mode
    await AudioModule.setAudioModeAsync({
      allowsRecording: false,
    });

    // Clean up
    audioRecorder = null;
    recordingStartTime = 0;

    if (!uri) {
      return null;
    }

    logger.log('Recording stopped, uri:', uri);
    return {
      uri,
      duration,
    };
  } catch (error) {
    logger.error('Error stopping recording:', error);
    audioRecorder = null;
    return null;
  }
}

export async function cancelRecording(): Promise<void> {
  try {
    if (audioRecorder) {
      audioRecorder.stop();
      audioRecorder = null;
    }
    recordingStartTime = 0;
  } catch (error) {
    logger.error('Error canceling recording:', error);
    audioRecorder = null;
  }
}

export function isCurrentlyRecording(): boolean {
  return audioRecorder !== null;
}

// Legacy class-based service for backwards compatibility
class SpeechService {
  private permissionGranted: boolean = false;

  async requestPermissions(): Promise<boolean> {
    this.permissionGranted = await requestAudioPermissions();
    return this.permissionGranted;
  }

  async startRecording(): Promise<boolean> {
    return startRecording();
  }

  async stopRecording(): Promise<RecordingResult | null> {
    return stopRecording();
  }

  async cancelRecording(): Promise<void> {
    return cancelRecording();
  }

  isRecording(): boolean {
    return isCurrentlyRecording();
  }
}

export const speechService = new SpeechService();
