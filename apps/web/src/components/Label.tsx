import type { ElementType } from 'react';
import type { PolymorphicProps } from './polymorphic';

type LabelOwnProps = {
  variant?: 'sequence' | 'meta' | 'time' | 'caption' | 'eyebrow' | 'reference' | 'h1' | 'status' | 'default';
  className?: string;
};

export type LabelProps<T extends ElementType = 'span'> = PolymorphicProps<T, LabelOwnProps>;

export function Label<T extends ElementType = 'span'>({ variant = 'default', as: Component, className = '', children, ...props }: LabelProps<T>) {
  const variantClassMap: Record<string, string> = {
    sequence: 'item-no',
    meta: 'item-meta',
    time: 'time',
    caption: 'item-text',
    eyebrow: 'eyebrow',
    reference: 'ref',
    h1: '', 
    status: 'status',
    default: ''
  };

  let DefaultElement: ElementType = 'span';
  if (variant === 'h1') DefaultElement = 'h1';
  if (variant === 'caption') DefaultElement = 'p';

  const Element: ElementType = Component || DefaultElement;
  const mappedClass = variantClassMap[variant] || '';

  return (
    <Element className={`${mappedClass} ${className}`.trim()} {...props}>
      {children}
    </Element>
  );
}
