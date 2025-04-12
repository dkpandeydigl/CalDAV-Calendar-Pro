import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Select, 
  SelectContent, 
  SelectGroup, 
  SelectItem, 
  SelectTrigger, 
  SelectValue,
} from '@/components/ui/select';
import { format, set, parse } from 'date-fns';

interface TimePickerDemoProps {
  date: Date;
  setDate: (date: Date) => void;
}

export function TimePickerDemo({ date, setDate }: TimePickerDemoProps) {
  const [selectedHour, setSelectedHour] = useState<string>(
    format(date, 'h')
  );
  const [selectedMinute, setSelectedMinute] = useState<string>(
    format(date, 'mm')
  );
  const [selectedMeridiem, setSelectedMeridiem] = useState<string>(
    format(date, 'a')
  );

  useEffect(() => {
    // Update the selected values when the date prop changes
    setSelectedHour(format(date, 'h'));
    setSelectedMinute(format(date, 'mm'));
    setSelectedMeridiem(format(date, 'a'));
  }, [date]);

  useEffect(() => {
    // Update the parent's date when any of the time components change
    // We need to preserve the date part and only update the time part
    const hours = parseInt(selectedHour);
    const minutes = parseInt(selectedMinute);
    const isPM = selectedMeridiem === 'PM';
    
    // Convert to 24-hour format
    const hours24 = isPM && hours < 12 ? hours + 12 : (!isPM && hours === 12 ? 0 : hours);
    
    // Create a new date with the same date part but updated time
    const newDate = new Date(date);
    newDate.setHours(hours24);
    newDate.setMinutes(minutes);
    newDate.setSeconds(0);
    
    setDate(newDate);
  }, [selectedHour, selectedMinute, selectedMeridiem, setDate]);

  return (
    <div className="flex items-center space-x-2">
      <Select
        value={selectedHour}
        onValueChange={setSelectedHour}
      >
        <SelectTrigger className="w-16">
          <SelectValue placeholder={selectedHour} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Array.from({ length: 12 }, (_, i) => {
              const hour = (i + 1).toString();
              return (
                <SelectItem key={hour} value={hour}>
                  {hour}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
      
      <span>:</span>
      
      <Select
        value={selectedMinute}
        onValueChange={setSelectedMinute}
      >
        <SelectTrigger className="w-16">
          <SelectValue placeholder={selectedMinute} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Array.from({ length: 60 }, (_, i) => {
              const minute = i.toString().padStart(2, '0');
              return (
                <SelectItem key={minute} value={minute}>
                  {minute}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
      
      <Select
        value={selectedMeridiem}
        onValueChange={setSelectedMeridiem}
      >
        <SelectTrigger className="w-16">
          <SelectValue placeholder={selectedMeridiem} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}