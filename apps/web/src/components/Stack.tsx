import type { CSSProperties, ElementType } from 'react';
import type { PolymorphicProps } from './polymorphic';

type StackOwnProps = {
  direction?: 'column' | 'row';
  justify?: 'start' | 'end' | 'center' | 'between' | 'around';
  align?: 'start' | 'end' | 'center' | 'stretch' | 'baseline';
  gap?: 'none' | 'small' | 'medium' | 'large' | 'xlarge';
  className?: string;
  style?: CSSProperties;
};

export type StackProps<T extends ElementType = 'div'> = PolymorphicProps<T, StackOwnProps>;

export function Stack<T extends ElementType = 'div'>({ 
  direction = 'column', 
  justify = 'start', 
  align = 'stretch', 
  gap = 'none', 
  as,
  style,
  className = '',
  children,
  ...props 
}: StackProps<T>) {
  const Component: ElementType = as ?? 'div';
  const gapMap = { none: '0', small: '10px', medium: '14px', large: '18px', xlarge: '24px' };
  const justifyMap = { start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around' };
  const alignMap = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline' };

  return (
    <Component 
      className={className}
      style={{
        display: 'flex',
        flexDirection: direction,
        justifyContent: justifyMap[justify],
        alignItems: alignMap[align],
        gap: gapMap[gap],
        ...style
      }}
      {...props}
    >
      {children}
    </Component>
  );
}
