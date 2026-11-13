"use client";

import { anchoredScroll, clampZoom, pinchZoom, wheelZoom, ZOOM_STEP } from "@/lib/zoom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Point = { x: number; y: number };

/** Safari's trackpad pinch, which sends no wheel events. Not in the DOM typings. */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };

/**
 * Zoom for a scrolling view: two-finger pinch, ctrl/⌘ + wheel (which is also
 * how Chrome and Firefox report a trackpad pinch), Safari's gesture events,
 * and buttons. The point under the fingers or pointer stays put; buttons zoom
 * around the middle of the view.
 */
export function useZoom(viewRef: RefObject<HTMLElement | null>) {
  const [zoom, setZoom] = useState(1);
  // The latest zoom for event handlers that fire faster than React renders.
  const zoomRef = useRef(1);
  // Where to scroll once the new zoom is laid out.
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  const zoomTo = useCallback(
    (target: number, anchor?: Point) => {
      const view = viewRef.current;
      if (!view) return;
      const from = zoomRef.current;
      const to = clampZoom(target, view.clientWidth);
      if (to === from) return;
      const x = anchor?.x ?? view.clientWidth / 2;
      const y = anchor?.y ?? view.clientHeight / 2;
      pendingScroll.current = {
        left: anchoredScroll(view.scrollLeft, x, from, to),
        top: anchoredScroll(view.scrollTop, y, from, to),
      };
      zoomRef.current = to;
      setZoom(to);
    },
    [viewRef],
  );

  useLayoutEffect(() => {
    const view = viewRef.current;
    const scroll = pendingScroll.current;
    if (!view || !scroll) return;
    pendingScroll.current = null;
    view.scrollLeft = scroll.left;
    view.scrollTop = scroll.top;
  }, [zoom, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const at = (clientX: number, clientY: number): Point => {
      const rect = view.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    let pinch: { distance: number; zoom: number } | null = null;
    let gestureStart = 1;

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      // Otherwise the browser zooms the whole page.
      event.preventDefault();
      zoomTo(wheelZoom(zoomRef.current, event.deltaY, event.deltaMode), at(event.clientX, event.clientY));
    }

    function fingers(event: TouchEvent) {
      const [a, b] = [event.touches[0], event.touches[1]];
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        middle: at((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
      };
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length === 2) pinch = { distance: fingers(event).distance, zoom: zoomRef.current };
    }

    function onTouchMove(event: TouchEvent) {
      if (!pinch || event.touches.length !== 2) return;
      // The view only allows one-finger panning (touch-pan-x/y), so two fingers are ours.
      event.preventDefault();
      const { distance, middle } = fingers(event);
      zoomTo(pinchZoom(pinch.zoom, pinch.distance, distance), middle);
    }

    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinch = null;
    }

    function onGestureStart(event: Event) {
      event.preventDefault();
      gestureStart = zoomRef.current;
    }

    function onGestureChange(event: Event) {
      event.preventDefault();
      // On iOS the touch handlers already follow the pinch.
      if (pinch) return;
      const gesture = event as GestureEvent;
      zoomTo(gestureStart * gesture.scale, at(gesture.clientX, gesture.clientY));
    }

    const active = { passive: false };
    view.addEventListener("wheel", onWheel, active);
    view.addEventListener("touchstart", onTouchStart);
    view.addEventListener("touchmove", onTouchMove, active);
    view.addEventListener("touchend", onTouchEnd);
    view.addEventListener("touchcancel", onTouchEnd);
    view.addEventListener("gesturestart", onGestureStart, active);
    view.addEventListener("gesturechange", onGestureChange, active);
    return () => {
      view.removeEventListener("wheel", onWheel);
      view.removeEventListener("touchstart", onTouchStart);
      view.removeEventListener("touchmove", onTouchMove);
      view.removeEventListener("touchend", onTouchEnd);
      view.removeEventListener("touchcancel", onTouchEnd);
      view.removeEventListener("gesturestart", onGestureStart);
      view.removeEventListener("gesturechange", onGestureChange);
    };
  }, [viewRef, zoomTo]);

  return {
    zoom,
    zoomIn: () => zoomTo(zoomRef.current * ZOOM_STEP),
    zoomOut: () => zoomTo(zoomRef.current / ZOOM_STEP),
    reset: () => zoomTo(1),
  };
}
