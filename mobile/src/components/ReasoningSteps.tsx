import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius } from '../theme';
import { StatusUpdate } from '../services/chat';

interface ReasoningStepsProps {
  steps: StatusUpdate[];
}

/**
 * Displays real-time reasoning steps as the AI processes a request.
 * Shows a list of steps with the current step having a spinner.
 */
export function ReasoningSteps({ steps }: ReasoningStepsProps) {
  if (steps.length === 0) return null;

  // Get icon for step type
  const getStepIcon = (step: StatusUpdate) => {
    switch (step.step) {
      case 'searching_memories':
        return 'search-outline';
      case 'memories_found':
        return 'documents-outline';
      case 'generating':
        return 'sparkles-outline';
      case 'tool_calling':
        if (step.tool === 'search_places') return 'location-outline';
        if (step.tool === 'find_free_time') return 'calendar-outline';
        if (step.tool?.includes('email')) return 'mail-outline';
        return 'cog-outline';
      case 'tool_complete':
        return 'checkmark-circle-outline';
      default:
        return 'ellipse-outline';
    }
  };

  return (
    <View style={styles.container}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isComplete = !isLast || step.step === 'tool_complete';

        return (
          <View key={index} style={styles.stepRow}>
            {/* Icon or spinner */}
            <View style={styles.iconContainer}>
              {isLast && !isComplete ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons
                  name={getStepIcon(step) as any}
                  size={14}
                  color={isComplete ? colors.textTertiary : colors.accent}
                />
              )}
            </View>

            {/* Step text */}
            <Text
              style={[
                styles.stepText,
                isComplete && styles.stepTextComplete,
                isLast && !isComplete && styles.stepTextActive,
              ]}
            >
              {step.message}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconContainer: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  stepTextComplete: {
    color: colors.textTertiary,
  },
  stepTextActive: {
    color: colors.textPrimary,
  },
});
