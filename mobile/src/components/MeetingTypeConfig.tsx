/**
 * Meeting Type Configuration and Logo Component
 */
import React from 'react';
import { Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MeetingType } from '../services';

// Meeting type logo and color configuration
// Using official Google logos (local assets)
const GOOGLE_MEET_LOGO = require('../../assets/google-meet-logo.png');
const GOOGLE_CALENDAR_LOGO = require('../../assets/google-calendar-logo.png');

export interface MeetingTypeConfigItem {
  logo: any;
  fallbackIcon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}

export const MEETING_TYPE_CONFIG: Record<MeetingType, MeetingTypeConfigItem> = {
  google_meet: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Google Meet'
  },
  zoom: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  teams: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  webex: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  video: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  offline: {
    logo: GOOGLE_CALENDAR_LOGO,
    fallbackIcon: 'calendar',
    color: '#4285F4',
    bgColor: 'rgba(66, 133, 244, 0.15)',
    borderColor: '#4285F4',
    label: 'Event'
  },
};

interface MeetingTypeLogoProps {
  meetingType: MeetingType;
  size?: number;
}

export const MeetingTypeLogo: React.FC<MeetingTypeLogoProps> = ({
  meetingType,
  size = 16,
}) => {
  const config = MEETING_TYPE_CONFIG[meetingType];

  // Show local logo image
  if (config.logo) {
    return (
      <Image
        source={config.logo}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }

  // Fallback to icon
  return (
    <Ionicons
      name={config.fallbackIcon as any}
      size={size}
      color={config.color}
    />
  );
};
