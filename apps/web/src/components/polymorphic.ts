import type { ComponentPropsWithRef, ElementType } from 'react'

// Props for a primitive rendered as `as` (a tag like 'article' or a component like
// motion.main). The element's own props — including `ref` (React 19) and motion
// props such as `layout`/`variants` — are typed from whatever `as` is.
export type PolymorphicProps<T extends ElementType, Own = object> = Own & { as?: T } & Omit<
  ComponentPropsWithRef<T>,
  keyof Own | 'as'
>
