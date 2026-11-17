import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import COLORS from "../theme/colors";

const BottomNav = ({ activeTab, onSelectTab }) => {
  const { role } = useAuth();
  const isSecurity = role === "SECURITY";

  return (
    <View style={styles.navBar}>
      {/* 1. Dashboard */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => onSelectTab("dashboard")}
        activeOpacity={0.7}
      >
        <View style={[styles.iconBox, activeTab === "dashboard" && styles.activeIconBox]}>
          <Ionicons
            name={activeTab === "dashboard" ? "grid" : "grid-outline"}
            size={17}
            color={activeTab === "dashboard" ? COLORS.cyan : COLORS.textMuted}
          />
        </View>
        <Text style={[styles.navLabel, activeTab === "dashboard" && styles.activeNavLabel]}>
          Overview
        </Text>
      </TouchableOpacity>

      {/* 2. Employees */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => onSelectTab("employees")}
        activeOpacity={0.7}
      >
        <View style={[styles.iconBox, activeTab === "employees" && styles.activeIconBox]}>
          <Ionicons
            name={activeTab === "employees" ? "people" : "people-outline"}
            size={17}
            color={activeTab === "employees" ? COLORS.cyan : COLORS.textMuted}
          />
        </View>
        <Text style={[styles.navLabel, activeTab === "employees" && styles.activeNavLabel]}>
          Employees
        </Text>
      </TouchableOpacity>

      {/* 3. Staff & Security Users */}
      <TouchableOpacity style={styles.navItem} onPress={() => onSelectTab("vehicles")} activeOpacity={0.7}>
        <View style={[styles.iconBox, activeTab === "vehicles" && styles.activeIconBox]}>
          <Ionicons name={activeTab === "vehicles" ? "car" : "car-outline"} size={17} color={activeTab === "vehicles" ? COLORS.cyan : COLORS.textMuted} />
        </View>
        <Text style={[styles.navLabel, activeTab === "vehicles" && styles.activeNavLabel]}>Vehicles</Text>
      </TouchableOpacity>

      {/* 3. Staff & Security Users */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => onSelectTab("users")}
        activeOpacity={0.7}
      >
        <View style={[styles.iconBox, activeTab === "users" && styles.activeIconBox]}>
          <Ionicons
            name={activeTab === "users" ? "people-circle" : "people-circle-outline"}
            size={18}
            color={activeTab === "users" ? COLORS.cyan : COLORS.textMuted}
          />
        </View>
        <Text style={[styles.navLabel, activeTab === "users" && styles.activeNavLabel]}>
          Users
        </Text>
      </TouchableOpacity>

      {/* 4. Reports (Visible for Admin and Staff) */}
      {!isSecurity && (
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => onSelectTab("reports")}
          activeOpacity={0.7}
        >
          <View style={[styles.iconBox, activeTab === "reports" && styles.activeIconBox]}>
            <Ionicons
              name={activeTab === "reports" ? "bar-chart" : "bar-chart-outline"}
              size={17}
              color={activeTab === "reports" ? COLORS.cyan : COLORS.textMuted}
            />
          </View>
          <Text style={[styles.navLabel, activeTab === "reports" && styles.activeNavLabel]}>
            Reports
          </Text>
        </TouchableOpacity>
      )}

      {/* 5. Profile */}
      <TouchableOpacity
        style={styles.navItem}
        onPress={() => onSelectTab("profile")}
        activeOpacity={0.7}
      >
        <View style={[styles.iconBox, activeTab === "profile" && styles.activeIconBox]}>
          <Ionicons
            name={activeTab === "profile" ? "person-circle" : "person-circle-outline"}
            size={17}
            color={activeTab === "profile" ? COLORS.cyan : COLORS.textMuted}
          />
        </View>
        <Text style={[styles.navLabel, activeTab === "profile" && styles.activeNavLabel]}>
          Settings
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 6,
    paddingBottom: Platform.OS === "ios" ? 18 : 8,
    minHeight: 52,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
  },
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  activeIconBox: {
    backgroundColor: "#e0f2fe",
  },
  navLabel: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "#64748b",
    marginTop: 2,
    textAlign: "center",
  },
  activeNavLabel: {
    color: "#0284c7",
    fontWeight: "800",
  },
});

export default BottomNav;
