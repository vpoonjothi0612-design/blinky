import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import COLORS from "../theme/colors";

const CreateUserModal = ({ visible, onClose }) => {
  const { createUserByAdmin, loading } = useAuth();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState("STAFF");
  const [statusMsg, setStatusMsg] = useState({ text: "", isError: false });

  const handleCreate = async () => {
    setStatusMsg({ text: "", isError: false });

    if (!username.trim() || !password.trim()) {
      setStatusMsg({ text: "Username and password are required.", isError: true });
      return;
    }

    const res = await createUserByAdmin({
      name: name.trim() || username.trim(),
      username: username.trim(),
      password: password.trim(),
      role: selectedRole,
    });

    if (res.success) {
      setStatusMsg({
        text: `✓ ${selectedRole} user "${username}" created! They can now log in.`,
        isError: false,
      });
      setName("");
      setUsername("");
      setPassword("");
      setTimeout(() => {
        setStatusMsg({ text: "", isError: false });
        onClose();
      }, 1500);
    } else {
      setStatusMsg({ text: res.message, isError: true });
    }
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Ionicons name="person-add" size={20} color={COLORS.cyan} />
              </View>
              <View>
                <Text style={styles.title}>Create Personnel Account</Text>
                <Text style={styles.subtitle}>Admin user provision for Staff & Security</Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Status Alert Banner */}
          {statusMsg.text ? (
            <View
              style={[
                styles.statusBanner,
                statusMsg.isError ? styles.statusBannerErr : styles.statusBannerSuccess,
              ]}
            >
              <Text
                style={[
                  styles.statusBannerText,
                  statusMsg.isError ? { color: "#f87171" } : { color: "#34d399" },
                ]}
              >
                {statusMsg.text}
              </Text>
            </View>
          ) : null}

          {/* Role Picker */}
          <View style={styles.rolePickerSection}>
            <Text style={styles.inputLabel}>SELECT ROLE TO CREATE</Text>
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleTab, selectedRole === "STAFF" && styles.roleTabActiveStaff]}
                onPress={() => setSelectedRole("STAFF")}
                activeOpacity={0.7}
              >
                <Text style={styles.roleTabEmoji}>👔</Text>
                <Text
                  style={[
                    styles.roleTabText,
                    selectedRole === "STAFF" && { color: "#60a5fa", fontWeight: "800" },
                  ]}
                >
                  STAFF
                </Text>
                <Text style={styles.roleTabDesc}>Presence & Reports</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.roleTab, selectedRole === "SECURITY" && styles.roleTabActiveSec]}
                onPress={() => setSelectedRole("SECURITY")}
                activeOpacity={0.7}
              >
                <Text style={styles.roleTabEmoji}>👮</Text>
                <Text
                  style={[
                    styles.roleTabText,
                    selectedRole === "SECURITY" && { color: "#fbbf24", fontWeight: "800" },
                  ]}
                >
                  SECURITY
                </Text>
                <Text style={styles.roleTabDesc}>Gate View Surveillance</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Input Fields */}
          <View style={styles.inputsSection}>
            <View style={styles.inputBox}>
              <Ionicons name="person-outline" size={17} color="#64748b" style={styles.fieldIcon} />
              <TextInput
                style={styles.fieldInput}
                placeholder="Full Name (e.g. Security Officer John)"
                placeholderTextColor="#64748b"
                value={name}
                onChangeText={setName}
              />
            </View>

            <View style={styles.inputBox}>
              <Ionicons name="at-outline" size={17} color="#64748b" style={styles.fieldIcon} />
              <TextInput
                style={styles.fieldInput}
                placeholder="Username (e.g. security1, staff_ops)"
                placeholderTextColor="#64748b"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputBox}>
              <Ionicons name="lock-closed-outline" size={17} color="#64748b" style={styles.fieldIcon} />
              <TextInput
                style={styles.fieldInput}
                placeholder="Password (e.g. pass123)"
                placeholderTextColor="#64748b"
                value={password}
                onChangeText={setPassword}
              />
            </View>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={styles.createBtn}
            onPress={handleCreate}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#ffffff" />
                <Text style={styles.createBtnText}>
                  Create {selectedRole} Account
                </Text>
              </>
            )}
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
  sheetContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderBottomWidth: 0,
    padding: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#e0f2fe",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  closeBtn: {
    padding: 4,
  },
  statusBanner: {
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
  },
  statusBannerSuccess: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
  },
  statusBannerErr: {
    backgroundColor: "#fee2e2",
    borderColor: "#fca5a5",
  },
  statusBannerText: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  rolePickerSection: {
    gap: 5,
  },
  inputLabel: {
    fontSize: 9.5,
    fontWeight: "800",
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  roleRow: {
    flexDirection: "row",
    gap: 8,
  },
  roleTab: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
  },
  roleTabActiveStaff: {
    backgroundColor: "#e0f2fe",
    borderColor: "#0284c7",
  },
  roleTabActiveSec: {
    backgroundColor: "#fef3c7",
    borderColor: "#d97706",
  },
  roleTabEmoji: {
    fontSize: 16,
    marginBottom: 2,
  },
  roleTabText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  roleTabDesc: {
    fontSize: 8.5,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  inputsSection: {
    gap: 8,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 9,
    paddingHorizontal: 10,
    height: 40,
  },
  fieldIcon: {
    marginRight: 8,
  },
  fieldInput: {
    flex: 1,
    fontSize: 11.5,
    color: COLORS.text,
  },
  createBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 10,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 3,
  },
  createBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
});

export default CreateUserModal;

