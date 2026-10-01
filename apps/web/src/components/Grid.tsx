import type { CSSProperties, ElementType } from 'react';
import type { PolymorphicProps } from './polymorphic';

type GridOwnProps = {
  columns?: string;
  gap?: string;
  className?: string;
  style?: CSSProperties;
};

export type GridProps<T extends ElementType = 'div'> = PolymorphicProps<T, GridOwnProps>;

export function Grid<T extends ElementType = 'div'>({ columns = '1fr', gap = '0', as, style, className = '', children, ...props }: GridProps<T>) {
  const Component: ElementType = as ?? 'div';
  return (
    <Component 
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: columns,
        gap,
        ...style
      }}
      {...props}
    >
      {children}
    </Component>
  );
}
