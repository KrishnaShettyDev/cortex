import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Dimensions,
  PanResponder,
  Modal,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, borderRadius, sheetHandle } from '../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  height?: number | 'auto';
  showHandle?: boolean;
  backgroundColor?: string;
}

export function BottomSheet({
  visible,
  onClose,
  children,
  height = SCREEN_HEIGHT * 0.6,
  showHandle = true,
  backgroundColor = colors.bgSecondary,
}: BottomSheetProps) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [shouldRender, setShouldRender] = useState(visible);
  const [isInteractive, setIsInteractive] = useState(false); // Track if backdrop should respond
  const isOpenRef = useRef(false); // Track if sheet is fully open
  const isAnimatingRef = useRef(false);

  const sheetHeight = height === 'auto' ? undefined : height;
  const maxTranslate = typeof height === 'number' ? height : SCREEN_HEIGHT * 0.6;

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      setIsInteractive(false); // Disable backdrop interaction during animation
      isAnimatingRef.current = true;
      isOpenRef.current = true;

      // Reset position before animating in
      translateY.setValue(SCREEN_HEIGHT);
      backdropOpacity.setValue(0);

      // Small delay to ensure modal is mounted before animating
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 25,
            stiffness: 200,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          isAnimatingRef.current = false;
          setIsInteractive(true); // Enable backdrop interaction after animation
        });
      }, 50);
    } else if (shouldRender) {
      setIsInteractive(false); // Disable during close animation
      isAnimatingRef.current = true;
      isOpenRef.current = false;
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isAnimatingRef.current = false;
        setShouldRender(false);
      });
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only capture vertical drags on the handle area when sheet is open
        return isOpenRef.current && gestureState.dy > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0 && isOpenRef.current) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (!isOpenRef.current) return;
        if (gestureState.dy > maxTranslate * 0.3 || gestureState.vy > 0.5) {
          onClose();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 25,
            stiffness: 200,
          }).start();
        }
      },
    })
  ).current;

  if (!shouldRender) return null;

  const handleBackdropPress = () => {
    // Only close if sheet is interactive (animation complete)
    if (isInteractive && isOpenRef.current && !isAnimatingRef.current) {
      onClose();
    }
  };

  const handleRequestClose = () => {
    if (isInteractive && isOpenRef.current && !isAnimatingRef.current) {
      onClose();
    }
  };

  return (
    <Modal
      visible={shouldRender}
      transparent
      animationType="none"
      onRequestClose={handleRequestClose}
      statusBarTranslucent
    >
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Backdrop - positioned behind sheet, only captures taps outside sheet */}
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: backdropOpacity },
          ]}
          pointerEvents="none"
        >
          <BlurView intensity={20} style={StyleSheet.absoluteFill} tint="dark" />
        </Animated.View>

        {/* Tap-to-close area - fills space above the sheet, only active when interactive */}
        {isInteractive && (
          <Pressable
            style={styles.backdropTapArea}
            onPress={handleBackdropPress}
          />
        )}
        {!isInteractive && <View style={styles.backdropTapArea} pointerEvents="none" />}

        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor,
              transform: [{ translateY }],
            },
            height === 'auto' && styles.sheetAuto,
          ]}
        >
          <View {...panResponder.panHandlers}>
            {showHandle && <View style={styles.handle} />}
          </View>
          <View style={height === 'auto' ? styles.contentAuto : styles.content}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropTapArea: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    overflow: 'hidden',
  },
  sheetAuto: {
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  handle: {
    ...sheetHandle,
  },
  content: {
    flex: 1,
  },
  contentAuto: {
    // No flex for auto height - let content determine size
  },
});
