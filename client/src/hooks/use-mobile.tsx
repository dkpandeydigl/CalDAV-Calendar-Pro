import { useState, useEffect } from 'react';

/**
 * Hook to check if the current device is mobile based on screen width
 * @returns boolean true if device is mobile
 */
export function useMobile() {
  return useMediaQuery('(max-width: 768px)');
}

/**
 * Hook to detect if the app is being viewed on a small device (tablet or smaller)
 * @returns boolean true if device is small
 */
export function useSmallDevice() {
  return useMediaQuery('(max-width: 1024px)');
}

/**
 * Hook to detect if the app is being viewed on a very small device (small mobile)
 * @returns boolean true if device is very small
 */
export function useVerySmallDevice() {
  return useMediaQuery('(max-width: 640px)');
}

/**
 * A general purpose hook to check any media query
 * @param query The media query to check
 * @returns boolean indicating if the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  
  useEffect(() => {
    // Create media query list and listener
    const mediaQuery = window.matchMedia(query);
    
    // Set matches initially
    setMatches(mediaQuery.matches);
    
    // Define handler for media query changes
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    
    // Add event listener
    mediaQuery.addEventListener('change', handleChange);
    
    // Cleanup function
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);
  
  return matches;
}

export default useMediaQuery;