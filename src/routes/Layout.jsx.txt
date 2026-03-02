import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const roleNavItems = {
  admin: [
    { path: '/admin', icon: '📊', label: 'Dashboard' },
    { path: '/vincular-minecraft', icon: '⛏️', label: 'Vincular Minecraft' },
    { path: '/admin/panel', icon: '🛡️', label: 'Admin Panel' },
    { path: '/admin/classes', icon: '🏫', label: 'Turmas' },
    { path: '/admin/reports', icon: '📈', label: 'Relatórios' },
    { path: '/secretary', icon: '🏢', label: 'Secretaria' },
    { path: '/teacher', icon: '👨‍🏫', label: 'View Professor' },
  ],
  secretary: [
    { path: '/secretary', icon: '📊', label: 'Dashboard' },
    { path: '/vincular-minecraft', icon: '⛏️', label: 'Vincular Minecraft' },
    { path: '/admin/panel', icon: '🛡️', label: 'Gerenciar Contas' },
    { path: '/admin/classes', icon: '🏫', label: 'Turmas' },
    { path: '/admin/reports', icon: '📈', label: 'Relatórios' },
  ],
  teacher: [
    { path: '/teacher', icon: '📊', label: 'Dashboard' },
    { path: '/vincular-minecraft', icon: '⛏️', label: 'Vincular Minecraft' },
    { path: '/teacher/questions', icon: '❓', label: 'Banco de Questões' },
    { path: '/teacher/assignments', icon: '📋', label: 'Atividades' },
    { path: '/teacher/submissions', icon: '📝', label: 'Entregas' },
    { path: '/teacher/design-review', icon: '🎨', label: 'Design Review' },
    { path: '/teacher/grades', icon: '📊', label: 'Notas' },
  ],
  student: [
    { path: '/student', icon: '🏠', label: 'Início' },
    { path: '/vincular-minecraft', icon: '⛏️', label: 'Vincular Minecraft' },
    { path: '/student/grades', icon: '📊', label: 'Minhas Notas' },
    { path: '/student/profile', icon: '👤', label: 'Perfil' },
  ]
};

export default function Layout({ children, title }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = roleNavItems[user?.role] || [];

  const roleColors = {
    admin: 'from-red-600 to-red-700',
    secretary: 'from-blue-600 to-blue-700',
    teacher: 'from-green-600 to-green-700',
    student: 'from-yellow-600 to-amber-700'
  };

  const roleNames = {
    admin: '👑 Administrador',
    secretary: '🏢 Secretaria',
    teacher: '👨‍🏫 Professor',
    student: '👨‍🎓 Aluno'
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 flex-shrink-0`}>
        {/* Logo */}
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-lg">⚡</span>
            </div>
            {sidebarOpen && (
              <div>
                <div className="text-white font-bold text-sm">CraftMind</div>
                <div className="text-purple-400 text-xs">Nexus Education</div>
              </div>
            )}
          </div>
        </div>

        {/* User info */}
        {sidebarOpen && (
          <div className={`p-3 mx-3 mt-3 rounded-xl bg-gradient-to-r ${roleColors[user?.role] || 'from-purple-600 to-indigo-600'} bg-opacity-20`}>
            <div className="text-white text-sm font-semibold truncate">{user?.displayName}</div>
            <div className="text-white/70 text-xs">{roleNames[user?.role]}</div>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 p-3 space-y-1 mt-2 overflow-y-auto">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm
                  ${isActive
                    ? 'bg-purple-600/30 text-purple-300 border border-purple-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
              >
                <span className="text-base flex-shrink-0">{item.icon}</span>
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="p-3 border-t border-slate-800 space-y-1">
          <Link to="/student/profile"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-sm">
            <span>⚙️</span>
            {sidebarOpen && <span>Configurações</span>}
          </Link>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-all text-sm">
            <span>🚪</span>
            {sidebarOpen && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="bg-slate-900/50 border-b border-slate-800 px-6 py-4 flex items-center gap-4 backdrop-blur">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-slate-400 hover:text-white transition-colors">
            <span className="text-xl">☰</span>
          </button>
          <h1 className="text-white font-semibold text-lg flex-1">{title}</h1>

          {/* Online indicator */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            Online
          </div>

          {/* Minecraft badge */}
          {user?.minecraftUsername && (
            <div className="px-3 py-1 bg-green-900/30 border border-green-700/30 rounded-full text-green-400 text-xs">
              🎮 {user.minecraftUsername}
            </div>
          )}
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
