import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import OfflineNotice from '../common/OfflineNotice';
import PwaInstallButton from '../common/PwaInstallButton';

const MainLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Listen for custom event from Header hamburger button
  useEffect(() => {
    const toggle = () => setSidebarOpen((prev) => !prev);
    window.addEventListener('toggle-sidebar', toggle);
    return () => window.removeEventListener('toggle-sidebar', toggle);
  }, []);

  // Close sidebar on navigation (handled by Sidebar onClick)
  const handleClose = () => setSidebarOpen(false);

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={handleClose} />
      <div className="app-main">
        <Header />
        <OfflineNotice />
        <main className="main-area">
          <Outlet />
        </main>
        {/* Floating PWA Install Button */}
        <PwaInstallButton variant="floating" />
      </div>
    </div>
  );
};

export default MainLayout;
