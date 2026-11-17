import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Modal,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import COLORS from "../theme/colors";

const UsersScreen = () => {
  const {
    role: currentRole,
    managedUsers,
    createUserByAdmin,
    deleteManagedUser,
    syncBackendUsers,
  } = useAuth();

  // Screen state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL"); // "ALL", "STAFF", "SECURITY", "ADMIN"
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Modal: Create User Bottom Sheet
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState("STAFF"); // "STAFF" or "SECURITY"
  const [showPassword, setShowPassword] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Modal: User Details & Delete Confirmation
  const [selectedUserDetail, setSelectedUserDetail] = useState(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Auto-sync users on mount
  useEffect(() => {
    syncBackendUsers();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await syncBackendUsers();
    setRefreshing(false);
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return managedUsers.filter((u) => {
      // 1. Role filter
      if (roleFilter !== "ALL" && u.role !== roleFilter) {
        return false;
      }
      // 2. Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matches =
          (u.name || "").toLowerCase().includes(q) ||
          (u.username || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.role || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [managedUsers, roleFilter, search]);

  // Statistics counts
  const counts = useMemo(() => {
    return {
      total: managedUsers.length,
      staff: managedUsers.filter((u) => u.role === "STAFF").length,
      security: managedUsers.filter((u) => u.role === "SECURITY").length,
      admin: managedUsers.filter((u) => u.role === "ADMIN").length,
    };
  }, [managedUsers]);

  // Create user handler
  const handleCreateUser = async () => {
    setFormError("");

    if (!formUsername.trim()) {
      setFormError("Username is required.");
      return;
    }
    if (!formPassword.trim()) {
      setFormError("Password is required.");
      return;
    }

    setFormSubmitting(true);
    try {
      const res = await createUserByAdmin({
        name: formName.trim() || formUsername.trim(),
        username: formUsername.trim(),
        password: formPassword.trim(),
        role: formRole,
      });

      if (res.success) {
        showToast(`✓ ${formRole} user "${formUsername.trim()}" created successfully!`);
        setFormName("");
        setFormUsername("");
        setFormPassword("");
        setShowCreateModal(false);
      } else {
        setFormError(res.message || "Failed to create user");
      }
    } catch (err) {
      setFormError(err.message || "Error creating user account");
    } finally {
      setFormSubmitting(false);
    }
  };

  // Quick preset helper
  const applyPreset = (presetRole, suffix) => {
    setFormRole(presetRole);
    setFormUsername(`${presetRole.toLowerCase()}_${suffix}`);
    setFormName(`${presetRole === "STAFF" ? "Staff" : "Security Guard"} ${suffix}`);
    setFormPassword(`${presetRole.toLowerCase()}123`);
  };

  // Delete user handler
  const handleConfirmDelete = async () => {
    if (!deleteTargetUser) return;
    setIsDeleting(true);
    try {
      await deleteManagedUser(deleteTargetUser.id);
      showToast(`User @${deleteTargetUser.username} deleted.`);
      setDeleteTargetUser(null);
      setSelectedUserDetail(null);
    } catch (e) {
      showToast("Failed to delete user account.");
    } finally {
      setIsDeleting(false);
    }
  };

  const getRoleStyle = (r) => {
    if (r === "ADMIN") {
      return {
        bg: "#fee2e2",
        border: "#fecaca",
        text: "#b91c1c",
        label: "ADMIN",
        icon: "key",
      };
    }
    if (r === "SECURITY") {
      return {
        bg: "#fef3c7",
        border: "#fde68a",
        text: "#b45309",
        label: "SECURITY",
        icon: "shield-checkmark",
      };
    }
    return {
      bg: "#e0f2fe",
      border: "#bae6fd",
      text: "#0369a1",
      label: "STAFF",
      icon: "briefcase",
    };
  };

  return (
    <View style={styles.container}>
      {/* Toast Banner */}
      {toastMessage && (
        <View style={styles.toastBanner}>
          <Ionicons name="checkmark-circle" size={16} color="#38bdf8" />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* Main Scrollable Screen */}
      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.cyan}
            colors={[COLORS.cyan]}
          />
        }
      >
        {/* Header Bar */}
        <View style={styles.headerBar}>
          <View style={styles.headerTitleBox}>
            <Text style={styles.pageTitle}>User Accounts</Text>
            <Text style={styles.pageSubtitle}>
              Staff & Security Personnel ({counts.total})
            </Text>
          </View>

          <TouchableOpacity
            style={styles.createBtnHeader}
            onPress={() => {
              setFormError("");
              setShowCreateModal(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="person-add" size={13} color="#ffffff" />
            <Text style={styles.createBtnHeaderText}>+ Create User</Text>
          </TouchableOpacity>
        </View>

        {/* Search & Filter Toolbar */}
        <View style={styles.filterToolbarCard}>
          {/* Search Input */}
          <View style={styles.searchRow}>
            <Ionicons name="search" size={15} color="#64748b" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by username, name or role..."
              placeholderTextColor="#64748b"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")} style={styles.searchClearBtn}>
                <Ionicons name="close-circle" size={15} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Role Filter Chips */}
          <View style={styles.roleChipsRow}>
            <TouchableOpacity
              style={[styles.roleChip, roleFilter === "ALL" && styles.roleChipActiveCyan]}
              onPress={() => setRoleFilter("ALL")}
            >
              <Text style={[styles.roleChipText, roleFilter === "ALL" && styles.roleChipTextActive]}>
                All ({counts.total})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleChip, roleFilter === "STAFF" && styles.roleChipActiveBlue]}
              onPress={() => setRoleFilter("STAFF")}
            >
              <Text style={[styles.roleChipText, roleFilter === "STAFF" && styles.roleChipTextActive]}>
                👔 Staff ({counts.staff})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleChip, roleFilter === "SECURITY" && styles.roleChipActiveAmber]}
              onPress={() => setRoleFilter("SECURITY")}
            >
              <Text style={[styles.roleChipText, roleFilter === "SECURITY" && styles.roleChipTextActive]}>
                👮 Security ({counts.security})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleChip, roleFilter === "ADMIN" && styles.roleChipActiveRed]}
              onPress={() => setRoleFilter("ADMIN")}
            >
              <Text style={[styles.roleChipText, roleFilter === "ADMIN" && styles.roleChipTextActive]}>
                👑 Admin ({counts.admin})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Active Filter Clear Bar */}
          {(search.trim() !== "" || roleFilter !== "ALL") && (
            <View style={styles.filterStatusRow}>
              <Text style={styles.filterStatusText}>
                Showing {filteredUsers.length} of {managedUsers.length} users
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setSearch("");
                  setRoleFilter("ALL");
                }}
              >
                <Text style={styles.clearFilterText}>Reset filter</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* User Accounts Directory Header */}
        <View style={styles.directoryHeader}>
          <Text style={styles.directoryTitle}>
            Active Personnel Accounts ({filteredUsers.length})
          </Text>
          <Text style={styles.directoryHint}>Tap card to view details</Text>
        </View>

        {/* User Cards List */}
        {filteredUsers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="person-circle-outline" size={32} color="#64748b" />
            <Text style={styles.emptyTitle}>No matching accounts</Text>
            <Text style={styles.emptySubtitle}>
              Try adjusting your search query or role filter.
            </Text>
          </View>
        ) : (
          <View style={styles.userList}>
            {filteredUsers.map((u) => {
              const rStyle = getRoleStyle(u.role);
              const isDefaultAdmin = u.username.toLowerCase() === "admin";

              return (
                <TouchableOpacity
                  key={u.id || u.username}
                  style={styles.userCard}
                  onPress={() => setSelectedUserDetail(u)}
                  activeOpacity={0.8}
                >
                  <View style={styles.userCardTop}>
                    {/* Left: Avatar with role ring */}
                    <View style={styles.userCardIdentity}>
                      <View
                        style={[
                          styles.userAvatar,
                          { backgroundColor: rStyle.bg, borderColor: rStyle.border },
                        ]}
                      >
                        <Ionicons name={rStyle.icon} size={15} color={rStyle.text} />
                      </View>

                      <View style={styles.userInfoCol}>
                        <View style={styles.userNameRow}>
                          <Text style={styles.userName} numberOfLines={1}>
                            {u.name}
                          </Text>
                          {isDefaultAdmin && (
                            <View style={styles.masterTag}>
                              <Text style={styles.masterTagText}>MASTER</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.userHandle}>@{u.username}</Text>
                      </View>
                    </View>

                    {/* Right: Role Badge */}
                    <View style={styles.userCardRight}>
                      <View
                        style={[
                          styles.roleBadge,
                          { backgroundColor: rStyle.bg, borderColor: rStyle.border },
                        ]}
                      >
                        <Text style={[styles.roleBadgeText, { color: rStyle.text }]}>
                          {rStyle.label}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Bottom Metadata Bar */}
                  <View style={styles.userCardBottom}>
                    <View style={styles.metaItem}>
                      <Ionicons name="mail-outline" size={11} color="#64748b" />
                      <Text style={styles.metaText} numberOfLines={1}>
                        {u.email}
                      </Text>
                    </View>

                    <View style={styles.activeTag}>
                      <View style={styles.activeDot} />
                      <Text style={styles.activeText}>ACTIVE</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button (FAB) for fast mobile access */}
      <TouchableOpacity
        style={styles.mobileFab}
        onPress={() => {
          setFormError("");
          setShowCreateModal(true);
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="person-add" size={18} color="#ffffff" />
      </TouchableOpacity>

      {/* ======================================================== */}
      {/* MOBILE BOTTOM SHEET MODAL: CREATE STAFF & SECURITY USER */}
      {/* ======================================================== */}
      <Modal
        transparent
        animationType="slide"
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalBackdrop}
        >
          <TouchableOpacity
            style={styles.backdropTouchArea}
            activeOpacity={1}
            onPress={() => setShowCreateModal(false)}
          />

          <View style={styles.sheetCard} onStartShouldSetResponder={() => true}>
            {/* Sheet Drag Handle */}
            <View style={styles.sheetHandle} />

            {/* Sheet Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderLeft}>
                <Ionicons name="person-add" size={16} color="#38bdf8" />
                <View>
                  <Text style={styles.sheetTitle}>Create User Account</Text>
                  <Text style={styles.sheetSubtitle}>
                    Provision Staff or Security login credentials
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setShowCreateModal(false)}
                style={styles.sheetCloseBtn}
              >
                <Ionicons name="close" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {formError !== "" && (
              <View style={styles.formErrorBanner}>
                <Ionicons name="alert-circle" size={14} color="#f43f5e" />
                <Text style={styles.formErrorText}>{formError}</Text>
              </View>
            )}

            {/* Role Selection Tabs */}
            <Text style={styles.fieldLabel}>Select Account Role:</Text>
            <View style={styles.roleTabsRow}>
              <TouchableOpacity
                style={[
                  styles.roleTab,
                  formRole === "STAFF" && styles.roleTabStaffActive,
                ]}
                onPress={() => setFormRole("STAFF")}
              >
                <Ionicons
                  name="briefcase"
                  size={14}
                  color={formRole === "STAFF" ? "#ffffff" : "#60a5fa"}
                />
                <Text
                  style={[
                    styles.roleTabText,
                    formRole === "STAFF" && styles.roleTabTextActive,
                  ]}
                >
                  Staff Account
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.roleTab,
                  formRole === "SECURITY" && styles.roleTabSecurityActive,
                ]}
                onPress={() => setFormRole("SECURITY")}
              >
                <Ionicons
                  name="shield-checkmark"
                  size={14}
                  color={formRole === "SECURITY" ? "#ffffff" : "#fbbf24"}
                />
                <Text
                  style={[
                    styles.roleTabText,
                    formRole === "SECURITY" && styles.roleTabTextActive,
                  ]}
                >
                  Security Guard
                </Text>
              </TouchableOpacity>
            </View>

            {/* Quick Fill Presets */}
            <View style={styles.presetRow}>
              <Text style={styles.presetLabel}>Quick fill:</Text>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => applyPreset("STAFF", "01")}
              >
                <Text style={styles.presetChipText}>+ staff_01</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.presetChip}
                onPress={() => applyPreset("SECURITY", "gate1")}
              >
                <Text style={styles.presetChipText}>+ sec_gate1</Text>
              </TouchableOpacity>
            </View>

            {/* Full Name Input */}
            <Text style={styles.fieldLabel}>Full Name / Title (Optional):</Text>
            <View style={styles.formInputBox}>
              <Ionicons name="person-outline" size={14} color="#64748b" style={styles.inputIcon} />
              <TextInput
                style={styles.formInput}
                placeholder="e.g. Sanjay (Gate Sentinel)"
                placeholderTextColor="#64748b"
                value={formName}
                onChangeText={setFormName}
              />
            </View>

            {/* Username Input */}
            <Text style={styles.fieldLabel}>Username (for sign in):</Text>
            <View style={styles.formInputBox}>
              <Ionicons name="at-outline" size={14} color="#64748b" style={styles.inputIcon} />
              <TextInput
                style={styles.formInput}
                placeholder="e.g. security_gate2 or staff_john"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                value={formUsername}
                onChangeText={setFormUsername}
              />
            </View>

            {/* Password Input */}
            <Text style={styles.fieldLabel}>Password:</Text>
            <View style={styles.formInputBox}>
              <Ionicons name="lock-closed-outline" size={14} color="#64748b" style={styles.inputIcon} />
              <TextInput
                style={styles.formInput}
                placeholder="Enter password..."
                placeholderTextColor="#64748b"
                secureTextEntry={!showPassword}
                value={formPassword}
                onChangeText={setFormPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={14}
                  color="#94a3b8"
                />
              </TouchableOpacity>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={styles.createSubmitBtn}
              onPress={handleCreateUser}
              disabled={formSubmitting}
              activeOpacity={0.8}
            >
              {formSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={15} color="#ffffff" />
                  <Text style={styles.createSubmitBtnText}>
                    Create & Activate {formRole} User
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ======================================================== */}
      {/* USER DETAILS MODAL */}
      {/* ======================================================== */}
      <Modal
        transparent
        animationType="fade"
        visible={!!selectedUserDetail}
        onRequestClose={() => setSelectedUserDetail(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setSelectedUserDetail(null)}
        >
          <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
            {selectedUserDetail && (
              <>
                <View style={styles.detailHeader}>
                  <Text style={styles.detailTitle}>Account Details</Text>
                  <TouchableOpacity onPress={() => setSelectedUserDetail(null)}>
                    <Ionicons name="close" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                {/* Profile Overview */}
                <View style={styles.detailProfile}>
                  <View
                    style={[
                      styles.detailAvatar,
                      {
                        backgroundColor: getRoleStyle(selectedUserDetail.role).bg,
                        borderColor: getRoleStyle(selectedUserDetail.role).border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={getRoleStyle(selectedUserDetail.role).icon}
                      size={24}
                      color={getRoleStyle(selectedUserDetail.role).text}
                    />
                  </View>

                  <View style={styles.detailProfileText}>
                    <Text style={styles.detailName}>{selectedUserDetail.name}</Text>
                    <Text style={styles.detailUsername}>@{selectedUserDetail.username}</Text>
                    <Text
                      style={[
                        styles.detailRole,
                        { color: getRoleStyle(selectedUserDetail.role).text },
                      ]}
                    >
                      Role: {selectedUserDetail.role}
                    </Text>
                  </View>
                </View>

                {/* Credentials Details Box */}
                <View style={styles.detailBox}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailRowLabel}>Username</Text>
                    <Text style={styles.detailRowValue}>{selectedUserDetail.username}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailRowLabel}>Email Address</Text>
                    <Text style={styles.detailRowValue}>{selectedUserDetail.email}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailRowLabel}>Initial Password</Text>
                    <Text style={[styles.detailRowValue, { color: "#38bdf8", fontWeight: "700" }]}>
                      {selectedUserDetail.password || "••••••••"}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailRowLabel}>Created</Text>
                    <Text style={styles.detailRowValue}>
                      {selectedUserDetail.createdAt || "Active"}
                    </Text>
                  </View>
                </View>

                <View style={styles.detailFooterRow}>
                  {selectedUserDetail.username.toLowerCase() !== "admin" && (
                    <TouchableOpacity
                      style={styles.detailDeleteAction}
                      onPress={() => {
                        setDeleteTargetUser(selectedUserDetail);
                        setSelectedUserDetail(null);
                      }}
                    >
                      <Ionicons name="trash-outline" size={13} color="#f43f5e" />
                      <Text style={styles.detailDeleteActionText}>Delete User</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.detailCloseAction}
                    onPress={() => setSelectedUserDetail(null)}
                  >
                    <Text style={styles.detailCloseActionText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ======================================================== */}
      {/* DELETE CONFIRMATION MODAL */}
      {/* ======================================================== */}
      <Modal
        transparent
        animationType="fade"
        visible={!!deleteTargetUser}
        onRequestClose={() => setDeleteTargetUser(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconBox}>
              <Ionicons name="warning-outline" size={24} color="#f43f5e" />
            </View>

            <Text style={styles.confirmTitle}>Delete User Account?</Text>
            <Text style={styles.confirmDesc}>
              Are you sure you want to delete user{" "}
              <Text style={styles.confirmHighlight}>@{deleteTargetUser?.username}</Text> (
              {deleteTargetUser?.role})? They will no longer be able to log in to the system.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setDeleteTargetUser(null)}
                disabled={isDeleting}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.confirmDeleteBtn}
                onPress={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="trash" size={13} color="#ffffff" />
                    <Text style={styles.confirmDeleteText}>Delete Account</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    position: "relative",
  },
  toastBanner: {
    position: "absolute",
    top: 10,
    left: 14,
    right: 14,
    zIndex: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#0284c7",
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  toastText: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  mainScroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 90, // Safe distance from bottom navigation
  },

  /* Header Bar */
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    marginTop: 2,
  },
  headerTitleBox: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  createBtnHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0284c7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  createBtnHeaderText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
  },

  /* Mobile Floating Action Button (FAB) */
  mobileFab: {
    position: "absolute",
    bottom: 20,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0284c7",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 90,
  },

  /* Filter Toolbar */
  filterToolbarCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 9,
    height: 36,
    marginBottom: 8,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 11,
    color: COLORS.text,
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: 2,
  },
  roleChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  roleChip: {
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
  },
  roleChipActiveCyan: {
    backgroundColor: "#0284c7",
    borderColor: "#0284c7",
  },
  roleChipActiveBlue: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  roleChipActiveAmber: {
    backgroundColor: "#d97706",
    borderColor: "#d97706",
  },
  roleChipActiveRed: {
    backgroundColor: "#dc2626",
    borderColor: "#dc2626",
  },
  roleChipText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  roleChipTextActive: {
    color: "#ffffff",
    fontWeight: "800",
  },
  filterStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  filterStatusText: {
    fontSize: 10,
    color: "#64748b",
  },
  clearFilterText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#dc2626",
  },

  /* Directory Header */
  directoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  directoryTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  directoryHint: {
    fontSize: 9,
    color: COLORS.textMuted,
  },
  emptyCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginTop: 6,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: 6,
  },
  emptySubtitle: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  userList: {
    gap: 8,
  },
  userCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 11,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  userCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  userCardIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
  },
  userAvatar: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  userInfoCol: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  userName: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  masterTag: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  masterTagText: {
    fontSize: 8,
    fontWeight: "900",
    color: "#b91c1c",
  },
  userHandle: {
    fontSize: 10,
    color: "#0284c7",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    marginTop: 1,
  },
  userCardRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  userCardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  metaText: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  activeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#16a34a",
  },
  activeText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#16a34a",
  },

  /* Modals Base */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end", // Bottom sheet alignment
    alignItems: "center",
  },
  backdropTouchArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  /* Bottom Sheet Create Modal Card */
  sheetCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 30 : 20,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 12,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#cbd5e1",
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  sheetHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
  },
  sheetSubtitle: {
    fontSize: 9.5,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  sheetCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  formErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    padding: 6,
    borderRadius: 6,
    marginBottom: 8,
  },
  formErrorText: {
    fontSize: 10,
    color: "#dc2626",
    fontWeight: "600",
    flex: 1,
  },
  fieldLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 4,
    marginTop: 4,
  },
  roleTabsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  roleTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 7,
    borderRadius: 8,
  },
  roleTabStaffActive: {
    backgroundColor: "#0284c7",
    borderColor: "#0284c7",
  },
  roleTabSecurityActive: {
    backgroundColor: "#d97706",
    borderColor: "#d97706",
  },
  roleTabText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  roleTabTextActive: {
    color: "#ffffff",
  },
  presetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  presetLabel: {
    fontSize: 9,
    color: COLORS.textMuted,
  },
  presetChip: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  presetChipText: {
    fontSize: 9,
    color: "#0284c7",
    fontWeight: "600",
  },
  formInputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 36,
    marginBottom: 6,
  },
  inputIcon: {
    marginRight: 6,
  },
  formInput: {
    flex: 1,
    fontSize: 11,
    color: COLORS.text,
    paddingVertical: 0,
  },
  eyeBtn: {
    padding: 4,
  },
  createSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#0284c7",
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 6,
  },
  createSubmitBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
  },

  /* Detail Card Modal */
  detailCard: {
    width: "90%",
    maxWidth: 380,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 16,
    alignSelf: "center",
    marginBottom: "auto",
    marginTop: "auto",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a",
  },
  detailProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  detailAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  detailProfileText: {
    flex: 1,
  },
  detailName: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a",
  },
  detailUsername: {
    fontSize: 11,
    color: "#0284c7",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    marginTop: 1,
  },
  detailRole: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  detailBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 10,
    gap: 6,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailRowLabel: {
    fontSize: 10,
    color: "#64748b",
  },
  detailRowValue: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0f172a",
  },
  detailFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailDeleteAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  detailDeleteActionText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#b91c1c",
  },
  detailCloseAction: {
    flex: 1,
    backgroundColor: "#0284c7",
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  detailCloseActionText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },

  /* Confirm Delete Card */
  confirmCard: {
    width: "88%",
    maxWidth: 340,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#fca5a5",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    alignSelf: "center",
    marginBottom: "auto",
    marginTop: "auto",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  confirmIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  confirmTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 6,
  },
  confirmDesc: {
    fontSize: 10.5,
    color: "#475569",
    textAlign: "center",
    lineHeight: 15,
    marginBottom: 14,
  },
  confirmHighlight: {
    color: "#0f172a",
    fontWeight: "700",
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: "center",
  },
  confirmCancelText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: "#dc2626",
    paddingVertical: 9,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  confirmDeleteText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
});

export default UsersScreen;
