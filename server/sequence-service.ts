/**
 * Sequence Service for RFC 5545 Compliance
 * 
 * This service tracks and manages sequence numbers for calendar events to ensure
 * proper incrementation and consistent RFC 5545 compliance. The sequence number
 * is critical for event changes to be properly recognized by calendar clients.
 */

import { storage } from './storage';
import { extractSequenceFromICal } from './ical-utils';

class SequenceService {
  private cachedSequences: Map<string, number> = new Map();
  private initialized: boolean = false;

  /**
   * Initialize the sequence service
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Load existing events to cache their sequence numbers
      const events = await storage.getEvents({});
      
      console.log(`[SequenceService] Loading sequence numbers for ${events.length} events`);
      
      for (const event of events) {
        if (event.uid && event.rawData) {
          try {
            const sequence = extractSequenceFromICal(String(event.rawData));
            this.cachedSequences.set(event.uid, sequence);
            console.log(`[SequenceService] Cached sequence ${sequence} for event ${event.id} (${event.uid})`);
          } catch (error) {
            console.error(`[SequenceService] Error extracting sequence for event ${event.id}:`, error);
          }
        }
      }
      
      this.initialized = true;
      console.log(`[SequenceService] Initialized with ${this.cachedSequences.size} sequence numbers`);
    } catch (error) {
      console.error('[SequenceService] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Get the current sequence number for an event
   * 
   * @param uid The event UID
   * @param rawData Optional raw ICS data to extract sequence from
   * @returns The current sequence number (defaults to 0)
   */
  public async getCurrentSequence(uid: string, rawData?: string): Promise<number> {
    await this.ensureInitialized();
    
    // First try to get from cache
    const cachedSequence = this.cachedSequences.get(uid);
    if (cachedSequence !== undefined) {
      return cachedSequence;
    }
    
    // Then try to extract from raw data if provided
    if (rawData) {
      try {
        const sequence = extractSequenceFromICal(rawData);
        this.cachedSequences.set(uid, sequence);
        return sequence;
      } catch (error) {
        console.warn(`[SequenceService] Failed to extract sequence from raw data:`, error);
      }
    }
    
    // Default to 0 if not found
    return 0;
  }

  /**
   * Get the next sequence number for an event update
   * 
   * @param uid The event UID
   * @param rawData Optional raw ICS data to extract current sequence from
   * @returns The next sequence number (current + 1)
   */
  public async getNextSequence(uid: string, rawData?: string): Promise<number> {
    const currentSequence = await this.getCurrentSequence(uid, rawData);
    const nextSequence = currentSequence + 1;
    
    // Cache the new sequence number
    this.cachedSequences.set(uid, nextSequence);
    console.log(`[SequenceService] Incrementing sequence for ${uid}: ${currentSequence} -> ${nextSequence}`);
    
    return nextSequence;
  }

  /**
   * Update an existing sequence number in the cache
   * 
   * @param uid The event UID
   * @param sequence The new sequence number
   */
  public async updateSequence(uid: string, sequence: number): Promise<void> {
    await this.ensureInitialized();
    this.cachedSequences.set(uid, sequence);
  }

  /**
   * Remove a sequence number from the cache
   * 
   * @param uid The event UID to remove
   */
  public async removeSequence(uid: string): Promise<void> {
    await this.ensureInitialized();
    this.cachedSequences.delete(uid);
  }
  
  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }
}

// Export a singleton instance
export const sequenceService = new SequenceService();