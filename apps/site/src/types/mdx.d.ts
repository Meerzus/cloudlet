/* @types/mdx 2.0.14 refers to the global `JSX` namespace that @types/react 19 no longer declares; the site keeps `skipLibCheck: false`. */
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementClass = ReactJSX.ElementClass;
    type ElementType = ReactJSX.ElementType;
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}
