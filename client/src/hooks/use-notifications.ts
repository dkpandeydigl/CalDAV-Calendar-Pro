import { useNotifications as useNotificationsFromContext } from '@/contexts/NotificationContext';

const useNotifications = () => {
  return useNotificationsFromContext();
};

export default useNotifications;