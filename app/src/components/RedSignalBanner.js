import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAlert } from "../context/AlertContext";
import COLORS from "../theme/colors";

const RedSignalBanner = ({ onOpenRadar }) => {
  const { isRedSignalActive, pulseAnim } = useAlert();

  if (!isRedSignalActive) return null;

  const bgInterpolation = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#b91c1c", "#ef4444"],
  });

  return (
    <Animated.View style={[styles.bannerContainer, { backgroundColor: bgInterpolation }]}>
      <TouchableOpacity
        style={styles.contentRow}
        onPress={onOpenRadar}
        activeOpacity={0.8}
      >
        <View style={styles.leftCol}>
          <Ionicons name="warning" size={18} color="#ffffff" />
          <Text style={styles.bannerText}>RED SIGNAL: UNKNOWN PERSON AT GATE</Text>
        </View>

        <View style={styles.vibratePill}>
          <Ionicons name="phone-portrait-outline" size={12} color="#ffffff" />
          <Text style={styles.vibrateText}>VIBRATING</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  leftCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bannerText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  vibratePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  vibrateText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "800",
  },
});

export default RedSignalBanner;

