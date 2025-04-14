/**
 * Shadow Cache Hook
 * 
 * Provides a specialized store that maintains data persistence during sync operations
 * to completely eliminate UI flickering. The shadow cache sits between the API and the
 * query cache, ensuring that data is never temporarily missing during refresh.
 */

import { useCallback, useRef, useEffect } from 'react';
import { Event } from '@shared/schema';
import { useQueryClient, QueryClient } from '@tanstack/react-query';

export type ShadowCacheConfig = {
  /**
   * Minimum number of items to maintain in cache for specific query
   * Will prevent flashing to empty state during refresh
   */
  minItems?: number;
  
  /**
   * Should we merge new data with existing data instead of replacing
   * This ensures continuity during CalDAV sync operations
   */
  mergeInsteadOfReplace?: boolean;
  
  /**
   * Debug mode for detailed logging
   */
  debug?: boolean;
  
  /**
   * Time to preserve old data after updates (in ms)
   */
  preservationTime?: number;
};

/**
 * Hook that manages a shadow cache system to prevent UI flickering during data fetching
 * Extremely useful for CalDAV sync operations that can cause temporary data loss
 * 
 * @param queryKey The query key to manage
 * @param config Configuration options
 */
export function useShadowCache<T extends { id: number | string, uid?: string } = Event>(
  queryKey: string | string[],
  config: ShadowCacheConfig = {}
) {
  // Normalize query key to array format
  const normalizedQueryKey = Array.isArray(queryKey) ? queryKey : [queryKey];
  
  // Default configuration
  const {
    minItems = 0,
    mergeInsteadOfReplace = true,
    debug = false,
    preservationTime = 5000, // 5 seconds
  } = config;
  
  // Access the query client
  const queryClient = useQueryClient();
  
  // Shadow cache that persists between renders and queries
  const shadowCache = useRef<T[]>([]);
  
  // Track deleted items to prevent restoration
  const deletedItemIds = useRef<Set<number | string>>(new Set());
  
  // Guard interval for continuous cache protection
  const guardIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Debug logging helper
  const log = useCallback((...args: any[]) => {
    if (debug) {
      console.log(`[ShadowCache:${normalizedQueryKey[0]}]`, ...args);
    }
  }, [debug, normalizedQueryKey]);
  
  /**
   * Initialize protection for a specific query key
   * Sets up cache monitoring and preservation
   */
  const setupQueryProtection = useCallback(() => {
    log('Setting up query protection');
    
    // Initial cache snapshot from query client
    const currentData = queryClient.getQueryData<T[]>(normalizedQueryKey) || [];
    
    // Initialize shadow cache if empty
    if (shadowCache.current.length === 0 && currentData.length > 0) {
      shadowCache.current = [...currentData];
      log(`Initialized shadow cache with ${currentData.length} items`);
    }
    
    // Setup monitoring interval for cache protection
    if (guardIntervalRef.current) {
      clearInterval(guardIntervalRef.current);
    }
    
    guardIntervalRef.current = setInterval(() => {
      const currentQueryData = queryClient.getQueryData<T[]>(normalizedQueryKey);
      
      // Cache protection logic
      if (!currentQueryData || currentQueryData.length < Math.max(shadowCache.current.length, minItems)) {
        log(`⚠️ Detected cache drop: ${currentQueryData?.length || 0} items (shadow: ${shadowCache.current.length})`);
        
        // Only restore if shadow cache has data
        if (shadowCache.current.length > 0) {
          log(`🔄 Restoring ${shadowCache.current.length} items from shadow cache`);
          
          // Filter out any deleted items before restoring
          const filteredCache = shadowCache.current.filter(item => 
            !deletedItemIds.current.has(item.id)
          );
          
          if (filteredCache.length !== shadowCache.current.length) {
            log(`🗑️ Filtered out ${shadowCache.current.length - filteredCache.length} deleted items before restoring`);
          }
          
          queryClient.setQueryData(normalizedQueryKey, [...filteredCache]);
        }
      } else if (currentQueryData && currentQueryData.length > 0) {
        // Update shadow cache with latest data, but filter out deleted items
        const filteredQuery = currentQueryData.filter(item => 
          !deletedItemIds.current.has(item.id)
        );
        
        if (filteredQuery.length !== currentQueryData.length) {
          log(`🗑️ Filtered out ${currentQueryData.length - filteredQuery.length} deleted items from query cache`);
        }
        
        if (filteredQuery.length >= shadowCache.current.length) {
          shadowCache.current = [...filteredQuery];
          log(`📸 Updated shadow cache with ${filteredQuery.length} items`);
        }
      }
    }, 50); // Very aggressive protection - check every 50ms
    
    return () => {
      if (guardIntervalRef.current) {
        clearInterval(guardIntervalRef.current);
        guardIntervalRef.current = null;
      }
    };
  }, [queryClient, normalizedQueryKey, minItems, log]);
  
  /**
   * Apply the shadow cache to a query client
   * Used to wrap transformers and mutators
   */
  const wrapQueryClient = useCallback((client: QueryClient): QueryClient => {
    // Create proxy methods for the client to intercept calls
    const originalSetQueryData = client.setQueryData;
    
    // Override setQueryData to ensure we preserve items during updates
    client.setQueryData = function<TData>(
      queryKey: any,
      updater: TData | ((oldData: TData | undefined) => TData)
    ): TData {
      // Only intercept for our specific query key
      const keyMatches = JSON.stringify(queryKey) === JSON.stringify(normalizedQueryKey);
      
      if (keyMatches) {
        // Get current data
        const currentData = client.getQueryData<T[]>(queryKey);
        
        // Preserve current data in shadow cache if it has items
        if (currentData && Array.isArray(currentData) && currentData.length > 0) {
          // This ensures we don't lose data even when the updater replaces all data
          shadowCache.current = [...currentData];
          log(`Preserved ${currentData.length} items in shadow cache during setQueryData`);
        }
        
        // If this is a replacement with empty data and we have a shadow cache
        if (typeof updater !== 'function' && Array.isArray(updater) && 
            updater.length === 0 && shadowCache.current.length > 0) {
          log(`⚠️ Prevented empty data update, using ${shadowCache.current.length} shadow cache items`);
          return originalSetQueryData.call(client, queryKey, shadowCache.current) as TData;
        }
        
        // If this is a function updater and we want to merge data
        if (typeof updater === 'function' && mergeInsteadOfReplace) {
          const originalUpdater = updater as (oldData: TData | undefined) => TData;
          
          return originalSetQueryData.call(client, queryKey, (oldData: TData | undefined) => {
            // Apply the update
            const newData = originalUpdater(oldData);
            
            // If new data becomes empty but we have a shadow cache, use that instead
            if (Array.isArray(newData) && newData.length === 0 && shadowCache.current.length > 0) {
              log(`⚠️ Prevented function updater empty result, using shadow cache`);
              return shadowCache.current as unknown as TData;
            }
            
            return newData;
          });
        }
      }
      
      // Default behavior for other query keys
      return originalSetQueryData.call(client, queryKey, updater);
    };
    
    return client;
  }, [normalizedQueryKey, mergeInsteadOfReplace, log]);
  
  /**
   * Track an item as deleted to prevent it from reappearing
   * Used during event deletion to ensure it doesn't get restored from the cache
   */
  const trackDeletedItem = useCallback((id: number | string) => {
    deletedItemIds.current.add(id);
    log(`🗑️ Tracking deleted item with ID ${id}`);
    
    // Filter the item from shadow cache immediately
    shadowCache.current = shadowCache.current.filter(item => item.id !== id);
    
    // After some time, we can forget about this deleted item
    // as it should be properly removed from the server
    setTimeout(() => {
      deletedItemIds.current.delete(id);
      log(`✓ Stopped tracking deleted item with ID ${id}`);
    }, preservationTime * 3); // Keep tracking for 3x the preservation time
  }, [log, preservationTime]);
  
  /**
   * Manually update the shadow cache
   * Used for operations like mutation where you want to ensure UI consistency
   */
  const updateShadowCache = useCallback((newData: T[]) => {
    // Filter out any deleted items before updating the cache
    const filteredData = newData.filter(item => !deletedItemIds.current.has(item.id));
    
    shadowCache.current = [...filteredData];
    log(`Manually updated shadow cache with ${filteredData.length} items (filtered ${newData.length - filteredData.length} deleted items)`);
    
    // Also update query cache for immediate visibility
    queryClient.setQueryData(normalizedQueryKey, filteredData);
  }, [queryClient, normalizedQueryKey, log]);
  
  /**
   * Get the current contents of the shadow cache
   */
  const getShadowCache = useCallback((): T[] => {
    return [...shadowCache.current];
  }, []);
  
  /**
   * Manually restore from shadow cache
   */
  const restoreFromShadowCache = useCallback(() => {
    if (shadowCache.current.length > 0) {
      // Filter out deleted items before restoring
      const filteredCache = shadowCache.current.filter(item => 
        !deletedItemIds.current.has(item.id)
      );
      
      if (filteredCache.length !== shadowCache.current.length) {
        log(`🗑️ Filtered out ${shadowCache.current.length - filteredCache.length} deleted items before manually restoring`);
      }
      
      log(`🔄 Manually restoring ${filteredCache.length} items from shadow cache`);
      queryClient.setQueryData(normalizedQueryKey, [...filteredCache]);
      return true;
    }
    log('❌ Cannot restore: Shadow cache is empty');
    return false;
  }, [queryClient, normalizedQueryKey, log]);
  
  // Setup and cleanup the protection mechanism
  useEffect(() => {
    const cleanup = setupQueryProtection();
    
    return () => {
      cleanup();
    };
  }, [setupQueryProtection]);
  
  return {
    updateShadowCache,
    getShadowCache,
    restoreFromShadowCache,
    wrapQueryClient,
    trackDeletedItem,
    shadowCacheSize: shadowCache.current.length
  };
}