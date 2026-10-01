import type { ElementType, ReactNode } from 'react';
import type { PolymorphicProps } from './polymorphic';

type ControlOwnProps = {
  icon?: ReactNode;
  count?: string | number;
  variant?: 'action' | 'record' | 'default';
  active?: boolean;
  className?: string;
};

// `as` lets callers render e.g. motion.button so drag/layout props reach motion
// instead of leaking onto a plain <button> as unknown DOM attributes.
export type ControlProps<T extends ElementType = 'button'> = PolymorphicProps<T, ControlOwnProps>;

export function Control<T extends ElementType = 'button'>({ as, icon, count, variant = 'action', active, className = '', children, ...props }: ControlProps<T>) {
  const Component: ElementType = as ?? 'button';
  const baseClass = variant === 'action' ? 'action' : variant === 'record' ? 'record-button' : '';
  const activeClass = active ? 'active' : '';
  
  return (
    <Component 
      className={`${baseClass} ${activeClass} ${className}`.trim()} 
      aria-pressed={active !== undefined ? active : undefined}
      {...props}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {count != null && <span aria-hidden="true" style={{ marginLeft: 4 }}>{count}</span>}
      {children}
    </Component>
  );
}

