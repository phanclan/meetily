import { useEffect, type RefObject } from 'react';

/** Keep wrapped titles visible when the window or sidebar changes width. */
export function useAutoSizeTitle(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  layoutKey?: boolean,
) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const resize = () => {
      element.style.height = '0px';
      const height = element.scrollHeight;
      element.style.height = `${Math.min(height, 180)}px`;
      element.style.overflowY = height > 180 ? 'auto' : 'hidden';
    };
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    resize();
    observer.observe(element);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [ref, value, layoutKey]);
}
