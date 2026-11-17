import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getVehicleEventsApi } from "../services/attendanceService";
import { getBaseUrl } from "../config/apiConfig";
import { formatPlate, plateStatus } from "../config/plateRules";
import COLORS from "../theme/colors";

const TABS = [["ALL", "All", "all"], ["ENTRY", "Entry", "entry"], ["EXIT", "Exit", "exit"], ["RECOGNIZED", "Plate Recognized", "recognized"], ["NOT_RECOGNIZED", "Not Recognized", "notRecognized"]];
const imageUrl = (path) => !path ? null : /^https?:/.test(path) ? path : `${getBaseUrl().replace(/\/api$/, "")}${path.startsWith("/") ? path : `/captured-images/${path}`}`;
const dateLabel = (value) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }) : "—";

export default function VehiclesScreen({ active = true }) {
  const [result, setResult] = useState({ data: [], counts: {}, total: 0 });
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState("ALL");
  const [sort, setSort] = useState("timestamp");
  const [order, setOrder] = useState("DESC");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const load = useCallback(async () => {
    try {
      const response = await getVehicleEventsApi({ page, limit: 25, tab, sort, order, search: query });
      setResult(response || { data: [], counts: {}, total: 0 }); setError("");
    } catch (err) { setError(err?.response?.data?.message || "Could not load vehicle movements."); }
    finally { setLoading(false); }
  }, [page, tab, sort, order, query]);
  useEffect(() => { if (!active) return; load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [active, load]);

  const rows = result.data || [];
  const counts = result.counts || {};
  const toggleSort = (field) => { if (sort === field) setOrder(order === "ASC" ? "DESC" : "ASC"); else { setSort(field); setOrder(field === "timestamp" ? "DESC" : "ASC"); } };
  const selectedIndex = useMemo(() => rows.findIndex((row) => row.id === selected?.id), [rows, selected]);
  const moveSelected = (delta) => { const next = rows[selectedIndex + delta]; if (next) setSelected(next); };

  return <View style={styles.container}>
    <View style={styles.heading}><View><Text style={styles.title}>Vehicle Movements</Text><Text style={styles.subtitle}>Recent gate detections and plate reads</Text></View><Text style={styles.total}>{result.total || 0} movements</Text></View>
    <TextInput accessibilityLabel="Search plate, vehicle type, or gate" placeholder="Search plate, vehicle type, or gate" placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} style={styles.search} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>{TABS.map(([key, label, countKey]) => <TouchableOpacity key={key} onPress={() => { setTab(key); setPage(1); }} style={[styles.tab, tab === key && styles.activeTab]}><Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label} ({counts[countKey] ?? 0})</Text></TouchableOpacity>)}</ScrollView>
    <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableContent}>
      <View><View style={styles.headerRow}>{[["Thumbnail", ""], ["Plate Number", ""], ["Plate Status", "status"], ["Vehicle Type", ""], ["Direction", "direction"], ["Gate", "gate"], ["Timestamp", "timestamp"], ["", ""]].map(([label, field], i) => <TouchableOpacity key={i} onPress={() => field && toggleSort(field)} style={[styles.cell, styles.headerCell, i === 0 && styles.thumbCell, i === 1 && styles.plateCell]}><Text style={styles.headerText}>{label}{sort === field ? (order === "ASC" ? " ↑" : " ↓") : ""}</Text></TouchableOpacity>)}</View>
        {loading && rows.length === 0 ? <View style={styles.empty}><ActivityIndicator color={COLORS.cyan} /><Text style={styles.muted}>Loading movements…</Text></View> : error ? <View style={styles.empty}><Text style={styles.error}>{error}</Text><TouchableOpacity onPress={load}><Text style={styles.action}>Retry</Text></TouchableOpacity></View> : rows.length === 0 ? <View style={styles.empty}><Ionicons name="car-outline" size={28} color="#64748b"/><Text style={styles.muted}>No meaningful vehicle movements found.</Text></View> : rows.map((row) => {
          const status = ({ recognized: "Recognized", low_confidence: "Low Confidence", not_recognized: "Not Recognized", invalid_format: "Invalid Format" })[row.plate_status] || plateStatus(row.plate_text, row.plate_confidence ?? row.metadata?.plateConfidence);
          const plate = formatPlate(row.plate_text);
          const thumb = imageUrl(row.vehicle_image_url || row.image_frame_url || row.image_face_url);
          return <TouchableOpacity key={row.id} accessibilityRole="button" accessibilityLabel={`View vehicle ${plate || "not read"} at ${dateLabel(row.timestamp)}`} onPress={() => setSelected(row)} style={styles.row}>
            <View style={[styles.cell, styles.thumbCell]}>{thumb ? <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" onError={() => console.warn("Missing vehicle thumbnail", thumb)} /> : <View style={styles.placeholder}><Ionicons name="car-outline" size={20} color="#64748b"/></View>}</View>
            <View style={[styles.cell, styles.plateCell]}><Text style={styles.plate}>{plate || "Not Read"}</Text>{plate ? <Text style={styles.ind}>IND</Text> : null}</View>
            <View style={styles.cell}><Text style={[styles.badge, status === "Recognized" ? styles.good : status === "Low Confidence" ? styles.warn : styles.bad]}>{status}</Text></View>
            <View style={styles.cell}><Text style={styles.bodyText}>{row.vehicle_type || row.metadata?.vehicleType || "Unknown"}</Text></View>
            <View style={styles.cell}><Text style={[styles.badge, row.direction === "IN" ? styles.good : styles.exit]}>{row.direction === "IN" ? "ENTRY (IN)" : "EXIT (OUT)"}</Text></View>
            <View style={styles.cell}><Text style={styles.bodyText}>{row.gate_name || row.camera_name || row.camera_id || "—"}</Text></View>
            <View style={styles.cell}><Text numberOfLines={1} style={styles.bodyText}>{dateLabel(row.detected_at || row.timestamp)}</Text></View>
            <View style={styles.cell}><Text style={styles.action}>View ›</Text></View>
          </TouchableOpacity>;
        })}
      </View>
    </ScrollView>
    <View style={styles.pagination}><Text style={styles.muted}>Page {page} · {result.total || 0} total</Text><View style={styles.pageButtons}><TouchableOpacity disabled={page <= 1} onPress={() => setPage((p) => p - 1)} style={styles.pageBtn}><Text>Previous</Text></TouchableOpacity><TouchableOpacity disabled={page * 25 >= (result.total || 0)} onPress={() => setPage((p) => p + 1)} style={styles.pageBtn}><Text>Next</Text></TouchableOpacity></View></View>
    <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}><View style={styles.modalBackdrop}><View style={styles.modal}><View style={styles.modalHead}><View><Text style={styles.modalTitle}>{formatPlate(selected?.plate_text) || "Not Read"}</Text><Text style={styles.muted}>{dateLabel(selected?.detected_at || selected?.timestamp)}</Text></View><TouchableOpacity accessibilityLabel="Close details" onPress={() => setSelected(null)}><Ionicons name="close" size={24} color="#334155"/></TouchableOpacity></View><ScrollView><Text style={styles.section}>Vehicle Photo</Text>{imageUrl(selected?.vehicle_image_url || selected?.image_frame_url || selected?.image_face_url) ? <Image source={{ uri: imageUrl(selected?.vehicle_image_url || selected?.image_frame_url || selected?.image_face_url) }} style={styles.heroImage} resizeMode="contain"/> : <Text style={styles.muted}>Vehicle image unavailable</Text>}<Text style={styles.section}>Number Plate</Text>{imageUrl(selected?.plate_image_url || selected?.image_plate_url) ? <Image source={{ uri: imageUrl(selected?.plate_image_url || selected?.image_plate_url) }} style={styles.plateImage} resizeMode="contain"/> : <Text style={styles.muted}>Plate crop unavailable</Text>}<Text style={styles.bodyText}>Raw OCR: {selected?.raw_plate_text || "—"} · Confidence: {selected?.plate_confidence ?? selected?.metadata?.plateConfidence ?? "—"}</Text><Text style={styles.section}>Movement</Text><Text style={styles.bodyText}>{selected?.vehicle_type || "Unknown"} · {selected?.direction === "IN" ? "ENTRY" : "EXIT"} · {selected?.gate_name || selected?.camera_name || selected?.camera_id}</Text><Text style={styles.section}>All Photos ({selected?.merged_frame_count || 1})</Text>{(selected?.all_photos || []).map((photo, index) => <View key={`${photo}-${index}`}><Image source={{ uri: imageUrl(`/snapshot-images/${photo}`) }} style={styles.galleryImage} resizeMode="cover"/><Text style={styles.muted}>{dateLabel(selected?.timestamp)}</Text></View>)}</ScrollView><View style={styles.pageButtons}><TouchableOpacity onPress={() => moveSelected(-1)} disabled={selectedIndex <= 0} style={styles.pageBtn}><Text>‹ Previous</Text></TouchableOpacity><TouchableOpacity onPress={() => moveSelected(1)} disabled={selectedIndex < 0 || selectedIndex >= rows.length - 1} style={styles.pageBtn}><Text>Next ›</Text></TouchableOpacity></View></View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({ container:{flex:1,backgroundColor:COLORS.background,padding:12},heading:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:10},title:{fontSize:19,fontWeight:"800",color:"#0f172a"},subtitle:{fontSize:11,color:"#64748b",marginTop:3},total:{fontSize:11,color:"#475569"},search:{height:40,borderWidth:1,borderColor:"#cbd5e1",borderRadius:8,paddingHorizontal:12,color:"#0f172a",backgroundColor:"white"},tabs:{maxHeight:43,marginVertical:8},tab:{paddingHorizontal:12,paddingVertical:9,borderRadius:7,marginRight:6,backgroundColor:"#e2e8f0"},activeTab:{backgroundColor:"#0e7490"},tabText:{fontSize:11,fontWeight:"700",color:"#334155"},activeTabText:{color:"white"},tableScroll:{flex:1,borderWidth:1,borderColor:"#cbd5e1",borderRadius:8,backgroundColor:"white"},tableContent:{minWidth:1150},headerRow:{flexDirection:"row",backgroundColor:"#f1f5f9",borderBottomWidth:1,borderColor:"#cbd5e1"},row:{flexDirection:"row",alignItems:"center",minHeight:64,borderBottomWidth:1,borderColor:"#e2e8f0"},cell:{width:130,paddingHorizontal:9,paddingVertical:7,justifyContent:"center"},headerCell:{height:42},thumbCell:{width:82},plateCell:{width:160,flexDirection:"row",alignItems:"center",gap:7},headerText:{fontSize:10,fontWeight:"800",color:"#475569"},thumb:{width:64,height:48,borderRadius:6,backgroundColor:"#e2e8f0"},placeholder:{width:64,height:48,borderRadius:6,backgroundColor:"#e2e8f0",alignItems:"center",justifyContent:"center"},plate:{fontFamily:Platform.OS==="web"?"monospace":undefined,fontSize:14,fontWeight:"800",color:"#0f172a"},ind:{fontSize:8,color:"#64748b",borderWidth:1,borderColor:"#cbd5e1",padding:2,borderRadius:3},badge:{fontSize:9,fontWeight:"800",paddingHorizontal:7,paddingVertical:4,borderRadius:9,overflow:"hidden",alignSelf:"flex-start"},good:{color:"#047857",backgroundColor:"#d1fae5"},warn:{color:"#b45309",backgroundColor:"#fef3c7"},bad:{color:"#475569",backgroundColor:"#e2e8f0"},exit:{color:"#be123c",backgroundColor:"#ffe4e6"},bodyText:{fontSize:11,color:"#334155"},action:{fontSize:11,fontWeight:"800",color:"#0284c7"},empty:{padding:32,alignItems:"center",gap:10},muted:{fontSize:11,color:"#64748b"},error:{fontSize:12,color:"#b91c1c"},pagination:{paddingVertical:8,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},pageButtons:{flexDirection:"row",gap:8},pageBtn:{paddingHorizontal:10,paddingVertical:7,borderWidth:1,borderColor:"#cbd5e1",borderRadius:6},modalBackdrop:{flex:1,backgroundColor:"rgba(15,23,42,.55)",justifyContent:"center",padding:14},modal:{maxHeight:"90%",backgroundColor:"white",borderRadius:12,padding:14},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:8},modalTitle:{fontSize:20,fontWeight:"800",color:"#0f172a"},section:{fontSize:13,fontWeight:"800",color:"#0f172a",marginTop:12,marginBottom:6},heroImage:{width:"100%",height:260,backgroundColor:"#f1f5f9"},plateImage:{width:"100%",height:100,backgroundColor:"#f1f5f9"},galleryImage:{width:120,height:80,marginVertical:4,borderRadius:6,backgroundColor:"#f1f5f9"} });
