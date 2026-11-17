import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import {
  getEmployeesApi,
  getAttendancesApi,
  getUnknownFacesApi,
  computeDashboardMetrics,
} from "../services/attendanceService";
import StatCard from "../components/StatCard";
import COLORS from "../theme/colors";

const DashboardScreen = ({ onNavigateTab, active = true }) => {
  const { user, role, logout } = useAuth();

  const [metrics, setMetrics] = useState({
    date: new Date().toISOString().split("T")[0],
    totalEmployees: 0,
    todayPresentCount: 0,
    todayAbsentCount: 0,
    todayInCount: 0,
    todayOutCount: 0,
    unknownCount: 0,
    recentActivity: [],
  });
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [emps, atts, unknowns] = await Promise.all([
        getEmployeesApi(),
        getAttendancesApi(1, 100),
        getUnknownFacesApi(),
      ]);
      const computed = computeDashboardMetrics(emps, atts, unknowns);
      setMetrics(computed);
    } catch (e) {
      console.warn("Dashboard sync error:", e);
    }
  };

  useEffect(() => {
    if (!active) return undefined;
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [active]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.cyan} />
      }
    >
      {/* Welcome Banner */}
      <View style={styles.welcomeBanner}>
        <View style={styles.welcomeRow}>
          <View style={styles.welcomeLeft}>
            <View style={styles.dateRow}>
              <Text style={styles.dateText}>Today: {metrics.date}</Text>
              <Text style={styles.dotSeparator}>•</Text>
              <Text style={styles.modeTag}>
                {role === "ADMIN"
                  ? "👑 Admin Master"
                  : role === "SECURITY"
                  ? "👮 Gate Security Mode"
                  : "👔 Staff Mode"}
              </Text>
            </View>
            <Text style={styles.welcomeTitle}>
              Welcome, {user?.name?.split(" ")[0] || role}
            </Text>
          </View>

          <TouchableOpacity style={styles.logoutPill} onPress={logout} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={13} color="#f87171" />
            <Text style={styles.logoutPillText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 6 Key Attendance & Surveillance Metric Cards */}
      <View style={styles.statGrid}>
        {/* Row 1: Present vs Absent */}
        <View style={styles.statRow}>
          <StatCard
            label="Today Present"
            value={metrics.todayPresentCount}
            subtext={`of ${metrics.totalEmployees} employees`}
            iconName="checkmark-circle"
            iconColor={COLORS.emerald}
            glowColor={COLORS.emerald}
            onPress={() => onNavigateTab("employees")}
          />
          <StatCard
            label="Today Absent"
            value={metrics.todayAbsentCount}
            subtext="Not present today"
            iconName="close-circle-outline"
            iconColor={COLORS.amber}
            glowColor={COLORS.amber}
            onPress={() => onNavigateTab("employees")}
          />
        </View>

        {/* Row 2: Currently IN vs Currently OUT */}
        <View style={styles.statRow}>
          <StatCard
            label="Currently IN"
            value={metrics.todayInCount}
            subtext="Inside facility"
            iconName="log-in"
            iconColor={COLORS.cyan}
            glowColor={COLORS.cyan}
            onPress={() => onNavigateTab("employees")}
          />
          <StatCard
            label="Currently OUT"
            value={metrics.todayOutCount}
            subtext="Exited premises"
            iconName="log-out"
            iconColor={COLORS.rose}
            glowColor={COLORS.rose}
            onPress={() => onNavigateTab("employees")}
          />
        </View>

        {/* Row 3: Unknown Faces vs Total Employees */}
        <View style={styles.statRow}>
          <StatCard
            label="Unknown Faces"
            value={metrics.unknownCount}
            subtext="Unregistered scans"
            iconName="shield-alert"
            iconColor={COLORS.danger}
            glowColor={COLORS.danger}
            onPress={() => onNavigateTab("unknown")}
          />
          <StatCard
            label="Total Employees"
            value={metrics.totalEmployees}
            subtext="Enrolled roster"
            iconName="people"
            iconColor={COLORS.blue}
            glowColor={COLORS.blue}
            onPress={() => onNavigateTab("employees")}
          />
        </View>
      </View>

      {/* CCTV Camera Gate Status Strip */}
      <View style={styles.cameraStrip}>
        <View style={styles.camItem}>
          <View style={[styles.pulseDot, { backgroundColor: COLORS.emerald }]} />
          <Text style={styles.camText}>CAM-02 (IN): 192.168.9.208</Text>
        </View>
        <View style={styles.camItem}>
          <View style={[styles.pulseDot, { backgroundColor: COLORS.cyan }]} />
          <Text style={styles.camText}>CAM-01 (OUT): 192.168.9.207</Text>
        </View>
      </View>

      {/* Live CCTV Gate Activity Stream */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeaderTitle}>Live Gate Activity</Text>
        <TouchableOpacity onPress={() => onNavigateTab("employees")} activeOpacity={0.7}>
          <Text style={styles.viewAllText}>View All ›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.activityList}>
        {metrics.recentActivity.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No punches recorded today.</Text>
          </View>
        ) : (
          metrics.recentActivity.map((item) => (
            <View key={item.id} style={styles.activityItem}>
              <View style={styles.activityLeft}>
                <View style={styles.avatarBox}>
                  <Text style={styles.avatarText}>
                    {item.employeeName.substring(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={styles.empName}>{item.employeeName}</Text>
                  <Text style={styles.empMeta}>
                    {item.employeeCode} • {item.camera}
                  </Text>
                </View>
              </View>

              <View style={styles.activityRight}>
                <View
                  style={[
                    styles.tagBadge,
                    item.eventType === "IN" ? styles.tagIn : styles.tagOut,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      item.eventType === "IN" ? styles.tagInText : styles.tagOutText,
                    ]}
                  >
                    {item.eventType}
                  </Text>
                </View>
                <Text style={styles.timeText}>{item.timeFormatted}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 10,
    paddingBottom: 90,
  },
  welcomeBanner: {
    marginBottom: 7,
  },
  welcomeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  welcomeLeft: {
    flex: 1,
  },
  logoutPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  logoutPillText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#f87171",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dateText: {
    fontSize: 9.5,
    color: COLORS.textMuted,
  },
  dotSeparator: {
    color: COLORS.textMuted,
    fontSize: 9,
  },
  modeTag: {
    fontSize: 9.5,
    fontWeight: "700",
    color: COLORS.cyan,
  },
  welcomeTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.text,
    letterSpacing: -0.3,
    marginTop: 1,
  },
  statGrid: {
    gap: 6,
    marginBottom: 8,
  },
  statRow: {
    flexDirection: "row",
    gap: 6,
  },
  cameraStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  sectionHeaderTitle: {
    fontSize: 10.5,
    fontWeight: "800",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  viewAllText: {
    fontSize: 10.5,
    color: COLORS.cyan,
    fontWeight: "700",
  },
  activityList: {
    gap: 5,
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: {
    fontSize: 10.5,
    color: COLORS.textMuted,
  },
  activityItem: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activityLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatarBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: COLORS.cyan,
  },
  empName: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.text,
  },
  empMeta: {
    fontSize: 9.5,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  activityRight: {
    alignItems: "flex-end",
  },
  tagBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  tagIn: {
    backgroundColor: "#dcfce7",
  },
  tagOut: {
    backgroundColor: "#ffe4e6",
  },
  tagText: {
    fontSize: 8.5,
    fontWeight: "800",
  },
  tagInText: {
    color: "#15803d",
  },
  tagOutText: {
    color: "#be123c",
  },
  timeText: {
    fontSize: 8.5,
    color: COLORS.textMuted,
    marginTop: 2,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
});

export default DashboardScreen;

