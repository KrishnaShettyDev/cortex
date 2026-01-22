import React from 'react';
import { Image, StyleSheet } from 'react-native';

interface IconProps {
  size?: number;
}

// Service icon URLs - Official brand icons from CDNs
const SERVICE_ICON_URLS = {
  gmail: 'https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png',
  calendar: 'https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png',
  outlook: 'https://img.icons8.com/fluency/96/microsoft-outlook-2019.png',
};

// Gmail Logo - Official Google Gmail icon
export function GmailIcon({ size = 24 }: IconProps) {
  return (
    <Image
      source={{ uri: SERVICE_ICON_URLS.gmail }}
      style={[styles.icon, { width: size, height: size }]}
    />
  );
}

// Google Calendar Logo - Official Google Calendar icon
export function GoogleCalendarIcon({ size = 24 }: IconProps) {
  return (
    <Image
      source={{ uri: SERVICE_ICON_URLS.calendar }}
      style={[styles.icon, { width: size, height: size }]}
    />
  );
}

// Simplified Calendar icon (alias)
export function CalendarIcon({ size = 24 }: IconProps) {
  return <GoogleCalendarIcon size={size} />;
}

// Microsoft Outlook icon
export function OutlookIcon({ size = 24 }: IconProps) {
  return (
    <Image
      source={{ uri: SERVICE_ICON_URLS.outlook }}
      style={[styles.icon, { width: size, height: size }]}
    />
  );
}

const styles = StyleSheet.create({
  icon: {
    borderRadius: 4,
  },
});
