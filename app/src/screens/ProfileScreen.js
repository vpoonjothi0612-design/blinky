import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAlert } from "../context/AlertContext";
import { getBaseUrl, setBaseUrl } from "../config/apiConfig";
import CreateUserModal from "../components/CreateUserModal";
import COLORS from "../theme/colors";

const ProfileScreen = ({ onNavigateTab }) => {
  const { user, role, managedUsers, deleteManagedUser, logout } = useAuth();
  const { triggerPhoneVibration, triggerTestAlert } = useAlert();

  const [vibrateSuccess, setVibrateSuccess] = useState(false);
  const [showServerInput, setShowServerInput] = useState(false);
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleTestVibrate = () => {
    triggerPhoneVibration();
    setVibrateSuccess(true);
    setTimeout(() => setVibrateSuccess(false), 2000);
  };

  const handleSaveUrl = () => {
    setBaseUrl(serverUrl);
    setShowServerInput(false);
  };

  const isAdmin = role === "ADMIN";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.headerBox}>
        <Text style={styles.title}>Settings & Personnel</Text>
        <Text style={styles.subtitle}>Session management, user administration & hardware</Text>
      </View>

      {/* User Info Card */}
      <View style={styles.userCard}>
        <View style={styles.avatarBox}>
          <Text style={styles.avatarText}>
            {user?.name?.substring(0, 2).toUpperCase() || "VG"}
          </Text>
        </View>

        <View style={styles.userCol}>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View
            style={[
              styles.roleTag,
              role === "ADMIN"
                ? styles.roleTagAdmin
                : role === "SECURITY"
                ? styles.roleTagSec
                : styles.roleTagStaff,
            ]}
          >
            <Text
              style={[
                styles.roleTagText,
                role === "ADMIN"
                  ? { color: "#f87171" }
                  : role === "SECURITY"
                  ? { color: "#fbbf24" }
                  : { color: "#60a5fa" },
              ]}
            >
              ACTIVE ROLE: {role}
            </Text>
          </View>
        </View>
      </View>

      {/* ADMIN EXCLUSIVE: Staff & Security User Management Shortcut */}
      {isAdmin && (
        <View style={styles.adminSection}>
          <View style={styles.adminSectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="people" size={17} color={COLORS.cyan} />
              <Text style={styles.adminSectionTitle}>Staff & Security Users</Text>
            </View>
            <View style={styles.adminOnlyPill}>
              <Text style={styles.adminOnlyText}>{managedUsers.length} ACTIVE</Text>
            </View>
          </View>

          <Text style={styles.sectionDesc}>
            Provision and manage access credentials for Staff and Gate Security personnel via the dedicated Users tab.
          </Text>

          {onNavigateTab ? (
            <TouchableOpacity
              style={styles.createUserBtn}
              onPress={() => onNavigateTab("users")}
              activeOpacity={0.8}
            >
              <Ionicons name="people-circle" size={16} color="#ffffff" />
              <Text style={styles.createUserBtnText}>Open Users Management Tab →</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Hardware & Emergency Controls */}
      <View style={styles.settingsSection}>
        <View style={styles.sectionHeaderRow}>
          <Ionicons name="hardware-chip-outline" size={16} color={COLORS.cyan} />
          <Text style={styles.sectionHeaderTitle}>Hardware & Red Alert Controls</Text>
        </View>

        {/* Test Phone Vibration */}
        <View style={styles.settingItemRow}>
          <View style={styles.settingItemLeft}>
            <Ionicons name="phone-portrait-outline" size={18} color={COLORS.cyan} />
            <View>
              <Text style={styles.settingItemName}>Phone Vibration Engine</Text>
              <Text style={styles.settingItemDesc}>React Native Vibration API</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.smallActionBtn, vibrateSuccess && styles.smallActionBtnSuccess]}
            onPress={handleTestVibrate}
            activeOpacity={0.8}
          >
            <Text style={styles.smallActionBtnText}>
              {vibrateSuccess ? "📳 Vibrated!" : "Vibrate Phone"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.itemDivider} />

        {/* Test Red Signal Emergency Modal */}
        <View style={styles.settingItemRow}>
          <View style={styles.settingItemLeft}>
            <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
            <View>
              <Text style={styles.settingItemName}>Simulate Unknown Entry</Text>
              <Text style={styles.settingItemDesc}>Flashes red signal + vibrates phone</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.smallActionBtn, { backgroundColor: COLORS.danger, borderColor: COLORS.danger }]}
            onPress={triggerTestAlert}
            activeOpacity={0.8}
          >
            <Text style={styles.smallActionBtnText}>Trigger Alert</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Backend Host Configuration */}
      <View style={styles.settingsSection}>
        <View style={styles.sectionHeaderRow}>
          <Ionicons name="server-outline" size={16} color={COLORS.cyan} />
          <Text style={styles.sectionHeaderTitle}>Backend API Host</Text>
        </View>
        <Text style={styles.sectionDesc}>
          Current: <Text style={styles.codeText}>{getBaseUrl()}</Text>
        </Text>

        {!showServerInput ? (
          <TouchableOpacity
            style={styles.changeIpBtn}
            onPress={() => setShowServerInput(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.changeIpBtnText}>Change Host / IP Address</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.ipInputRow}>
            <TextInput
              style={styles.ipInput}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.1.19:3000/api"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.ipSaveBtn} onPress={handleSaveUrl}>
              <Text style={styles.ipSaveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color={COLORS.rose} />
        <Text style={styles.logoutBtnText}>Sign Out of Mobile App</Text>
      </TouchableOpacity>

      {/* Modal for Creating User */}
      <CreateUserModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
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
  userCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#0284c7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#ffffff",
  },
  userCol: {
    flex: 1,
  },
  userName: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
  },
  userEmail: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  roleTag: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginTop: 4,
  },
  roleTagAdmin: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  roleTagStaff: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
  },
  roleTagSec: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  roleTagText: {
    fontSize: 9,
    fontWeight: "800",
  },
  adminSection: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  adminSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  adminSectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.text,
  },
  adminOnlyPill: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  adminOnlyText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#f87171",
  },
  sectionDesc: {
    fontSize: 11,
    color: COLORS.textMuted,
    lineHeight: 16,
  },
  createUserBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 3,
  },
  createUserBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  usersListContainer: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  usersListTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.textMuted,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  userRowItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  userRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  userRowEmoji: {
    fontSize: 16,
  },
  userRowName: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.text,
  },
  userRowUsername: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  userRowUsernameBold: {
    color: COLORS.cyan,
    fontWeight: "700",
  },
  userRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  smallRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  smallRoleAdmin: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  smallRoleStaff: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
  },
  smallRoleSec: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  smallRoleText: {
    fontSize: 9,
    fontWeight: "800",
  },
  trashBtn: {
    padding: 4,
  },
  settingsSection: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
  },
  settingItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  settingItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  settingItemName: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.text,
  },
  settingItemDesc: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  smallActionBtn: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  smallActionBtnSuccess: {
    backgroundColor: COLORS.emerald,
    borderColor: COLORS.emerald,
  },
  smallActionBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
  },
  itemDivider: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  codeText: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    color: COLORS.cyan,
  },
  changeIpBtn: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  changeIpBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.cyan,
  },
  ipInputRow: {
    flexDirection: "row",
    gap: 8,
  },
  ipInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    color: COLORS.text,
    fontSize: 11,
  },
  ipSaveBtn: {
    backgroundColor: COLORS.cyan,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  ipSaveBtnText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  logoutBtn: {
    backgroundColor: "rgba(244, 63, 94, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.3)",
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutBtnText: {
    color: COLORS.rose,
    fontSize: 13,
    fontWeight: "800",
  },
});

export default ProfileScreen;
