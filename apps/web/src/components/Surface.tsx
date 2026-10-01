import React, { HTMLAttributes } from 'react';

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  position?: 'fixed' | 'absolute' | 'relative';
  inset?: number | string;
  zIndex?: number;
}

export function Surface({ position = 'relative', inset, zIndex, style, className = '', children, ...props }: SurfaceProps) {
  return (
    <div 
      className={className}
      style={{
        position,
        ...(inset !== undefined ? { inset } : {}),
        ...(zIndex !== undefined ? { zIndex } : {}),
        ...style
      }}
      {...props}
    >
      {children}
    </div>
  );
}
