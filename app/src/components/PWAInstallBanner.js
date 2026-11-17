import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import COLORS from "../theme/colors";

const PWAInstallBanner = () => {
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only applies on Web / PWA platform
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }

    // Check if already running in standalone / installed PWA mode
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator?.standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Check if prompt was already captured
    if (window.deferredPWAInstallPrompt) {
      setCanInstall(true);
    }

    // Listen to custom installable event
    const handleInstallable = () => {
      setCanInstall(true);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setCanInstall(false);
    };

    window.addEventListener("pwa-installable", handleInstallable);
    window.addEventListener("pwa-installed", handleInstalled);

    return () => {
      window.removeEventListener("pwa-installable", handleInstallable);
      window.removeEventListener("pwa-installed", handleInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (typeof window !== "undefined" && window.deferredPWAInstallPrompt) {
      const promptEvent = window.deferredPWAInstallPrompt;
      promptEvent.prompt();
      const choiceResult = await promptEvent.userChoice;
      if (choiceResult.outcome === "accepted") {
        console.log("[PWA] User accepted the install prompt");
        setCanInstall(false);
      }
      window.deferredPWAInstallPrompt = null;
    } else {
      // Fallback instructions for iOS Safari or browsers where prompt event hasn't triggered
      alert(
        "To install on your phone:\n\n• On Android: Tap Chrome menu (⋮) -> 'Install app' or 'Add to Home screen'\n• On iOS: Tap Share icon (⎋) -> 'Add to Home Screen' (+)"
      );
    }
  };

  // Do not show if dismissed, running native, or already running in installed standalone mode
  if (Platform.OS !== "web" || isInstalled || dismissed) {
    return null;
  }

  return (
    <View style={styles.bannerContainer}>
      <View style={styles.bannerLeft}>
        <View style={styles.iconCircle}>
          <Ionicons name="download-outline" size={16} color="#38bdf8" />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.bannerTitle}>Install Mobile App (PWA)</Text>
          <Text style={styles.bannerDesc}>Add to your phone for 1-tap full-screen access</Text>
        </View>
      </View>

      <View style={styles.bannerRight}>
        <TouchableOpacity
          style={styles.installBtn}
          onPress={handleInstallClick}
          activeOpacity={0.8}
        >
          <Ionicons name="phone-portrait-outline" size={13} color="#ffffff" />
          <Text style={styles.installBtnText}>Install</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => setDismissed(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={14} color="#64748b" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f0f9ff",
    borderBottomWidth: 1,
    borderBottomColor: "#bae6fd",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#e0f2fe",
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0369a1",
  },
  bannerDesc: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  bannerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  installBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  installBtnText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  closeBtn: {
    padding: 4,
  },
});

export default PWAInstallBanner;

