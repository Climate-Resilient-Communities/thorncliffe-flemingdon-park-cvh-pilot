/**
 * Keeps keyboard focus clear of Screen's sticky actions region: sets the nearest scroll container's
 * scroll-padding-block-end to the region's measured block size, and keeps it in step as the region
 * resizes. Returns a function that undoes it. Self-contained, so it can also run in a test page.
 */
export function reserveActionsSpace(region: HTMLElement): () => void {
  let scroller: HTMLElement | null = region.parentElement;
  while (scroller && !/(auto|scroll|overlay)/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  const target = scroller ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  const previous = target.style.scrollPaddingBlockEnd;
  const update = () => {
    target.style.scrollPaddingBlockEnd = `${region.getBoundingClientRect().height}px`;
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(region);
  return () => {
    observer.disconnect();
    target.style.scrollPaddingBlockEnd = previous;
  };
}
