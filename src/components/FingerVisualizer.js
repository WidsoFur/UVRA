import React from 'react';

function FingerVisualizer({ joints, name, shortName }) {
  const avgCurl = joints.reduce((s, v) => s + v, 0) / joints.length;
  const percentage = Math.round(avgCurl * 100);

  return (
    <div className="flex-1 flex flex-col items-center gap-1 h-full">
      <div className="text-[10px] text-uvra-accent font-mono">{percentage}%</div>

      <div className="flex-1 w-full flex gap-0.5 items-end min-h-0">
        {joints.map((val, i) => (
          <div key={i} className="flex-1 bg-uvra-border rounded-t-sm overflow-hidden flex flex-col justify-end h-full">
            <div
              className="finger-bar rounded-t-sm transition-all duration-100"
              style={{
                height: `${val * 100}%`,
                background: `linear-gradient(to top, 
                  hsl(${260 - val * 60}, 70%, ${45 + val * 15}%), 
                  hsl(${270 - val * 40}, 80%, ${55 + val * 10}%))`,
              }}
            />
          </div>
        ))}
      </div>

      <div className="text-[10px] text-uvra-text-dim font-medium mt-1" title={name}>
        {shortName}
      </div>
    </div>
  );
}

export default FingerVisualizer;
