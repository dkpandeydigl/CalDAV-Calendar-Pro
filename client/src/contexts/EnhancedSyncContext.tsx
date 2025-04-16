/**
 * Enhanced Sync Context
 * 
 * This context provides enhanced synchronization capabilities across the application
 * for consistent UID handling and immediate CalDAV server synchronization.
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useEnhancedSync } from '@/hooks/useEnhancedSync';

// Define the context type
interface EnhancedSyncContextType {
  syncStatus: {
    isSyncing: boolean;
    lastSyncTime: Date | null;
    error: string | null;
  };
  wsConnected: boolean;
  operations: {
    create: {
      isProcessing: boolean;
      success: boolean | null;
      error: string | null;
    };
    update: {
      isProcessing: boolean;
      success: boolean | null;
      error: string | null;
    };
    delete: {
      isProcessing: boolean;
      success: boolean | null;
      error: string | null;
    };
  };
  actions: {
    forceBidirectionalSync: (calendarId?: number) => Promise<boolean>;
    createEventWithSync: (eventData: any) => Promise<any>;
    updateEventWithSync: (eventId: number, eventData: any) => Promise<any>;
    cancelEventWithSync: (eventId: number) => Promise<boolean>;
    requestSyncViaWebSocket: (options?: any) => boolean;
  };
}

// Create the context with an undefined initial value
const EnhancedSyncContext = createContext<EnhancedSyncContextType | undefined>(undefined);

// Provider component
export function EnhancedSyncProvider({ children }: { children: ReactNode }) {
  const enhancedSync = useEnhancedSync();

  return (
    <EnhancedSyncContext.Provider value={enhancedSync}>
      {children}
    </EnhancedSyncContext.Provider>
  );
}

// Hook to use the context
export function useEnhancedSyncContext() {
  const context = useContext(EnhancedSyncContext);
  
  if (context === undefined) {
    throw new Error('useEnhancedSyncContext must be used within an EnhancedSyncProvider');
  }
  
  return context;
}