/**
 * Page for testing ICS formatting with the email service
 * This page allows users to test the ICS formatting fixes we've implemented
 */

import React from 'react';
import { IcsFormatTester } from '../components/ics-format-tester';

export function IcsFormatTestPage() {
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-6">ICS Format Testing Tool</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        This tool helps diagnose and fix formatting issues in ICS files before they're sent as email attachments.
        You can test raw ICS data or use an existing event from the database.
      </p>
      
      <IcsFormatTester />
    </div>
  );
}

export default IcsFormatTestPage;