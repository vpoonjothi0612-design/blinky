import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getEmployeesApi,
  getAttendancesApi,
  computeEmployeeRoster,
  deleteEmployeeApi,
} from "../services/attendanceService";
import COLORS from "../theme/colors";

const EmployeesScreen = ({ active = true }) => {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  // State
  const [employees, setEmployees] = useState([]);
  const [attendances, setAttendances] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL"); // "ALL", "IN", "OUT", "NOT_PRESENT"
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Modal actions state
  const [activeActionEmployee, setActiveActionEmployee] = useState(null);
  const [detailEmployee, setDetailEmployee] = useState(null);
  const [deleteTargetEmployee, setDeleteTargetEmployee] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Load roster data
  const loadRoster = useCallback(async () => {
    try {
      const [emps, atts] = await Promise.all([
        getEmployeesApi(),
        getAttendancesApi(1, 150),
      ]);
      setEmployees(emps);
      setAttendances(atts);
      setLastUpdated(new Date());
    } catch (e) {
      console.warn("Failed to load employee roster:", e);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    loadRoster();
    const interval = setInterval(loadRoster, 15000);
    return () => clearInterval(interval);
  }, [loadRoster, active]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRoster();
    setRefreshing(false);
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Compute live presence status
  const roster = useMemo(() => {
    return computeEmployeeRoster(employees, attendances);
  }, [employees, attendances]);

  // Extract unique departments
  const departments = useMemo(() => {
    const set = new Set();
    employees.forEach((e) => {
      if (e.department && e.department.trim()) {
        set.add(e.department.trim());
      }
    });
    return ["ALL", ...Array.from(set)];
  }, [employees]);

  // Filtered dataset
  const filteredRoster = useMemo(() => {
    return roster.filter((item) => {
      // 1. Status Filter
      if (filter !== "ALL" && item.currentStatus !== filter) {
        return false;
      }
      // 2. Department Filter
      if (deptFilter !== "ALL" && item.department !== deptFilter) {
        return false;
      }
      // 3. Search Query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matches =
          (item.name || "").toLowerCase().includes(q) ||
          (item.employeeCode || "").toLowerCase().includes(q) ||
          (item.department || "").toLowerCase().includes(q) ||
          (item.designation || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [roster, filter, deptFilter, search]);

  // Statistics counts
  const counts = useMemo(() => {
    return {
      total: roster.length,
      in: roster.filter((r) => r.currentStatus === "IN").length,
      out: roster.filter((r) => r.currentStatus === "OUT").length,
      notPresent: roster.filter((r) => r.currentStatus === "NOT_PRESENT").length,
    };
  }, [roster]);

  // Handle employee deletion
  const handleConfirmDelete = async () => {
    if (!deleteTargetEmployee) return;
    setIsDeleting(true);
    try {
      await deleteEmployeeApi(deleteTargetEmployee.id);
      showToast(`Employee ${deleteTargetEmployee.name} deleted.`);
      setDeleteTargetEmployee(null);
      setActiveActionEmployee(null);
      await loadRoster();
    } catch (e) {
      console.error("Delete employee error:", e);
      showToast("Failed to delete employee. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const clearAllFilters = () => {
    setSearch("");
    setFilter("ALL");
    setDeptFilter("ALL");
  };

  const hasActiveFilters = search.trim() !== "" || filter !== "ALL" || deptFilter !== "ALL";

  return (
    <View style={styles.container}>
      {/* Toast Notification */}
      {toastMessage && (
        <View style={styles.toastBanner}>
          <Ionicons name="information-circle" size={16} color="#38bdf8" />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

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
        {/* Header Title & Sync Status */}
        <View style={styles.headerBar}>
          <View>
            <Text style={styles.pageTitle}>Employee Live Presence</Text>
            <Text style={styles.pageSubtitle}>
              Gate check-in status & facility occupancy
            </Text>
          </View>

          <View style={styles.headerRight}>
            <View style={styles.syncBadge}>
              <View style={styles.pulseDot} />
              <Text style={styles.syncText}>
                Live Sync • {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={onRefresh}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={13} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. Employee Statistics (4 Compact Responsive Cards) */}
        <View style={[styles.statsGrid, isDesktop && styles.statsGridDesktop]}>
          {/* Card 1: Total Employees */}
          <TouchableOpacity
            style={[
              styles.statCard,
              isDesktop ? styles.statCardDesktop : styles.statCardMobile,
              filter === "ALL" && styles.statCardActiveCyan,
            ]}
            onPress={() => setFilter("ALL")}
            activeOpacity={0.8}
          >
            <View style={styles.statCardHeader}>
              <Text style={styles.statCardLabel} numberOfLines={1}>
                Total Employees
              </Text>
              <View style={[styles.statIconBox, { backgroundColor: "rgba(56, 189, 248, 0.15)" }]}>
                <Ionicons name="people" size={14} color="#38bdf8" />
              </View>
            </View>
            <Text style={[styles.statValue, { color: "#38bdf8" }]}>{counts.total}</Text>
            <Text style={styles.statSubtext} numberOfLines={1}>
              {filter === "ALL" ? "Active filter: All" : "Total staff roster"}
            </Text>
          </TouchableOpacity>

          {/* Card 2: Currently IN */}
          <TouchableOpacity
            style={[
              styles.statCard,
              isDesktop ? styles.statCardDesktop : styles.statCardMobile,
              filter === "IN" && styles.statCardActiveGreen,
            ]}
            onPress={() => setFilter(filter === "IN" ? "ALL" : "IN")}
            activeOpacity={0.8}
          >
            <View style={styles.statCardHeader}>
              <Text style={styles.statCardLabel} numberOfLines={1}>
                Currently IN
              </Text>
              <View style={[styles.statIconBox, { backgroundColor: "rgba(16, 185, 129, 0.15)" }]}>
                <Ionicons name="log-in" size={14} color="#10b981" />
              </View>
            </View>
            <Text style={[styles.statValue, { color: "#10b981" }]}>{counts.in}</Text>
            <Text style={styles.statSubtext} numberOfLines={1}>
              {filter === "IN" ? "Filter active: IN" : "Inside facility"}
            </Text>
          </TouchableOpacity>

          {/* Card 3: Currently OUT */}
          <TouchableOpacity
            style={[
              styles.statCard,
              isDesktop ? styles.statCardDesktop : styles.statCardMobile,
              filter === "OUT" && styles.statCardActiveRose,
            ]}
            onPress={() => setFilter(filter === "OUT" ? "ALL" : "OUT")}
            activeOpacity={0.8}
          >
            <View style={styles.statCardHeader}>
              <Text style={styles.statCardLabel} numberOfLines={1}>
                Currently OUT
              </Text>
              <View style={[styles.statIconBox, { backgroundColor: "rgba(244, 63, 94, 0.15)" }]}>
                <Ionicons name="log-out" size={14} color="#f43f5e" />
              </View>
            </View>
            <Text style={[styles.statValue, { color: "#f43f5e" }]}>{counts.out}</Text>
            <Text style={styles.statSubtext} numberOfLines={1}>
              {filter === "OUT" ? "Filter active: OUT" : "Exited premises"}
            </Text>
          </TouchableOpacity>

          {/* Card 4: Not Present */}
          <TouchableOpacity
            style={[
              styles.statCard,
              isDesktop ? styles.statCardDesktop : styles.statCardMobile,
              filter === "NOT_PRESENT" && styles.statCardActiveSlate,
            ]}
            onPress={() => setFilter(filter === "NOT_PRESENT" ? "ALL" : "NOT_PRESENT")}
            activeOpacity={0.8}
          >
            <View style={styles.statCardHeader}>
              <Text style={styles.statCardLabel} numberOfLines={1}>
                Not Present
              </Text>
              <View style={[styles.statIconBox, { backgroundColor: "rgba(148, 163, 184, 0.15)" }]}>
                <Ionicons name="close-circle" size={14} color="#94a3b8" />
              </View>
            </View>
            <Text style={[styles.statValue, { color: "#94a3b8" }]}>{counts.notPresent}</Text>
            <Text style={styles.statSubtext} numberOfLines={1}>
              {filter === "NOT_PRESENT" ? "Filter active: Absent" : "No punch today"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 3. Search and Filters Section */}
        <View style={styles.searchFilterCard}>
          {/* Full-width Search Input */}
          <View style={styles.searchInputRow}>
            <Ionicons name="search" size={16} color="#64748b" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, employee ID, department..."
              placeholderTextColor="#64748b"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")} style={styles.clearSearchBtn}>
                <Ionicons name="close-circle" size={16} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Department & Status Filter Bar */}
          <View style={styles.filtersToolbar}>
            {/* Department Dropdown Trigger */}
            <TouchableOpacity
              style={[
                styles.deptDropdownBtn,
                deptFilter !== "ALL" && styles.deptDropdownBtnActive,
              ]}
              onPress={() => setShowDeptDropdown(!showDeptDropdown)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="business-outline"
                size={13}
                color={deptFilter !== "ALL" ? "#38bdf8" : COLORS.textSecondary}
              />
              <Text
                style={[
                  styles.deptDropdownBtnText,
                  deptFilter !== "ALL" && styles.deptDropdownBtnTextActive,
                ]}
                numberOfLines={1}
              >
                {deptFilter === "ALL" ? "All Departments" : deptFilter}
              </Text>
              <Ionicons
                name={showDeptDropdown ? "chevron-up" : "chevron-down"}
                size={13}
                color={deptFilter !== "ALL" ? "#38bdf8" : COLORS.textMuted}
              />
            </TouchableOpacity>

            {/* Attendance Status Filter Pills */}
            <View style={styles.statusChipsContainer}>
              <TouchableOpacity
                style={[styles.statusChip, filter === "ALL" && styles.statusChipActiveCyan]}
                onPress={() => setFilter("ALL")}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    filter === "ALL" && styles.statusChipTextActive,
                  ]}
                >
                  All ({counts.total})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.statusChip, filter === "IN" && styles.statusChipActiveGreen]}
                onPress={() => setFilter("IN")}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    filter === "IN" && styles.statusChipTextActive,
                  ]}
                >
                  🟢 IN ({counts.in})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.statusChip, filter === "OUT" && styles.statusChipActiveRose]}
                onPress={() => setFilter("OUT")}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    filter === "OUT" && styles.statusChipTextActive,
                  ]}
                >
                  🔴 OUT ({counts.out})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.statusChip,
                  filter === "NOT_PRESENT" && styles.statusChipActiveSlate,
                ]}
                onPress={() => setFilter("NOT_PRESENT")}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    filter === "NOT_PRESENT" && styles.statusChipTextActive,
                  ]}
                >
                  ⚪ Absent ({counts.notPresent})
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Department Picker Dropdown Sheet (Inline Expandable) */}
          {showDeptDropdown && (
            <View style={styles.deptDropdownMenu}>
              <Text style={styles.dropdownHeader}>Select Department:</Text>
              <View style={styles.deptOptionsRow}>
                {departments.map((dept) => (
                  <TouchableOpacity
                    key={dept}
                    style={[
                      styles.deptOptionBadge,
                      deptFilter === dept && styles.deptOptionBadgeActive,
                    ]}
                    onPress={() => {
                      setDeptFilter(dept);
                      setShowDeptDropdown(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.deptOptionBadgeText,
                        deptFilter === dept && styles.deptOptionBadgeTextActive,
                      ]}
                    >
                      {dept === "ALL" ? "All Departments" : dept}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Active Filter Indicator & Clear Option */}
          {hasActiveFilters && (
            <View style={styles.activeFiltersRow}>
              <View style={styles.activeFiltersLeft}>
                <Ionicons name="funnel-outline" size={12} color="#38bdf8" />
                <Text style={styles.activeFiltersText}>
                  Showing {filteredRoster.length} of {roster.length} employees
                </Text>
              </View>
              <TouchableOpacity
                style={styles.clearFiltersBtn}
                onPress={clearAllFilters}
                activeOpacity={0.7}
              >
                <Text style={styles.clearFiltersBtnText}>Clear all filters</Text>
                <Ionicons name="close-circle" size={13} color="#f43f5e" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 4. Employee Directory Cards */}
        <View style={styles.directoryHeader}>
          <Text style={styles.directoryTitle}>
            Employee Directory ({filteredRoster.length})
          </Text>
          <Text style={styles.directoryHint}>Tap card or menu for details</Text>
        </View>

        {filteredRoster.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="person-remove-outline" size={24} color="#64748b" />
            </View>
            <Text style={styles.emptyTitle}>No Employees Found</Text>
            <Text style={styles.emptyText}>
              No personnel match your search term or filter criteria.
            </Text>
            {hasActiveFilters && (
              <TouchableOpacity
                style={styles.emptyResetBtn}
                onPress={clearAllFilters}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={14} color="#38bdf8" />
                <Text style={styles.emptyResetBtnText}>Reset Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.employeeList}>
            {filteredRoster.map((emp) => {
              const isIN = emp.currentStatus === "IN";
              const isOUT = emp.currentStatus === "OUT";
              const isAbsent = emp.currentStatus === "NOT_PRESENT";

              const statusColor = isIN
                ? "#10b981"
                : isOUT
                ? "#f43f5e"
                : "#94a3b8";

              return (
                <TouchableOpacity
                  key={emp.id}
                  style={[
                    styles.empCard,
                    isIN && styles.empCardIn,
                    isOUT && styles.empCardOut,
                  ]}
                  onPress={() => setDetailEmployee(emp)}
                  activeOpacity={0.85}
                >
                  {/* Top Row: Avatar, Info, Badge, Three-dot Menu */}
                  <View style={styles.empCardTop}>
                    <View style={styles.empIdentityRow}>
                      {/* Avatar with Status Ring */}
                      <View
                        style={[
                          styles.avatarContainer,
                          {
                            backgroundColor: isIN
                              ? "rgba(16, 185, 129, 0.15)"
                              : isOUT
                              ? "rgba(244, 63, 94, 0.15)"
                              : "rgba(148, 163, 184, 0.12)",
                            borderColor: statusColor,
                          },
                        ]}
                      >
                        <Text style={[styles.avatarInitials, { color: statusColor }]}>
                          {(emp.name || "EM").substring(0, 2).toUpperCase()}
                        </Text>
                        <View
                          style={[
                            styles.avatarDot,
                            { backgroundColor: statusColor },
                          ]}
                        />
                      </View>

                      {/* Name, Code & Department */}
                      <View style={styles.empInfoBlock}>
                        <Text style={styles.empName} numberOfLines={1}>
                          {emp.name}
                        </Text>
                        <View style={styles.empSubRow}>
                          <View style={styles.empCodeBadge}>
                            <Text style={styles.empCodeText}>{emp.employeeCode}</Text>
                          </View>
                          <Text style={styles.empDeptText} numberOfLines={1}>
                            • {emp.department} • {emp.designation}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Status Badge & Three-dot menu */}
                    <View style={styles.empRightActions}>
                      <View
                        style={[
                          styles.statusBadge,
                          isIN
                            ? styles.statusBadgeIn
                            : isOUT
                            ? styles.statusBadgeOut
                            : styles.statusBadgeAbsent,
                        ]}
                      >
                        <View
                          style={[
                            styles.statusDotInner,
                            { backgroundColor: statusColor },
                          ]}
                        />
                        <Text
                          style={[
                            styles.statusBadgeText,
                            isIN
                              ? styles.statusBadgeTextIn
                              : isOUT
                              ? styles.statusBadgeTextOut
                              : styles.statusBadgeTextAbsent,
                          ]}
                        >
                          {isIN ? "IN" : isOUT ? "OUT" : "ABSENT"}
                        </Text>
                      </View>

                      {/* 3-dot Action Menu Trigger */}
                      <TouchableOpacity
                        style={styles.moreActionBtn}
                        onPress={(e) => {
                          e.stopPropagation();
                          setActiveActionEmployee(emp);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name="ellipsis-vertical"
                          size={16}
                          color={COLORS.textSecondary}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Bottom Row: Today's Gate Log Details */}
                  {(emp.firstIn || emp.lastOut || emp.lastSeenCamera) ? (
                    <View style={styles.empGateDetails}>
                      {emp.firstIn && (
                        <View style={styles.gateDetailItem}>
                          <Ionicons name="log-in-outline" size={13} color="#10b981" />
                          <Text style={styles.gateDetailText}>
                            In: <Text style={styles.gateDetailBold}>{emp.firstIn}</Text>
                          </Text>
                        </View>
                      )}

                      {emp.lastOut && (
                        <View style={styles.gateDetailItem}>
                          <Ionicons name="log-out-outline" size={13} color="#f43f5e" />
                          <Text style={styles.gateDetailText}>
                            Out: <Text style={styles.gateDetailBold}>{emp.lastOut}</Text>
                          </Text>
                        </View>
                      )}

                      {emp.lastSeenCamera && (
                        <View style={styles.gateDetailItem}>
                          <Ionicons name="videocam-outline" size={13} color="#38bdf8" />
                          <Text style={styles.gateCamText} numberOfLines={1}>
                            {emp.lastSeenCamera.split(" ")[0]}
                          </Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={styles.absentRow}>
                      <Ionicons name="time-outline" size={12} color="#64748b" />
                      <Text style={styles.absentText}>
                        No gate check-in recorded today
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* 5. Employee Actions Bottom Sheet Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={!!activeActionEmployee}
        onRequestClose={() => setActiveActionEmployee(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setActiveActionEmployee(null)}
        >
          <View
            style={styles.actionSheetContent}
            onStartShouldSetResponder={() => true}
          >
            {activeActionEmployee && (
              <>
                <View style={styles.actionSheetHeader}>
                  <View style={styles.actionSheetHeaderLeft}>
                    <Text style={styles.actionSheetTitle} numberOfLines={1}>
                      {activeActionEmployee.name}
                    </Text>
                    <Text style={styles.actionSheetSubtitle}>
                      {activeActionEmployee.employeeCode} • {activeActionEmployee.department}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setActiveActionEmployee(null)}
                    style={styles.actionSheetCloseBtn}
                  >
                    <Ionicons name="close" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                {/* Action 1: View Details */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    setDetailEmployee(activeActionEmployee);
                    setActiveActionEmployee(null);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.actionMenuIconBox, { backgroundColor: "rgba(56, 189, 248, 0.15)" }]}>
                    <Ionicons name="eye-outline" size={17} color="#38bdf8" />
                  </View>
                  <View style={styles.actionMenuTextCol}>
                    <Text style={styles.actionMenuLabel}>View Details</Text>
                    <Text style={styles.actionMenuDesc}>
                      View full employee profile, gate history and attendance
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color="#64748b" />
                </TouchableOpacity>

                {/* Action 2: Delete Employee */}
                <TouchableOpacity
                  style={[styles.actionMenuItem, styles.actionMenuItemDanger]}
                  onPress={() => {
                    setDeleteTargetEmployee(activeActionEmployee);
                    setActiveActionEmployee(null);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.actionMenuIconBox, { backgroundColor: "rgba(244, 63, 94, 0.15)" }]}>
                    <Ionicons name="trash-outline" size={17} color="#f43f5e" />
                  </View>
                  <View style={styles.actionMenuTextCol}>
                    <Text style={[styles.actionMenuLabel, { color: "#f43f5e" }]}>
                      Delete Employee
                    </Text>
                    <Text style={styles.actionMenuDesc}>
                      Permanently remove employee and enrollment data
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color="#64748b" />
                </TouchableOpacity>

                {/* Cancel Button */}
                <TouchableOpacity
                  style={styles.actionCancelBtn}
                  onPress={() => setActiveActionEmployee(null)}
                >
                  <Text style={styles.actionCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* View Details Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={!!detailEmployee}
        onRequestClose={() => setDetailEmployee(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.detailModalCard}>
            {detailEmployee && (
              <>
                {/* Modal Header */}
                <View style={styles.detailHeader}>
                  <View style={styles.detailHeaderTitleRow}>
                    <View style={styles.detailHeaderIcon}>
                      <Ionicons name="person-circle" size={20} color="#38bdf8" />
                    </View>
                    <Text style={styles.detailHeaderTitle}>Employee Details</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setDetailEmployee(null)}
                    style={styles.detailCloseBtn}
                  >
                    <Ionicons name="close" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                {/* Profile Overview */}
                <View style={styles.detailProfileRow}>
                  <View
                    style={[
                      styles.detailAvatar,
                      {
                        backgroundColor:
                          detailEmployee.currentStatus === "IN"
                            ? "rgba(16, 185, 129, 0.15)"
                            : detailEmployee.currentStatus === "OUT"
                            ? "rgba(244, 63, 94, 0.15)"
                            : "rgba(148, 163, 184, 0.15)",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailAvatarText,
                        {
                          color:
                            detailEmployee.currentStatus === "IN"
                              ? "#10b981"
                              : detailEmployee.currentStatus === "OUT"
                              ? "#f43f5e"
                              : "#94a3b8",
                        },
                      ]}
                    >
                      {(detailEmployee.name || "EM").substring(0, 2).toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.detailProfileText}>
                    <Text style={styles.detailName}>{detailEmployee.name}</Text>
                    <Text style={styles.detailCode}>ID: {detailEmployee.employeeCode}</Text>
                    <Text style={styles.detailDept}>
                      {detailEmployee.department} • {detailEmployee.designation}
                    </Text>
                  </View>
                </View>

                {/* Status Callout Card */}
                <View
                  style={[
                    styles.detailStatusCallout,
                    detailEmployee.currentStatus === "IN"
                      ? styles.detailStatusIn
                      : detailEmployee.currentStatus === "OUT"
                      ? styles.detailStatusOut
                      : styles.detailStatusAbsent,
                  ]}
                >
                  <Ionicons
                    name={
                      detailEmployee.currentStatus === "IN"
                        ? "checkmark-circle"
                        : detailEmployee.currentStatus === "OUT"
                        ? "log-out"
                        : "close-circle"
                    }
                    size={18}
                    color={
                      detailEmployee.currentStatus === "IN"
                        ? "#10b981"
                        : detailEmployee.currentStatus === "OUT"
                        ? "#f43f5e"
                        : "#94a3b8"
                    }
                  />
                  <View style={styles.detailStatusCalloutText}>
                    <Text style={styles.detailStatusCalloutTitle}>
                      {detailEmployee.currentStatus === "IN"
                        ? "Inside Facility (Currently IN)"
                        : detailEmployee.currentStatus === "OUT"
                        ? "Exited Premises (Currently OUT)"
                        : "Not Present (Absent Today)"}
                    </Text>
                    <Text style={styles.detailStatusCalloutSub}>
                      {detailEmployee.currentStatus === "IN"
                        ? "Active on site. Entry verified by gate camera."
                        : detailEmployee.currentStatus === "OUT"
                        ? "Staff member exited through gate turnstile."
                        : "No attendance punches scanned for today."}
                    </Text>
                  </View>
                </View>

                {/* Information Grid */}
                <View style={styles.detailGrid}>
                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>First Check-In</Text>
                    <Text style={styles.detailGridValue}>
                      {detailEmployee.firstIn || "—"}
                    </Text>
                  </View>

                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>Last Check-Out</Text>
                    <Text style={styles.detailGridValue}>
                      {detailEmployee.lastOut || "—"}
                    </Text>
                  </View>

                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>Last Seen Camera</Text>
                    <Text style={styles.detailGridValue} numberOfLines={1}>
                      {detailEmployee.lastSeenCamera || "—"}
                    </Text>
                  </View>

                  <View style={styles.detailGridItem}>
                    <Text style={styles.detailGridLabel}>Today Scans</Text>
                    <Text style={styles.detailGridValue}>
                      {detailEmployee.todayPunchesCount || 0} events
                    </Text>
                  </View>

                  {detailEmployee.email && (
                    <View style={[styles.detailGridItem, { width: "100%" }]}>
                      <Text style={styles.detailGridLabel}>Email Address</Text>
                      <Text style={styles.detailGridValue}>{detailEmployee.email}</Text>
                    </View>
                  )}

                  {detailEmployee.phone && (
                    <View style={[styles.detailGridItem, { width: "100%" }]}>
                      <Text style={styles.detailGridLabel}>Phone Number</Text>
                      <Text style={styles.detailGridValue}>{detailEmployee.phone}</Text>
                    </View>
                  )}
                </View>

                {/* Footer Buttons */}
                <View style={styles.detailModalFooter}>
                  <TouchableOpacity
                    style={styles.detailDeleteBtn}
                    onPress={() => {
                      setDeleteTargetEmployee(detailEmployee);
                      setDetailEmployee(null);
                    }}
                  >
                    <Ionicons name="trash-outline" size={14} color="#f43f5e" />
                    <Text style={styles.detailDeleteBtnText}>Delete</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.detailCloseActionBtn}
                    onPress={() => setDetailEmployee(null)}
                  >
                    <Text style={styles.detailCloseActionText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={!!deleteTargetEmployee}
        onRequestClose={() => setDeleteTargetEmployee(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmModalCard}>
            <View style={styles.confirmIconContainer}>
              <Ionicons name="warning-outline" size={26} color="#f43f5e" />
            </View>

            <Text style={styles.confirmTitle}>Delete Employee?</Text>
            <Text style={styles.confirmDesc}>
              Are you sure you want to delete{" "}
              <Text style={styles.confirmHighlight}>
                {deleteTargetEmployee?.name} ({deleteTargetEmployee?.employeeCode})
              </Text>
              ? This action is permanent and will remove all their enrollment records.
            </Text>

            <View style={styles.confirmActionRow}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setDeleteTargetEmployee(null)}
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
                    <Ionicons name="trash" size={14} color="#ffffff" />
                    <Text style={styles.confirmDeleteText}>Confirm Delete</Text>
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

  /* 1. Header Bar */
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    marginTop: 2,
  },
  pageTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  syncBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(2, 132, 199, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(2, 132, 199, 0.25)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 5,
  },
  pulseDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#0284c7",
  },
  syncText: {
    fontSize: 9,
    color: "#0284c7",
    fontWeight: "700",
  },
  refreshIconBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },

  /* 2. Employee Statistics Cards */
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  statsGridDesktop: {
    flexWrap: "nowrap",
  },
  statCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 11,
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  statCardMobile: {
    width: "48.7%",
  },
  statCardDesktop: {
    flex: 1,
  },
  statCardActiveCyan: {
    borderColor: "#0284c7",
    backgroundColor: "rgba(2, 132, 199, 0.08)",
  },
  statCardActiveGreen: {
    borderColor: "#16a34a",
    backgroundColor: "rgba(22, 163, 74, 0.08)",
  },
  statCardActiveRose: {
    borderColor: "#e11d48",
    backgroundColor: "rgba(225, 29, 72, 0.08)",
  },
  statCardActiveSlate: {
    borderColor: "#64748b",
    backgroundColor: "rgba(100, 116, 139, 0.08)",
  },
  statCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  statCardLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
    flex: 1,
  },
  statIconBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  statSubtext: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginTop: 2,
  },

  /* 3. Search and Filters Card */
  searchFilterCard: {
    backgroundColor: COLORS.surface,
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
  searchInputRow: {
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
    marginRight: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 11,
    color: COLORS.text,
    paddingVertical: 0,
  },
  clearSearchBtn: {
    padding: 2,
  },
  filtersToolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  deptDropdownBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    gap: 5,
  },
  deptDropdownBtnActive: {
    borderColor: "rgba(2, 132, 199, 0.4)",
    backgroundColor: "rgba(2, 132, 199, 0.08)",
  },
  deptDropdownBtnText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.textSecondary,
    maxWidth: 110,
  },
  deptDropdownBtnTextActive: {
    color: "#0284c7",
    fontWeight: "700",
  },
  statusChipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    flex: 1,
  },
  statusChip: {
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
  },
  statusChipActiveCyan: {
    backgroundColor: "#0284c7",
    borderColor: "#0284c7",
  },
  statusChipActiveGreen: {
    backgroundColor: "#16a34a",
    borderColor: "#16a34a",
  },
  statusChipActiveRose: {
    backgroundColor: "#e11d48",
    borderColor: "#e11d48",
  },
  statusChipActiveSlate: {
    backgroundColor: "#475569",
    borderColor: "#475569",
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  statusChipTextActive: {
    color: "#ffffff",
    fontWeight: "800",
  },

  /* Dept dropdown expanded view */
  deptDropdownMenu: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  dropdownHeader: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    marginBottom: 6,
  },
  deptOptionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  deptOptionBadge: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deptOptionBadgeActive: {
    backgroundColor: "rgba(2, 132, 199, 0.12)",
    borderColor: "#0284c7",
  },
  deptOptionBadgeText: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  deptOptionBadgeTextActive: {
    color: "#0284c7",
    fontWeight: "700",
  },

  /* Active Filters Bar */
  activeFiltersRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  activeFiltersLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  activeFiltersText: {
    fontSize: 10,
    color: "#64748b",
  },
  clearFiltersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
  },
  clearFiltersBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#e11d48",
  },

  /* 4. Directory Header & Cards */
  directoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  directoryTitle: {
    fontSize: 12,
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
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginTop: 6,
  },
  emptyIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(100, 116, 139, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 3,
  },
  emptyText: {
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: "center",
    marginBottom: 10,
  },
  emptyResetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(2, 132, 199, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(2, 132, 199, 0.3)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  emptyResetBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0284c7",
  },
  employeeList: {
    gap: 8,
  },
  empCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  empCardIn: {
    borderColor: "rgba(22, 163, 74, 0.35)",
  },
  empCardOut: {
    borderColor: "rgba(225, 29, 72, 0.3)",
  },
  empCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  empIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
  },
  avatarContainer: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarInitials: {
    fontSize: 12,
    fontWeight: "900",
  },
  avatarDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: COLORS.surface,
  },
  empInfoBlock: {
    flex: 1,
  },
  empName: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  empSubRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
    gap: 4,
  },
  empCodeBadge: {
    backgroundColor: "rgba(2, 132, 199, 0.1)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  empCodeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#0284c7",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  empDeptText: {
    fontSize: 10,
    color: COLORS.textMuted,
    flexShrink: 1,
  },
  empRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeIn: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
  },
  statusBadgeOut: {
    backgroundColor: "#ffe4e6",
    borderColor: "#fca5a5",
  },
  statusBadgeAbsent: {
    backgroundColor: "#f1f5f9",
    borderColor: "#cbd5e1",
  },
  statusDotInner: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  statusBadgeTextIn: {
    color: "#15803d",
  },
  statusBadgeTextOut: {
    color: "#be123c",
  },
  statusBadgeTextAbsent: {
    color: "#64748b",
  },
  moreActionBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  empGateDetails: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 7,
  },
  gateDetailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  gateDetailText: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  gateDetailBold: {
    color: COLORS.text,
    fontWeight: "700",
  },
  gateCamText: {
    fontSize: 9,
    color: "#0284c7",
    fontWeight: "600",
  },
  absentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  absentText: {
    fontSize: 9,
    color: COLORS.textMuted,
    fontStyle: "italic",
  },

  /* 5. Modals & Action Sheet */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  actionSheetContent: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 10,
  },
  actionSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    marginBottom: 8,
  },
  actionSheetHeaderLeft: {
    flex: 1,
    marginRight: 8,
  },
  actionSheetTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
  },
  actionSheetSubtitle: {
    fontSize: 10,
    color: "#64748b",
    marginTop: 2,
  },
  actionSheetCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  actionMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 10,
  },
  actionMenuItemDanger: {
    marginTop: 2,
  },
  actionMenuIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  actionMenuTextCol: {
    flex: 1,
  },
  actionMenuLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  actionMenuDesc: {
    fontSize: 10,
    color: "#64748b",
    marginTop: 1,
  },
  actionCancelBtn: {
    marginTop: 10,
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
  },
  actionCancelText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },

  /* View Details Modal */
  detailModalCard: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 10,
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
  detailHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailHeaderIcon: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  detailHeaderTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0f172a",
  },
  detailCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  detailProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  detailAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  detailAvatarText: {
    fontSize: 15,
    fontWeight: "900",
  },
  detailProfileText: {
    flex: 1,
  },
  detailName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
  },
  detailCode: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0284c7",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    marginTop: 1,
  },
  detailDept: {
    fontSize: 10,
    color: "#64748b",
    marginTop: 1,
  },
  detailStatusCallout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  detailStatusIn: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
  },
  detailStatusOut: {
    backgroundColor: "#ffe4e6",
    borderColor: "#fca5a5",
  },
  detailStatusAbsent: {
    backgroundColor: "#f1f5f9",
    borderColor: "#cbd5e1",
  },
  detailStatusCalloutText: {
    flex: 1,
  },
  detailStatusCalloutTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0f172a",
  },
  detailStatusCalloutSub: {
    fontSize: 9.5,
    color: "#64748b",
    marginTop: 2,
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  detailGridItem: {
    width: "48%",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 8,
  },
  detailGridLabel: {
    fontSize: 9,
    color: "#64748b",
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: 3,
  },
  detailGridValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  detailModalFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  detailDeleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#ffe4e6",
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  detailDeleteBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#e11d48",
  },
  detailCloseActionBtn: {
    flex: 1,
    backgroundColor: "#0284c7",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  detailCloseActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },

  /* Delete Confirmation Modal */
  confirmModalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#fca5a5",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 10,
  },
  confirmIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  confirmTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 6,
  },
  confirmDesc: {
    fontSize: 11,
    color: "#475569",
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 14,
  },
  confirmHighlight: {
    color: "#0f172a",
    fontWeight: "700",
  },
  confirmActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  confirmCancelBtn: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
  },
  confirmCancelText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingVertical: 9,
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

export default EmployeesScreen;
