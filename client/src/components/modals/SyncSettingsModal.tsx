import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import SyncSettings from '../SyncSettings';

interface SyncSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SyncSettingsModal({ open, onClose }: SyncSettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Synchronization Settings</DialogTitle>
          <DialogDescription>
            Configure how your calendars synchronize with the CalDAV server
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <SyncSettings />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SyncSettingsModal;