/**
 * AutonomousActionsList - Clean action suggestions
 *
 * Shows simple tappable pills for each action.
 * No headers, no empty states - clean and minimal.
 * When there are no actions, returns null (shows nothing).
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { ActionSuggestionPill } from './ActionSuggestionPill';
import { ActionReviewModal } from './ActionReviewModal';
import {
  useAutonomousActions,
  useApproveAction,
  useDismissAction,
} from '../hooks/useAutonomousActions';
import { AutonomousAction } from '../types';
import { spacing } from '../theme';
import { logger } from '../utils/logger';

interface AutonomousActionsListProps {
  onActionExecuted?: () => void;
}

export function AutonomousActionsList({ onActionExecuted }: AutonomousActionsListProps) {
  const { data, isLoading } = useAutonomousActions();
  const approveAction = useApproveAction();
  const dismissAction = useDismissAction();

  const [selectedAction, setSelectedAction] = useState<AutonomousAction | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const handlePillPress = (action: AutonomousAction) => {
    setSelectedAction(action);
    setModalVisible(true);
  };

  const handleApprove = async (
    actionId: string,
    modifications?: Record<string, unknown>
  ) => {
    try {
      await approveAction.mutateAsync({ actionId, modifications });
      logger.log('Action approved:', actionId);
      setModalVisible(false);
      setSelectedAction(null);
      onActionExecuted?.();
    } catch (error) {
      logger.error('Failed to approve action:', error);
    }
  };

  const handleDismiss = async (actionId: string, reason?: string) => {
    try {
      await dismissAction.mutateAsync({ actionId, reason });
      logger.log('Action dismissed:', actionId);
      setModalVisible(false);
      setSelectedAction(null);
    } catch (error) {
      logger.error('Failed to dismiss action:', error);
    }
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setSelectedAction(null);
  };

  // Loading - show nothing (clean)
  if (isLoading) {
    return null;
  }

  // No actions - show nothing (clean)
  if (!data || data.actions.length === 0) {
    return null;
  }

  const isPending = approveAction.isPending || dismissAction.isPending;

  return (
    <>
      <View style={styles.container}>
        {data.actions.map((action) => (
          <ActionSuggestionPill
            key={action.id}
            action={action}
            onPress={handlePillPress}
          />
        ))}
      </View>

      <ActionReviewModal
        action={selectedAction}
        visible={modalVisible}
        onClose={handleCloseModal}
        onApprove={handleApprove}
        onDismiss={handleDismiss}
        isLoading={isPending}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
});
