import { Platform } from "react-native";

// Automatically resolve backend host whether running on PC localhost, mobile PWA (LAN IP), or native app
const resolveDefaultHost = () => {
  if (typeof window !== "undefined" && window.location && window.location.hostname) {
    const host = window.location.hostname;
    return `http://${host}:3000`;
  }
  // Native Android emulator vs Physical device on Wi-Fi
  if (Platform.OS === "android") {
    return "http://192.168.1.19:3000";
  }
  return "http://192.168.1.19:3000";
};

let currentBaseUrl = `${resolveDefaultHost()}/api`;

export const getBaseUrl = () => currentBaseUrl;

export const setBaseUrl = (newUrl) => {
  if (!newUrl) return;
  let formatted = newUrl.trim().replace(/\/+$/, "");
  if (!formatted.endsWith("/api")) {
    formatted = `${formatted}/api`;
  }
  currentBaseUrl = formatted;
  return currentBaseUrl;
};

export const getImageUrl = (photoPath) => {
  if (!photoPath) return null;
  if (photoPath.startsWith("http://") || photoPath.startsWith("https://") || photoPath.startsWith("data:")) {
    return photoPath;
  }
  const clean = photoPath.replace(/^\/+/, "");
  const host = currentBaseUrl.replace(/\/api$/, "");
  return `${host}/unknown-images/${clean}`;
};

export default {
  getBaseUrl,
  setBaseUrl,
  getImageUrl,
};

