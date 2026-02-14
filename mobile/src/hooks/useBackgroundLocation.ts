/**
 * Hook to manage background location permission for geofencing.
 * Use this to check permission status and show the permission modal.
 */

import { useState, useEffect, useCallback } from 'react';
import { geofencingService } from '../services/geofencing';
import { storage } from '../services/storage';

const PERMISSION_ASKED_KEY = 'background_location_asked';

interface UseBackgroundLocationReturn {
  hasPermission: boolean;
  isLoading: boolean;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  requestPermission: () => Promise<boolean>;
  checkAndPrompt: () => Promise<boolean>;
}

export function useBackgroundLocation(): UseBackgroundLocationReturn {
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Check permission on mount
  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    setIsLoading(true);
    try {
      const granted = await geofencingService.hasBackgroundPermission();
      setHasPermission(granted);
    } catch (error) {
      console.error('Error checking background location permission:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const requestPermission = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const granted = await geofencingService.requestBackgroundPermission();
      setHasPermission(granted);
      await storage.set(PERMISSION_ASKED_KEY, 'true');
      return granted;
    } catch (error) {
      console.error('Error requesting background location permission:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Check if we have permission. If not, and we haven't asked before, show the modal.
   * Returns true if permission is already granted.
   */
  const checkAndPrompt = useCallback(async (): Promise<boolean> => {
    // Already have permission
    if (hasPermission) {
      return true;
    }

    // Check if we've already asked
    const alreadyAsked = await storage.get(PERMISSION_ASKED_KEY);
    if (alreadyAsked === 'true') {
      // Already asked before, don't prompt again automatically
      return false;
    }

    // Show the modal
    setShowModal(true);
    return false;
  }, [hasPermission]);

  return {
    hasPermission,
    isLoading,
    showModal,
    setShowModal,
    requestPermission,
    checkAndPrompt,
  };
}
