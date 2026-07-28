import { ref, type Ref } from 'vue';

const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE_PX = 10;

/**
 * Right-click + long-press helpers that open a positioned menu without
 * fighting normal left-click navigation.
 */
export function useLongPressMenu<T>(
  open: (item: T, x: number, y: number) => void
) {
  const suppressClick: Ref<boolean> = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let activeItem: T | null = null;
  let longPressFired = false;

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onContextMenu(item: T, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    open(item, e.clientX, e.clientY);
  }

  function onPointerDown(item: T, e: PointerEvent) {
    // Right-click is handled by contextmenu
    if (e.button !== 0) return;

    clearTimer();
    activeItem = item;
    longPressFired = false;
    startX = e.clientX;
    startY = e.clientY;

    timer = setTimeout(() => {
      timer = null;
      if (activeItem == null) return;
      longPressFired = true;
      suppressClick.value = true;
      open(activeItem, startX, startY);
      // Clear suppress after the click that often follows a hold
      window.setTimeout(() => {
        suppressClick.value = false;
      }, 400);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: PointerEvent) {
    if (timer == null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
      clearTimer();
      activeItem = null;
    }
  }

  function onPointerEnd() {
    clearTimer();
    activeItem = null;
  }

  /** Call at the start of click handlers; returns true if the click should be ignored. */
  function shouldSuppressClick(): boolean {
    if (suppressClick.value || longPressFired) {
      longPressFired = false;
      suppressClick.value = false;
      return true;
    }
    return false;
  }

  return {
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    shouldSuppressClick,
  };
}
