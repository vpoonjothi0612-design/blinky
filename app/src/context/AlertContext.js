import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { Vibration, Animated, Platform } from "react-native";
import { useAuth } from "./AuthContext";
import { getUnknownFacesApi, resolveCameraInfo } from "../services/attendanceService";
import { getImageUrl } from "../config/apiConfig";
import { startAlarmRing, stopAlarmRing } from "../services/soundService";

const AlertContext = createContext(null);

export const AlertProvider = ({ children }) => {
  const auth = useAuth();
  const isAuthenticated = auth?.isAuthenticated;

  const [activeAlert, setActiveAlert] = useState(null);
  const [isRedSignalActive, setIsRedSignalActive] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Red signal pulse animation value
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const vibrationInterval = useRef(null);
  const lastKnownUnknownId = useRef(null);

  // Animated pulse loop
  useEffect(() => {
    let animation = null;
    if (isRedSignalActive) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: false,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(0);
    }

    return () => {
      if (animation) animation.stop();
    };
  }, [isRedSignalActive, pulseAnim]);

  // Execute native phone vibration
  const triggerPhoneVibration = useCallback(() => {
    try {
      // Emergency red signal pattern: vibrate 300ms, pause 150ms, vibrate 300ms, pause 150ms, vibrate 600ms
      Vibration.vibrate([300, 150, 300, 150, 600]);
    } catch (e) {
      console.warn("Vibration error:", e);
    }
  }, []);

  // Trigger alert
  const triggerAlert = useCallback(
    (alertData) => {
      setActiveAlert(alertData);
      setIsRedSignalActive(true);
      setUnreadCount((prev) => prev + 1);

      // Trigger initial vibration and mobile alarm ring
      triggerPhoneVibration();
      startAlarmRing();

      // Repeat vibration every 3 seconds until dismissed
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      vibrationInterval.current = setInterval(() => {
        triggerPhoneVibration();
      }, 3000);
    },
    [triggerPhoneVibration]
  );

  // Dismiss alert
  const dismissAlert = useCallback(() => {
    setIsRedSignalActive(false);
    setActiveAlert(null);
    stopAlarmRing();
    if (vibrationInterval.current) {
      clearInterval(vibrationInterval.current);
      vibrationInterval.current = null;
    }
    Vibration.cancel();
  }, []);

  // Manual Trigger for user to test phone vibration and red signal immediately
  const triggerTestAlert = useCallback(() => {
    triggerAlert({
      id: `test-${Date.now()}`,
      title: "SECURITY WARNING: UNKNOWN VISITOR",
      message: "Unregistered subject detected approaching Main Entrance!",
      camera: "CAM-02 (Entrance Gate - 192.168.9.208)",
      location: "Main Entrance Gate",
      photoUrl: null,
      timestamp: new Date().toLocaleTimeString(),
    });
  }, [triggerAlert]);

  // Polling watcher for unknown face arrivals (only runs when authenticated)
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkUnknowns = async () => {
      try {
        const faces = await getUnknownFacesApi();
        if (faces && faces.length > 0) {
          const newest = faces[0];
          if (lastKnownUnknownId.current && newest.id !== lastKnownUnknownId.current) {
            const cam = resolveCameraInfo(newest);
            triggerAlert({
              id: newest.id,
              title: "SECURITY WARNING: UNREGISTERED PERSON",
              message: `Unknown subject detected at ${cam.name}`,
              camera: cam.name,
              location: cam.location,
              photoUrl: getImageUrl(newest.photoUrl),
              timestamp: newest.inTime || new Date(newest.createdAt).toLocaleTimeString(),
            });
          }
          lastKnownUnknownId.current = newest.id;
        }
      } catch {
        // Quiet fail in background poll
      }
    };

    checkUnknowns();
    const interval = setInterval(checkUnknowns, 4000);
    return () => clearInterval(interval);
  }, [isAuthenticated, triggerAlert]);

  return (
    <AlertContext.Provider
      value={{
        activeAlert,
        isRedSignalActive,
        unreadCount,
        pulseAnim,
        triggerAlert,
        dismissAlert,
        triggerTestAlert,
        triggerPhoneVibration,
      }}
    >
      {children}
    </AlertContext.Provider>
  );
};

export const useAlert = () => useContext(AlertContext);

