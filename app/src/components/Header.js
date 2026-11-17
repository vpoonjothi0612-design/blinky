import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAlert } from "../context/AlertContext";
import COLORS from "../theme/colors";

const Header = ({ onOpenRadar }) => {
  const { role } = useAuth();
  const { unreadCount, isRedSignalActive, triggerTestAlert } = useAlert();

  const getRoleBadgeStyle = () => {
    if (role === "ADMIN") {
      return { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" };
    }
    if (role === "SECURITY") {
      return { bg: "#fef3c7", text: "#b45309", border: "#fde68a" };
    }
    return { bg: "#e0f2fe", text: "#0369a1", border: "#bae6fd" };
  };

  const badge = getRoleBadgeStyle();

  return (
    <View style={styles.headerContainer}>
      {/* Brand Section */}
      <View style={styles.brandRow}>
        <View style={styles.brandIconBox}>
          <Ionicons name="scan" size={15} color="#ffffff" />
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.brandTitle}>Face Detection</Text>
          <View style={styles.liveTag}>
            <View style={styles.pulseDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>
      </View>

      {/* Header Actions */}
      <View style={styles.actionsRow}>
        {/* Role Badge */}
        <View style={[styles.roleBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
          <Text style={[styles.roleText, { color: badge.text }]}>{role}</Text>
        </View>

        {/* Quick Test Alert & Vibration Button */}
        <TouchableOpacity
          style={[styles.actionBtn, isRedSignalActive && { borderColor: COLORS.danger }]}
          onPress={triggerTestAlert}
          activeOpacity={0.7}
        >
          <Ionicons
            name="warning"
            size={14}
            color={isRedSignalActive ? COLORS.danger : COLORS.amber}
          />
        </TouchableOpacity>

        {/* Radar Bell */}
        <TouchableOpacity style={styles.actionBtn} onPress={onOpenRadar} activeOpacity={0.7}>
          <Ionicons name="notifications" size={14} color={COLORS.text} />
          {unreadCount > 0 && (
            <View style={styles.badgeCount}>
              <Text style={styles.badgeCountText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  brandIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#0284c7",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  brandTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0f172a",
    letterSpacing: -0.2,
  },
  liveTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#dcfce7",
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    gap: 3,
  },
  pulseDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#16a34a",
  },
  liveText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#15803d",
    letterSpacing: 0.3,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badgeCount: {
    position: "absolute",
    top: -3,
    right: -3,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 0.5,
  },
  badgeCountText: {
    color: "#ffffff",
    fontSize: 8,
    fontWeight: "800",
  },
});

export default Header;
