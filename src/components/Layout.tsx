import type { ReactNode } from 'react';
import { Home, PieChart, SlidersHorizontal, UploadCloud, LogOut } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useDriveSync } from '../DriveSyncContext.jsx';

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { clearAccessToken } = useDriveSync() as any;

  const navItems = [
    { name: 'Transactions', path: '/', icon: Home },
    { name: 'Rules', path: '/rules', icon: SlidersHorizontal },
    { name: 'Analytics', path: '/analytics', icon: PieChart },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shadow-sm relative z-10">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <UploadCloud className="h-6 w-6 text-primary-600 mr-3" />
          <div className="leading-tight">
            <span className="block font-bold text-sm tracking-tight text-gray-900">BetterView</span>
            <span className="block text-[11px] text-gray-500">Built out of pure financial spite.</span>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${isActive
                  ? 'bg-primary-50 text-primary-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
              >
                <Icon className="h-5 w-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={clearAccessToken}
            className="flex items-center w-full px-4 py-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition-colors"
          >
            <LogOut className="h-5 w-5 mr-3" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-transparent to-blue-50/30"></div>
        <div className="flex-1 overflow-y-auto p-8 relative z-0">
          {children}
        </div>
      </main>
    </div>
  );
}
