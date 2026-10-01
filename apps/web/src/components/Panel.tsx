import type { ElementType } from 'react';
import type { PolymorphicProps } from './polymorphic';

type PanelOwnProps = {
  variant?: 'default' | 'shell' | 'item' | 'takeover' | 'header' | 'footer' | 'reply-strip';
  className?: string;
};

export type PanelProps<T extends ElementType = 'div'> = PolymorphicProps<T, PanelOwnProps>;

export function Panel<T extends ElementType = 'div'>({ as, variant = 'default', className = '', children, ...props }: PanelProps<T>) {
  const Component: ElementType = as ?? 'div';
  const baseClass = variant !== 'default' ? variant : '';
  return (
    <Component className={`${baseClass} ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}
