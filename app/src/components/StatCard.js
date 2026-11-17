import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import COLORS from "../theme/colors";

const StatCard = ({ label, value, subtext, iconName, iconColor, glowColor, onPress }) => {
  return (
    <TouchableOpacity
      style={[styles.card, { borderColor: COLORS.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.glowSphere, { backgroundColor: glowColor }]} />

      <View style={styles.headerRow}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <View style={[styles.iconBox, { backgroundColor: `${iconColor}22` }]}>
          <Ionicons name={iconName} size={13} color={iconColor} />
        </View>
      </View>

      <Text style={[styles.val, { color: iconColor }]}>{value}</Text>
      <Text style={styles.subtext} numberOfLines={1}>
        {subtext}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 11,
    position: "relative",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  glowSphere: {
    position: "absolute",
    top: -15,
    right: -15,
    width: 45,
    height: 45,
    borderRadius: 22,
    opacity: 0.15,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
    flex: 1,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  val: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 1,
  },
  subtext: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});

export default StatCard;
