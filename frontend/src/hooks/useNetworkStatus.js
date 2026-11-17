import { useState, useEffect } from 'react';

/**
 * Custom React hook for monitoring browser online/offline status.
 *
 * @returns {{
 *   isOnline: boolean,
 *   wasOffline: boolean,
 *   setWasOffline: React.Dispatch<React.SetStateAction<boolean>>
 * }}
 */
export const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      return navigator.onLine;
    }
    return true;
  });

  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline((prevOnline) => {
        if (!prevOnline) {
          // Transitioned from offline to online: trigger reconnection notification
          setWasOffline(true);
          return true;
        }
        return prevOnline;
      });
    };

    const handleOffline = () => {
      setIsOnline((prevOnline) => {
        if (prevOnline) {
          return false;
        }
        return prevOnline;
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    isOnline,
    wasOffline,
    setWasOffline,
  };
};

export default useNetworkStatus;

