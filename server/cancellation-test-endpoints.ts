/**
 * Cancellation Test Endpoints
 * Provides endpoints for testing and comparing ICS cancellation formatting
 */

import { Express, Request, Response, NextFunction } from 'express';
import { testCancellationFormat, testEnhancedCancellation } from './test-ics-cancellation';

/**
 * Register cancellation test endpoints
 */
export function registerCancellationTestEndpoints(app: Express) {
  // Define a local authentication check function
  const checkAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ error: 'Unauthorized - You must be logged in to access this resource' });
  };

  // Register test endpoints for the enhanced ICS cancellation format
  app.post('/api/test-enhanced-cancellation', checkAuth, testEnhancedCancellation);
  app.post('/api/test-cancellation-comparison', checkAuth, testCancellationFormat);
  
  console.log('Registered cancellation test endpoints: /api/test-enhanced-cancellation and /api/test-cancellation-comparison');
}