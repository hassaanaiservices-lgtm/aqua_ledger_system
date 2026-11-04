import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Package, Users, Truck, ShoppingCart, 
  Factory, CalendarDays, FileBarChart, Settings as SettingsIcon,
  LogOut, Menu, X, Droplets, Search, BookOpen
} from 'lucide-react';
import { AppProvider, useApp } from './components/ui';
import { api, getToken, setToken } from './lib/api';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import Vendors from './pages/Vendors';
import Sales from './pages/Sales';
import Purchases from './pages/Purchases';
import Assembly from './pages/Assembly';
import CalendarPage from './pages/CalendarPage';
import DayDiary from './pages/DayDiary';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Auth from './pages/Auth';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inventory', label: 'Product Inventory', icon: Package },
  { id: 'customers', label: 'Customer Ledger', icon: Users },
  { id: 'vendors', label: 'Vendor Ledger', icon: Truck },
  { id: 'sales', label: 'Sales & Invoices', icon: ShoppingCart },
  { id: 'purchases', label: 'Purchases', icon: Truck },
  { id: 'assembly', label: 'Assembly & BOM', icon: Factory },
  { id: 'daydiary', label: 'Day Diary & Accounts', icon: BookOpen },
  { id: 'calendar', label: 'Business Calendar', icon: CalendarDays },
  { id: 'reports', label: 'Reports & Export', icon: FileBarChart },
  { id: 'settings', label: 'Settings & Backup', icon: SettingsIcon },
];

function MainLayout() {
  const { settings } = useApp();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    setToken(null);
    window.location.reload();
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'inventory':
        return <Inventory onNavigate={setCurrentPage} />;
      case 'customers':
        return <Customers onNavigate={setCurrentPage} />;
      case 'vendors':
        return <Vendors onNavigate={setCurrentPage} />;
      case 'sales':
        return <Sales onNavigate={setCurrentPage} />;
      case 'purchases':
        return <Purchases onNavigate={setCurrentPage} />;
      case 'assembly':
        return <Assembly onNavigate={setCurrentPage} />;
      case 'daydiary':
        return <DayDiary onNavigate={setCurrentPage} />;
      case 'calendar':
        return <CalendarPage onNavigate={setCurrentPage} />;
      case 'reports':
        return <Reports onNavigate={setCurrentPage} />;
      case 'settings':
        return <Settings onNavigate={setCurrentPage} />;
      default:
        return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  return (
    <div className="app">
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo" style={settings.business_logo ? { padding: 0, overflow: 'hidden', background: 'transparent' } : undefined}>
            {settings.business_logo ? (
              <img src={settings.business_logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <Droplets size={22} />
            )}
          </div>
          <div>
            <div className="brand-name">{settings.business_name || 'Aqua Home'}</div>
            {settings.business_tagline !== '' && (
              <div className="brand-sub">{settings.business_tagline ?? 'Management System'}</div>
            )}
          </div>
        </div>

        <nav className="nav">
          <div className="nav-section">Operations</div>
          {NAV_ITEMS.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <a 
                key={item.id} 
                href={`#${item.id}`}
                className={active ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  setCurrentPage(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            );
          })}

          <div className="nav-section">Manufacturing & Finance</div>
          {NAV_ITEMS.slice(5).map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <a 
                key={item.id} 
                href={`#${item.id}`}
                className={active ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  setCurrentPage(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="main">
        <header className="topbar">
          <div className="topbar-date-card">
            <CalendarDays size={16} className="date-icon" />
            <div className="date-text">
              <span className="day-name">{new Date().toLocaleDateString('en-GB', { weekday: 'long' })},</span>
              <span className="full-date">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
        </header>

        <main className="content">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [authStatus, setAuthStatus] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const status = await api.get('/auth/status');
      setAuthStatus(status);
      if (!status.password_set) {
        // First run or no password set
        setAuthenticated(true);
      } else if (getToken()) {
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
      }
    } catch {
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
    const handleLogoutEvent = () => setAuthenticated(false);
    window.addEventListener('bms:logout', handleLogoutEvent);
    return () => window.removeEventListener('bms:logout', handleLogoutEvent);
  }, []);

  if (loading) {
    return (
      <div className="loading" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!authenticated) {
    return <Auth status={authStatus} onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
