import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
  Modal,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAlert } from "../context/AlertContext";
import { getUnknownFacesApi, resolveCameraInfo } from "../services/attendanceService";
import { getImageUrl } from "../config/apiConfig";
import COLORS from "../theme/colors";

const UnknownRadarScreen = ({ active = true }) => {
  const { triggerTestAlert } = useAlert();
  const [faces, setFaces] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState(null);

  const loadFaces = async () => {
    try {
      const data = await getUnknownFacesApi();
      setFaces(data);
    } catch (e) {
      console.warn("Failed to load unknown faces:", e);
    }
  };

  useEffect(() => {
    if (!active) return undefined;
    loadFaces();
    const interval = setInterval(loadFaces, 15000);
    return () => clearInterval(interval);
  }, [active]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFaces();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Security Radar Feed</Text>
          <Text style={styles.subtitle}>Unregistered CCTV Face Surveillance</Text>
        </View>

        <TouchableOpacity
          style={styles.testAlertBtn}
          onPress={triggerTestAlert}
          activeOpacity={0.8}
        >
          <Ionicons name="phone-portrait-outline" size={13} color="#ffffff" />
          <Text style={styles.testAlertBtnText}>Test Alert</Text>
        </TouchableOpacity>
      </View>

      {/* 24/7 Red Signal Guard Banner */}
      <View style={styles.guardBanner}>
        <View style={styles.guardIconBox}>
          <Ionicons name="radio" size={20} color={COLORS.danger} />
        </View>
        <View style={styles.guardTextCol}>
          <Text style={styles.guardTitle}>24/7 Red Signal Pulse Guard Active</Text>
          <Text style={styles.guardDesc}>
            Instant phone vibration & red signal flashing triggered whenever an unknown face is detected.
          </Text>
        </View>
      </View>

      {/* Captured Faces List */}
      <ScrollView
        style={styles.listContainer}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.danger} />
        }
      >
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            Unregistered Captures ({faces.length})
          </Text>
        </View>

        {faces.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="shield-checkmark-outline" size={36} color={COLORS.emerald} />
            <Text style={styles.emptyText}>No unregistered faces detected.</Text>
            <Text style={styles.emptySubtext}>Perimeter secure.</Text>
          </View>
        ) : (
          faces.map((face) => {
            const cam = resolveCameraInfo(face);
            const photoUrl = getImageUrl(face.photoUrl);
            const notes =
              typeof face.notes === "string"
                ? (() => {
                    try {
                      return JSON.parse(face.notes);
                    } catch {
                      return {};
                    }
                  })()
                : face.notes || {};
            const scanCount = notes.detectionCount || notes.visitCount || 1;

            return (
              <View key={face.id} style={styles.faceCard}>
                {/* Photo Thumbnail */}
                <TouchableOpacity
                  style={styles.thumbFrame}
                  onPress={() => photoUrl && setPreviewPhoto(photoUrl)}
                  activeOpacity={0.8}
                >
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.thumbImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.placeholderThumb}>
                      <Ionicons name="camera-outline" size={24} color="#64748b" />
                    </View>
                  )}
                  <View style={styles.zoomBadge}>
                    <Ionicons name="eye" size={10} color={COLORS.cyan} />
                  </View>
                </TouchableOpacity>

                {/* Details */}
                <View style={styles.faceInfo}>
                  <View style={styles.faceTopRow}>
                    <Text style={styles.subjectName}>
                      {face.personName || "Unregistered Visitor"}
                    </Text>
                    <View style={styles.scanCountBadge}>
                      <Text style={styles.scanCountText}>
                        {scanCount} SCAN{scanCount > 1 ? "S" : ""}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.camRow}>
                    <Ionicons name="location-outline" size={12} color={COLORS.cyan} />
                    <Text style={styles.camLocationText}>{cam.name}</Text>
                  </View>

                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>Detected:</Text>
                    <Text style={styles.timeValueMono}>
                      {face.inTime ||
                        (face.createdAt ? new Date(face.createdAt).toLocaleTimeString() : "Recent")}
                    </Text>
                    <Text style={styles.dot}>•</Text>
                    <Text style={styles.dateText}>{face.entryDate || "Today"}</Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Snapshot Lightbox Modal */}
      {previewPhoto && (
        <Modal transparent animationType="fade" visible={!!previewPhoto} onRequestClose={() => setPreviewPhoto(null)}>
          <TouchableOpacity
            style={styles.lightboxBackdrop}
            activeOpacity={1}
            onPress={() => setPreviewPhoto(null)}
          >
            <View style={styles.lightboxContent}>
              <Image source={{ uri: previewPhoto }} style={styles.lightboxImage} resizeMode="contain" />
              <Text style={styles.lightboxHelp}>Tap anywhere to close snapshot</Text>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 8,
    marginBottom: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  testAlertBtn: {
    backgroundColor: COLORS.danger,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 7,
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  testAlertBtnText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },
  guardBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    padding: 7,
    marginHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 7,
  },
  guardIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    alignItems: "center",
    justifyContent: "center",
  },
  guardTextCol: {
    flex: 1,
  },
  guardTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#b91c1c",
  },
  guardDesc: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 14,
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 90,
    gap: 6,
  },
  sectionTitleRow: {
    marginBottom: 3,
  },
  sectionTitle: {
    fontSize: 10.5,
    fontWeight: "800",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 20,
    alignItems: "center",
    gap: 6,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.text,
  },
  emptySubtext: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  faceCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 8,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  thumbFrame: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: COLORS.border,
    position: "relative",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  placeholderThumb: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 4,
    padding: 2,
  },
  faceInfo: {
    flex: 1,
  },
  faceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  subjectName: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
  },
  scanCountBadge: {
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  scanCountText: {
    color: "#b91c1c",
    fontSize: 9,
    fontWeight: "800",
  },
  camRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  camLocationText: {
    fontSize: 11,
    color: COLORS.cyan,
    fontWeight: "600",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  timeValueMono: {
    fontSize: 10,
    color: COLORS.text,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  dot: {
    fontSize: 9,
    color: COLORS.textMuted,
  },
  dateText: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  lightboxContent: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
  },
  lightboxImage: {
    width: "100%",
    height: 320,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.cyan,
  },
  lightboxHelp: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 12,
  },
});

export default UnknownRadarScreen;

