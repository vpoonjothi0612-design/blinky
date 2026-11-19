import React, { useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import { Icons } from '../common/Icons';
import { preloadNavigationPage } from '../../routes/pagePreload';

const NAV_SECTIONS = [
  {
    title: 'OVERVIEW',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: Icons.dashboard },
    ],
  },
  {
    title: 'PEOPLE',
    items: [
      { label: 'Employees', path: '/employees', icon: Icons.employees },
      { label: 'Face Registry', path: '/face-enrollments', icon: Icons.face },
      { label: 'Attendance Log', path: '/attendance', icon: Icons.attendance },
    ],
  },
  {
    title: 'SURVEILLANCE',
    items: [
      { label: 'Live Monitoring', path: '/live-monitoring', icon: Icons.camera },
      { label: 'Camera Feeds', path: '/cameras', icon: Icons.camera },
      { label: 'Vehicles', path: '/vehicles', icon: Icons.vehicle },
      { label: 'Unrecognized Faces', path: '/unknown-faces', icon: Icons.shieldAlert },
    ],
  },
  {
    title: 'INSIGHTS',
    items: [
      { label: 'Reports', path: '/reports', icon: Icons.reports },
    ],
  },
  {
    title: 'ACCESS CONTROL',
    items: [
      { label: 'Users', path: '/staff-security', icon: Icons.employees || Icons.shieldCheck },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { label: 'Settings', path: '/settings', icon: Icons.settings },
    ],
  },
];

