import React from 'react';
import IcsFormatTester from '../components/ics-format-tester';

const IcsFormatTestPage: React.FC = () => {
  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">ICS Format Testing</h1>
      <IcsFormatTester />
    </div>
  );
};

export default IcsFormatTestPage;