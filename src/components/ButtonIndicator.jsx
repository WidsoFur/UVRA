import React from 'react';

function ButtonIndicator({ label, active }) {
  return (
    <div
      className={`
        px-2 py-1.5 rounded-lg text-center text-[10px] font-medium transition-all duration-100
        ${active
          ? 'bg-uvra-accent/30 text-uvra-accent-light border border-uvra-accent/40 shadow-sm shadow-uvra-accent/20'
          : 'bg-uvra-border/50 text-uvra-text-dim border border-transparent'
        }
      `}
    >
      {label}
    </div>
  );
}

export default ButtonIndicator;
