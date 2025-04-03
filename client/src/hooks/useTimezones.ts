import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

// Common timezone list
const commonTimezones = [
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Bangkok',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tehran',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Berlin',
  'Europe/Dublin',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Stockholm',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'UTC',
];

export function useTimezones() {
  return useQuery({
    queryKey: ['/timezones'],
    queryFn: async () => {
      // Return the common timezones list
      // This could be replaced with a fetch from the server if a more complete list is needed
      return commonTimezones;
    },
    initialData: commonTimezones,
  });
}