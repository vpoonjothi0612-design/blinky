# VisionGuard React Native Mobile App 📱🛡️

A pure **React Native** mobile application built specifically for smartphones (Android & iOS via Expo / React Native) for real-time facility attendance tracking and instant red-signal security intrusion alerts.

---

## 📁 Architecture (Frontend-Only Mobile App)

No separate backend needed in `app/`. The mobile app connects directly to the system backend running at `http://localhost:3000/api` (or your LAN IP `http://192.168.1.19:3000/api`).

```
app/
├── src/
│   ├── components/
│   │   ├── Header.js          # Native header with CCTV live sync pill, Role badge & emergency bell
│   │   ├── BottomNav.js       # Native bottom tab bar (Overview, Employees, Radar, Reports, Settings)
│   │   ├── StatCard.js        # KPI cards (Today Present, Currently IN, Currently OUT, Unknown Faces)
│   │   ├── RedSignalBanner.js # Pulsing emergency banner
│   │   └── RedSignalModal.js  # Fullscreen alert modal with snapshot, camera gate & vibration status
│   │
│   ├── screens/
│   │   ├── LoginScreen.js         # 1-Tap persona selector (Admin, Staff, Security) + backend IP config
│   │   ├── DashboardScreen.js     # Live Present/IN/OUT counts, CCTV gate status & live stream
│   │   ├── EmployeesScreen.js     # Filter chips (All, IN, OUT, Absent), search & punch details
│   │   ├── UnknownRadarScreen.js  # CCTV Unregistered Face Surveillance & snapshot lightbox
│   │   ├── ReportsScreen.js       # Daily attendance rate, 7-day trend chart (Admin/Staff only)
│   │   └── ProfileScreen.js       # 1-Tap role switcher, phone vibration hardware test, logout
│   │
│   ├── context/
│   │   ├── AuthContext.js     # 3 User Roles (Admin, Staff, Security) & 1-tap demo switcher
│   │   └── AlertContext.js    # React Native Vibration API & animated red signal loop
│   │
│   ├── services/
│   │   ├── api.js             # Axios client with JWT interceptors
│   │   └── attendanceService.js # Metrics computation (Present, IN, OUT, Gate status)
│   │
│   ├── config/
│   │   └── apiConfig.js       # Dynamic backend host resolution (LAN IP / Emulator / Localhost)
│   │
│   └── theme/
│       └── colors.js          # Dark cyber-sentinel design system
│
├── App.js                     # Root component with SafeAreaView, Providers & Animated border
├── index.js                   # Expo root registration
├── app.json                   # React Native / Expo configuration with VIBRATE permissions
├── babel.config.js            # Babel preset
├── start_app.cmd              # 1-Click launcher
└── package.json
```

---

## 👥 3 User Roles & Conditions

| Role | Access & Features |
| :--- | :--- |
| 🛡️ **Admin** | • View today's total present employees count<br>• View currently IN count and currently OUT count<br>• View overall attendance & audit reports (Today + 7-Day Trend)<br>• **Unknown person detected -> Real-time Red Signal Alert + Phone Vibration!** |
| 👔 **Staff** | • *Same features as Admin:* Today present count, IN count, OUT count, overall reports, unknown person red signal alert + phone vibration |
| 👮 **Security** | • **View-Only Access**: View employees roster (who is currently inside facility vs outside)<br>• **Unknown Persons Radar**: View unrecognized visitor CCTV feed snapshots<br>• **Unknown person detected -> Real-time Red Signal Alert + Phone Vibration!**<br>• *Administrative & executive reports locked* |

### Pre-Configured Demo Accounts:
- **Admin**: `admin@app.com` / `admin123`
- **Staff**: `staff@app.com` / `staff123`
- **Security**: `security@app.com` / `security123`

*(The Login and Settings screens include **1-Tap Demo Switcher buttons** so you can switch between Admin, Staff, and Security instantly on your phone!)*

---

## 🚨 Red Signal & Phone Vibration Engine (React Native)

Whenever an unknown/unregistered person enters the facility (captured by `CAM-02 Entrance` or `CAM-01 Exit`):
1. **Phone Vibration**: Triggers native `Vibration.vibrate([300, 150, 300, 150, 600])` with an emergency repeating pulse.
2. **Red Signal Animation**: An `Animated.loop` pulsates the entire screen border and warning banner with a bright neon red aura (`#ef4444`).
3. **Emergency Modal**: Displays CCTV capture snapshot, exact camera name and location, timestamp, and vibration status.
4. **Hardware Test Button**: A **"Vibrate Phone" / "Test Alert"** button is built into the Header and Profile screens so you can test phone vibration immediately!

---

## 🚀 How to Run the React Native App

### Option 1: 1-Click Launcher (Windows)
Double-click `app/start_app.cmd`.

### Option 2: Command Line
```powershell
cd app
npm start
```

### 📱 Previewing on Your Device:
1. **On your Physical Smartphone (Android / iPhone)**:
   - Install **Expo Go** from Google Play Store or Apple App Store.
   - Scan the QR code shown in your terminal.
2. **In Mobile Browser / Web**:
   - Run `npm run web` or press `w` in terminal to launch the mobile browser preview!
