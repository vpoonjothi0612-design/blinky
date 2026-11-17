import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import {
  getEmployeesApi,
  getAttendancesApi,
  computeDashboardMetrics,
} from "../services/attendanceService";
import COLORS from "../theme/colors";

const ReportsScreen = () => {
  const { role } = useAuth();
  const [metrics, setMetrics] = useState({
    totalEmployees: 0,
    todayPresentCount: 0,
    todayInCount: 0,
    todayOutCount: 0,
  });
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [emps, atts] = await Promise.all([
        getEmployeesApi(),
        getAttendancesApi(1, 100),
      ]);
      const computed = computeDashboardMetrics(emps, atts, []);
      setMetrics(computed);
    } catch (e) {
      console.warn("Reports load error:", e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Security Role Protection
  if (role === "SECURITY") {
    return (
      <View style={styles.restrictedContainer}>
        <View style={styles.lockBox}>
          <Ionicons name="lock-closed" size={32} color={COLORS.amber} />
        </View>
        <Text style={styles.restrictedTitle}>Gate Security Guard Mode</Text>
        <Text style={styles.restrictedDesc}>
          Executive attendance analytics and administrative reports are restricted to Admin and Staff roles.
        </Text>
        <Text style={styles.restrictedHelp}>
          Use the Employees tab and Radar tab for real-time gate surveillance.
        </Text>
      </View>
    );
  }

  const total = metrics.totalEmployees || 1;
  const present = metrics.todayPresentCount || 0;
  const absent = Math.max(0, total - present);
  const rate = Math.round((present / total) * 100);

  // Mock past 5 days weekly trend for visualization
  const weeklyTrends = [
    { day: "Mon", rate: 85, present: 3 },
    { day: "Tue", rate: 100, present: 3 },
    { day: "Wed", rate: 70, present: 2 },
    { day: "Thu", rate: 100, present: 3 },
    { day: "Today", rate: rate, present: present },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.cyan} />
      }
    >
      <View style={styles.headerBox}>
        <Text style={styles.title}>Overall Attendance Reports</Text>
        <Text style={styles.subtitle}>Facility metrics, presence percentage & audit</Text>
      </View>

      {/* Today's Attendance Rate Card */}
      <View style={styles.reportCard}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardHeaderTitle}>Today's Presence Rate</Text>
          <View style={styles.rateBadge}>
            <Text style={styles.rateBadgeText}>{rate}% RATE</Text>
          </View>
        </View>

        {/* Visual Progress Bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(5, rate)}%` }]} />
        </View>

        <View style={styles.statSplitRow}>
          <View style={styles.statBoxPresent}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.emerald} />
            <View>
              <Text style={styles.statLabel}>Present</Text>
              <Text style={[styles.statVal, { color: COLORS.emerald }]}>{present}</Text>
            </View>
          </View>

          <View style={styles.statBoxAbsent}>
            <Ionicons name="close-circle" size={18} color={COLORS.rose} />
            <View>
              <Text style={styles.statLabel}>Absent</Text>
              <Text style={[styles.statVal, { color: COLORS.rose }]}>{absent}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Weekly Trend Bar Chart */}
      <View style={styles.reportCard}>
        <View style={styles.trendHeader}>
          <Ionicons name="trending-up" size={18} color={COLORS.cyan} />
          <Text style={styles.trendTitle}>Daily Attendance Trend</Text>
        </View>

        <View style={styles.chartContainer}>
          {weeklyTrends.map((item, idx) => (
            <View key={idx} style={styles.barCol}>
              <Text style={styles.barTopVal}>{item.present}</Text>
              <View style={[styles.barFill, { height: `${Math.max(15, item.rate)}%` }]} />
              <Text style={styles.barLabel}>{item.day}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* CCTV Audit Summary */}
      <View style={styles.auditCard}>
        <Text style={styles.auditTitle}>Automated CCTV Audit Summary:</Text>
        <Text style={styles.auditText}>• Entrance Gate (CAM-02): 192.168.9.208 monitoring arrivals.</Text>
        <Text style={styles.auditText}>• Exit Gate (CAM-01): 192.168.9.207 logging turnstile exits.</Text>
        <Text style={styles.auditText}>• Unregistered visitor detections automatically broadcast to guard mobile phones.</Text>
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
    gap: 8,
  },
  headerBox: {
    marginBottom: 2,
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
  reportCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 10,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardHeaderTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: COLORS.text,
  },
  rateBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  rateBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.emerald,
  },
  progressTrack: {
    width: "100%",
    height: 6,
    backgroundColor: "#e2e8f0",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 10,
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.emerald,
    borderRadius: 3,
  },
  statSplitRow: {
    flexDirection: "row",
    gap: 8,
  },
  statBoxPresent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    padding: 8,
    borderRadius: 8,
  },
  statBoxAbsent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(244, 63, 94, 0.08)",
    padding: 8,
    borderRadius: 8,
  },
  statLabel: {
    fontSize: 9.5,
    color: COLORS.textMuted,
  },
  statVal: {
    fontSize: 15,
    fontWeight: "900",
  },
  trendHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  trendTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: COLORS.text,
  },
  chartContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: 85,
    paddingBottom: 4,
  },
  barCol: {
    alignItems: "center",
    flex: 1,
    height: "100%",
    justifyContent: "flex-end",
    gap: 4,
  },
  barTopVal: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.cyan,
  },
  barFill: {
    width: 18,
    backgroundColor: "#0284c7",
    borderRadius: 4,
  },
  barLabel: {
    fontSize: 9,
    color: COLORS.textMuted,
  },
  auditCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  auditTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 4,
  },
  auditText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  restrictedContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    backgroundColor: COLORS.background,
  },
  lockBox: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  restrictedTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 8,
  },
  restrictedDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
  restrictedHelp: {
    fontSize: 12,
    color: COLORS.cyan,
    textAlign: "center",
    marginTop: 16,
  },
});

export default ReportsScreen;

