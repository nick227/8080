import React, { HTMLAttributes } from 'react';

interface RuleProps extends HTMLAttributes<HTMLHRElement> {
  direction?: 'horizontal' | 'vertical';
  color?: string;
}

export function Rule({ direction = 'horizontal', color = 'var(--line)', style, ...props }: RuleProps) {
  return (
    <hr 
      style={{
        border: 'none',
        [direction === 'horizontal' ? 'borderTop' : 'borderLeft']: `var(--line-width) solid ${color}`,
        margin: 0,
        padding: 0,
        height: direction === 'horizontal' ? 0 : 'auto',
        ...style
      }} 
      {...props} 
    />
  );
}
