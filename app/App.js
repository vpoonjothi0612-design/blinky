import React, { useState } from "react";
import { StyleSheet, View, SafeAreaView, StatusBar, Animated, Platform } from "react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { AlertProvider, useAlert } from "./src/context/AlertContext";

import Header from "./src/components/Header";
import BottomNav from "./src/components/BottomNav";
import RedSignalBanner from "./src/components/RedSignalBanner";
import RedSignalModal from "./src/components/RedSignalModal";
import PWAInstallBanner from "./src/components/PWAInstallBanner";

import LoginScreen from "./src/screens/LoginScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import EmployeesScreen from "./src/screens/EmployeesScreen";
import UsersScreen from "./src/screens/UsersScreen";
import UnknownRadarScreen from "./src/screens/UnknownRadarScreen";
import ReportsScreen from "./src/screens/ReportsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import VehiclesScreen from "./src/screens/VehiclesScreen";

import COLORS from "./src/theme/colors";

const MainContent = () => {
  const { isAuthenticated } = useAuth();
  const { isRedSignalActive, pulseAnim } = useAlert();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [visitedTabs, setVisitedTabs] = useState(["dashboard"]);
  const navigateTab = (tab) => {
    setVisitedTabs((current) => current.includes(tab) ? current : [...current, tab]);
    setActiveTab(tab);
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <View style={styles.appContainer}>
          <PWAInstallBanner />
          <LoginScreen />
        </View>
      </SafeAreaView>
    );
  }

  // Animate border color when red signal is active
  const borderColorInterpolation = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#e2e8f0", "#ef4444"],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <Animated.View
        style={[
          styles.appContainer,
          isRedSignalActive && {
            borderColor: borderColorInterpolation,
            borderWidth: 2,
          },
        ]}
      >
        {/* Top Header */}
        <Header onOpenRadar={() => navigateTab("unknown")} />

        {/* PWA Install Banner */}
        <PWAInstallBanner />

        {/* Pulsing Emergency Red Signal Banner */}
        <RedSignalBanner onOpenRadar={() => navigateTab("unknown")} />

        {/* Active Tab Screen */}
        <View style={styles.screenArea}>
          {visitedTabs.includes("dashboard") && <View style={[styles.cachedScreen, activeTab !== "dashboard" && styles.hiddenScreen]}><DashboardScreen active={activeTab === "dashboard"} onNavigateTab={navigateTab} /></View>}
          {visitedTabs.includes("employees") && <View style={[styles.cachedScreen, activeTab !== "employees" && styles.hiddenScreen]}><EmployeesScreen active={activeTab === "employees"} /></View>}
          {visitedTabs.includes("vehicles") && <View style={[styles.cachedScreen, activeTab !== "vehicles" && styles.hiddenScreen]}><VehiclesScreen active={activeTab === "vehicles"} /></View>}
          {visitedTabs.includes("users") && <View style={[styles.cachedScreen, activeTab !== "users" && styles.hiddenScreen]}><UsersScreen active={activeTab === "users"} /></View>}
          {visitedTabs.includes("unknown") && <View style={[styles.cachedScreen, activeTab !== "unknown" && styles.hiddenScreen]}><UnknownRadarScreen active={activeTab === "unknown"} /></View>}
          {visitedTabs.includes("reports") && <View style={[styles.cachedScreen, activeTab !== "reports" && styles.hiddenScreen]}><ReportsScreen active={activeTab === "reports"} /></View>}
          {visitedTabs.includes("profile") && <View style={[styles.cachedScreen, activeTab !== "profile" && styles.hiddenScreen]}><ProfileScreen active={activeTab === "profile"} onNavigateTab={navigateTab} /></View>}
        </View>

        {/* Bottom Navigation */}
        <BottomNav activeTab={activeTab} onSelectTab={navigateTab} />

        {/* Fullscreen / Sheet Red Alert Emergency Modal */}
        <RedSignalModal />
      </Animated.View>
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AlertProvider>
        <MainContent />
      </AlertProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#e2e8f0", // Clean light backdrop on desktop
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
  },
  appContainer: {
    flex: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    backgroundColor: COLORS.background,
    position: "relative",
    overflow: "hidden",
    ...Platform.select({
      web: {
        boxShadow: "0 10px 40px rgba(0, 0, 0, 0.08), 0 0 0 1px #cbd5e1",
      },
      default: {},
    }),
  },
  screenArea: {
    flex: 1,
    overflow: "hidden",
  },
  cachedScreen: { flex: 1 },
  hiddenScreen: { display: "none" },
});