const Sidebar = ({ open, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const displayName = user?.name || user?.email || 'User';
  const companyName = user?.company || 'Enterprise Attendance';
  const initials = displayName.slice(0, 2).toUpperCase();

  // Normalize role
  const effectiveRole = useMemo(() => {
    const r = (user?.role || '').toUpperCase();
    if (r === 'SUPER_ADMIN') return 'ADMIN';
    if (r === 'USER') return 'STAFF';
    return r || 'STAFF';
  }, [user]);

  // Role-Aware Navigation Menu Structure (Ensures Live Monitoring is present for all roles)
  const navSections = useMemo(() => {
    if (effectiveRole === 'ADMIN') {
      return [
        {
          title: 'OVERVIEW',
          items: [
            { label: 'Dashboard', path: '/dashboard', icon: Icons.dashboard },
          ],
        },
        {
          title: 'PEOPLE',
          items: [
            { label: 'Employees', path: '/employees', icon: Icons.employees },
            { label: 'Face Registry', path: '/face-enrollments', icon: Icons.face },
            { label: 'Attendance Log', path: '/attendance', icon: Icons.attendance },
          ],
        },
        {
          title: 'SURVEILLANCE',
          items: [
            { label: 'Live Monitoring', path: '/live-monitoring', icon: Icons.camera },
            { label: 'Camera Feeds', path: '/cameras', icon: Icons.camera },
            { label: 'Vehicles', path: '/vehicles', icon: Icons.vehicle },
            { label: 'Unrecognized Faces', path: '/unknown-faces', icon: Icons.shieldAlert },
          ],
        },
        {
          title: 'INSIGHTS',
          items: [
            { label: 'Reports', path: '/reports', icon: Icons.reports },
            { label: 'Logs', path: '/photo-log', icon: Icons.face },
          ],
        },
        {
          title: 'ACCESS CONTROL',
          items: [
            { label: 'Users', path: '/staff-security', icon: Icons.employees || Icons.shieldCheck },
          ],
        },
        {
          title: 'SYSTEM',
          items: [
            { label: 'Settings', path: '/settings', icon: Icons.settings },
          ],
        },
      ];
    }

    if (effectiveRole === 'SECURITY') {
      return [
        {
          title: 'OVERVIEW',
          items: [
            { label: 'Security Dashboard', path: '/dashboard', icon: Icons.dashboard },
          ],
        },
        {
          title: 'SURVEILLANCE',
          items: [
            { label: 'Live Monitoring', path: '/live-monitoring', icon: Icons.camera },
            { label: 'Unrecognized Faces', path: '/unknown-faces', icon: Icons.shieldAlert },
            { label: 'Camera Feeds', path: '/cameras', icon: Icons.camera },
            { label: 'Vehicles', path: '/vehicles', icon: Icons.vehicle },
          ],
        },
        {
          title: 'VERIFICATION',
          items: [
            { label: 'Personnel Lookup', path: '/employees', icon: Icons.employees },
          ],
        },
        {
          title: 'GATE ATTENDANCE',
          items: [
            { label: 'Attendance Log', path: '/attendance', icon: Icons.attendance },
          ],
        },
        {
          title: 'INSIGHTS',
          items: [
            { label: 'Photo Log', path: '/photo-log', icon: Icons.face },
          ],
        },
        {
          title: 'SYSTEM',
          items: [
            { label: 'Profile Settings', path: '/settings', icon: Icons.settings },
          ],
        },
      ];
    }

    // Default: STAFF / USER Role
    return [
      {
        title: 'OVERVIEW',
        items: [
          { label: 'My Dashboard', path: '/dashboard', icon: Icons.dashboard },
        ],
      },
      {
        title: 'GATE & SURVEILLANCE',
        items: [
          { label: 'Live Monitoring', path: '/live-monitoring', icon: Icons.camera },
          { label: 'Attendance Log', path: '/attendance', icon: Icons.attendance },
        ],
      },
      {
        title: 'INSIGHTS',
        items: [
          { label: 'My Reports', path: '/reports', icon: Icons.reports },
        ],
      },
      {
        title: 'ACCOUNT',
        items: [
          { label: 'Profile & Password', path: '/settings', icon: Icons.settings },
        ],
      },
    ];
  }, [effectiveRole]);

  return (
    <>
      {open && (
        <div
          className="sidebar-overlay open"
          onClick={onClose}
          aria-label="Close sidebar"
        />
      )}

      <aside className={`sidebar${open ? ' open' : ''}`} role="navigation">
        <div className="sidebar-brand-block">
          <div className="sidebar-logo">{Icons.logo}</div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">FaceDetect</span>
            <span className="sidebar-brand-sub">ENTERPRISE ATTENDANCE</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section, sIdx) => (
            <div key={section.title || sIdx} className="sidebar-nav-section">
              {section.title && <div className="sidebar-menu-label">{section.title}</div>}
              <div className="sidebar-nav-list">
                {section.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onMouseEnter={() => preloadNavigationPage(item.path).catch(() => {})}
                    onFocus={() => preloadNavigationPage(item.path).catch(() => {})}
                    onTouchStart={() => preloadNavigationPage(item.path).catch(() => {})}
                    className={({ isActive }) =>
                      `sidebar-nav-link${isActive ? ' active' : ''}`
                    }
                    onClick={onClose}
                  >
                    <span className="sidebar-nav-icon">{item.icon}</span>
                    <span className="sidebar-nav-text">{item.label}</span>
                    {item.path === '/live-monitoring' && (
                      <span className="sidebar-badge-alarm" style={{ background: '#10b981', color: '#fff' }}>LIVE</span>
                    )}
                    {item.path === '/unknown-faces' && (
                      <span className="sidebar-badge-alarm">ALARM</span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div
          className="sidebar-user-block sidebar-user-block-clickable"
          onClick={() => {
            navigate('/settings');
            onClose && onClose();
          }}
          title="Click to view & edit Profile / Settings"
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
        >
          <div className="sidebar-user-avatar">{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-role">
              {effectiveRole === 'SECURITY'
                ? '🚨 SECURITY OFFICER'
                : effectiveRole === 'ADMIN'
                ? '🛡️ ADMINISTRATOR'
                : effectiveRole === 'STAFF'
                ? '👤 STAFF MEMBER'
                : companyName}
            </div>
          </div>
          <button
            className="sidebar-logout-action"
            onClick={(e) => {
              e.stopPropagation();
              handleLogout();
            }}
            title="Sign out"
            aria-label="Sign out"
          >
            <span className="sidebar-logout-icon">{Icons.logout}</span>
          </button>
        </div>

        <div className="sidebar-weather-block">
          <div className="sidebar-weather-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </div>
          <div className="sidebar-weather-info">
            <div className="sidebar-weather-temp">31°C Sunny</div>
            <div className="sidebar-weather-meta">GATE SENSORS OPTIMAL</div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
