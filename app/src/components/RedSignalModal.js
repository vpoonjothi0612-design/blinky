import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, Image, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAlert } from "../context/AlertContext";
import COLORS from "../theme/colors";

const RedSignalModal = () => {
  const { activeAlert, isRedSignalActive, dismissAlert } = useAlert();

  if (!isRedSignalActive || !activeAlert) return null;

  return (
    <Modal
      transparent
      animationType="slide"
      visible={isRedSignalActive}
      onRequestClose={dismissAlert}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.sheetCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.sirenBox}>
              <Ionicons name="alert-circle" size={28} color="#ef4444" />
            </View>
            <View style={styles.headerTitles}>
              <Text style={styles.redAlertTitle}>RED SIGNAL ALERT</Text>
              <Text style={styles.redAlertSubtitle}>Unknown Subject Approaching Gate</Text>
            </View>
          </View>

          {/* CCTV Snapshot Frame */}
          <View style={styles.photoFrame}>
            {activeAlert.photoUrl ? (
              <Image
                source={{ uri: activeAlert.photoUrl }}
                style={styles.snapshotImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.placeholderFrame}>
                <Ionicons name="videocam-outline" size={44} color="#64748b" />
                <Text style={styles.placeholderText}>CCTV Security Snapshot</Text>
              </View>
            )}

            <View style={styles.camBadge}>
              <Text style={styles.camBadgeText}>{activeAlert.camera || "CAM-02 (Entrance)"}</Text>
            </View>
          </View>

          {/* Details Card */}
          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Event:</Text>
              <Text style={styles.detailValueRed}>{activeAlert.message || "Unregistered Visitor"}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Gate Location:</Text>
              <Text style={styles.detailValue}>{activeAlert.location || "Main Entrance Gate"}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Detection Time:</Text>
              <Text style={styles.detailValueMono}>{activeAlert.timestamp || "Live"}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Phone Vibration:</Text>
              <View style={styles.vibrateRow}>
                <Ionicons name="phone-portrait" size={13} color="#34d399" />
                <Text style={styles.vibrateStatusText}>ACTIVE (Vibrating)</Text>
              </View>
            </View>
          </View>

          {/* Acknowledge Button */}
          <TouchableOpacity style={styles.ackBtn} onPress={dismissAlert} activeOpacity={0.8}>
            <Ionicons name="checkmark-circle" size={20} color="#ffffff" />
            <Text style={styles.ackBtnText}>Acknowledge & Stop Alert</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 2,
    borderColor: COLORS.danger,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 25,
    elevation: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  sirenBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#fee2e2",
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitles: {
    flex: 1,
  },
  redAlertTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#dc2626",
    letterSpacing: 0.3,
  },
  redAlertSubtitle: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  photoFrame: {
    width: "100%",
    height: 140,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#fca5a5",
    position: "relative",
    marginBottom: 10,
  },
  snapshotImage: {
    width: "100%",
    height: "100%",
  },
  placeholderFrame: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: 10.5,
    color: "#64748b",
    marginTop: 4,
  },
  camBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
  },
  camBadgeText: {
    fontSize: 9.5,
    fontWeight: "700",
    color: COLORS.cyan,
  },
  detailsCard: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    gap: 5,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.text,
  },
  detailValueRed: {
    fontSize: 11,
    fontWeight: "700",
    color: "#dc2626",
  },
  detailValueMono: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.text,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  vibrateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  vibrateStatusText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#34d399",
  },
  ackBtn: {
    backgroundColor: COLORS.danger,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  ackBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
});

export default RedSignalModal;

