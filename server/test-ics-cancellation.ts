/**
 * Test utilities for the enhanced ICS cancellation format
 * Provides endpoints for generating and testing cancellation ICS files
 */

import { Request, Response } from 'express';
import { generateCancellationIcs } from './enhanced-ics-cancellation-fixed';
import { emailService } from './email-service';

/**
 * Test endpoint handler for comparing the old and new cancellation ICS format
 */
export async function testCancellationFormat(req: Request, res: Response) {
  try {
    const { originalIcs, eventData } = req.body;

    if (!originalIcs || !eventData) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: originalIcs and eventData'
      });
    }

    // Generate cancellation ICS using the enhanced generator
    const enhancedCancellationIcs = generateCancellationIcs(originalIcs, eventData);

    // Generate cancellation ICS using the old email service method for comparison
    const legacyCancellationIcs = emailService.transformIcsForCancellation(originalIcs, eventData);

    return res.status(200).json({
      success: true,
      enhanced: enhancedCancellationIcs,
      legacy: legacyCancellationIcs,
      originalIcs
    });
  } catch (error) {
    console.error('Error testing cancellation formats:', error);
    return res.status(500).json({
      success: false,
      message: 'Error testing cancellation formats',
      error: error.message
    });
  }
}

/**
 * Test endpoint for validating the enhanced ICS cancellation format
 */
export async function testEnhancedCancellation(req: Request, res: Response) {
  try {
    const { originalIcs, eventData } = req.body;

    if (!originalIcs || !eventData) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: originalIcs and eventData'
      });
    }

    // Ensure we have a UID
    if (!eventData.uid) {
      eventData.uid = `test-cancellation-${Date.now()}@caldavclient.local`;
    }

    // Generate cancellation ICS using the enhanced generator
    const cancellationIcs = generateCancellationIcs(originalIcs, eventData);

    return res.status(200).json({
      success: true,
      result: cancellationIcs,
      formattedResult: cancellationIcs.replace(/\r\n/g, '<br>')
    });
  } catch (error) {
    console.error('Error generating enhanced cancellation ICS:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating enhanced cancellation ICS',
      error: error.message
    });
  }
}