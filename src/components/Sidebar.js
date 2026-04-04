import React from 'react';
import { LayoutDashboard, Settings, Hand, Cpu } from 'lucide-react';

const tabs = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Панель' },
  { id: 'driver', icon: Cpu, label: 'Драйвер' },
  { id: 'settings', icon: Settings, label: 'Настройки' },
];

function Sidebar({ activeTab, onTabChange }) {
  return (
    <div className="w-16 bg-uvra-card border-r border-uvra-border flex flex-col items-center py-4 gap-2 shrink-0">
      {tabs.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={`
            w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-200
            ${activeTab === id
              ? 'bg-uvra-accent/20 text-uvra-accent shadow-lg shadow-uvra-accent/10'
              : 'text-uvra-text-dim hover:text-uvra-text hover:bg-uvra-border/50'
            }
          `}
          title={label}
        >
          <Icon size={18} />
          <span className="text-[9px] font-medium">{label}</span>
        </button>
      ))}

      <div className="flex-1" />

      <div className="w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 text-uvra-text-dim">
        <Hand size={16} />
        <span className="text-[8px]">VR</span>
      </div>
    </div>
  );
}

export default Sidebar;
