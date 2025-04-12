import React, { useEffect, useState } from "react";
import { format, isValid, parse, set } from "date-fns";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TimePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  disabled?: boolean;
  className?: string;
}

export function TimePicker({
  date,
  setDate,
  disabled,
  className,
}: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedHour, setSelectedHour] = useState<string | undefined>(
    date ? format(date, "HH") : undefined
  );
  const [selectedMinute, setSelectedMinute] = useState<string | undefined>(
    date ? format(date, "mm") : undefined
  );

  useEffect(() => {
    if (date && isValid(date)) {
      setSelectedHour(format(date, "HH"));
      setSelectedMinute(format(date, "mm"));
    }
  }, [date]);

  const handleTimeChange = (hour: string, minute: string) => {
    if (!date || !isValid(date)) {
      const today = new Date();
      const newDate = set(today, {
        hours: parseInt(hour, 10),
        minutes: parseInt(minute, 10),
        seconds: 0,
        milliseconds: 0,
      });
      setDate(newDate);
    } else {
      const newDate = set(date, {
        hours: parseInt(hour, 10),
        minutes: parseInt(minute, 10),
      });
      setDate(newDate);
    }
  };

  const handleHourChange = (hour: string) => {
    setSelectedHour(hour);
    if (selectedMinute) {
      handleTimeChange(hour, selectedMinute);
    } else {
      handleTimeChange(hour, "00");
    }
  };

  const handleMinuteChange = (minute: string) => {
    setSelectedMinute(minute);
    if (selectedHour) {
      handleTimeChange(selectedHour, minute);
    } else {
      // Default to current hour if none was selected
      const currentHour = format(new Date(), "HH");
      handleTimeChange(currentHour, minute);
      setSelectedHour(currentHour);
    }
  };

  const hoursArray = Array.from({ length: 24 }, (_, i) =>
    i.toString().padStart(2, "0")
  );
  const minutesArray = Array.from({ length: 60 }, (_, i) =>
    i.toString().padStart(2, "0")
  );

  // Create intervals of 5 or 15 minutes for more usable dropdown
  const minuteIntervals = minutesArray.filter(
    (minute) => parseInt(minute) % 5 === 0
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "justify-start text-left font-normal h-8",
            !date && "text-muted-foreground",
            className
          )}
        >
          <Clock className="mr-2 h-3.5 w-3.5" />
          {date && isValid(date) ? format(date, "HH:mm") : "Select time"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex items-center gap-2">
          <Select value={selectedHour} onValueChange={handleHourChange}>
            <SelectTrigger className="w-16">
              <SelectValue placeholder="Hour" />
            </SelectTrigger>
            <SelectContent>
              {hoursArray.map((hour) => (
                <SelectItem key={hour} value={hour}>
                  {hour}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm">:</span>
          <Select value={selectedMinute} onValueChange={handleMinuteChange}>
            <SelectTrigger className="w-16">
              <SelectValue placeholder="Min" />
            </SelectTrigger>
            <SelectContent>
              {minuteIntervals.map((minute) => (
                <SelectItem key={minute} value={minute}>
                  {minute}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}