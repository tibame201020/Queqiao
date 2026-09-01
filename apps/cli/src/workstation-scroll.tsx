import { Box, useBoxMetrics, type DOMElement } from "ink";
import { useEffect, useRef } from "react";

export type WorkstationScrollTarget = { start: number; height?: number };

export function clampScrollOffset(offset: number, contentHeight: number, viewportHeight: number): number {
  const maxOffset = Math.max(0, contentHeight - viewportHeight);
  return Math.min(Math.max(offset, 0), maxOffset);
}

export function ensureVisibleScrollOffset(
  offset: number,
  target: WorkstationScrollTarget,
  contentHeight: number,
  viewportHeight: number,
): number {
  if (viewportHeight <= 0) return 0;
  const targetHeight = Math.max(1, target.height ?? 1);
  let next = clampScrollOffset(offset, contentHeight, viewportHeight);
  if (target.start < next) next = target.start;
  else if (target.start + targetHeight > next + viewportHeight) next = target.start + targetHeight - viewportHeight;
  return clampScrollOffset(next, contentHeight, viewportHeight);
}

type Props = {
  children: React.ReactNode;
  offset: number;
  target?: WorkstationScrollTarget;
  onOffsetChange?: (offset: number) => void;
  onMaxOffsetChange?: (maxOffset: number) => void;
};

export function WorkstationScrollViewport({ children, offset, target, onOffsetChange, onMaxOffsetChange }: Props) {
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const viewport = useBoxMetrics(viewportRef);
  const content = useBoxMetrics(contentRef);
  const effectiveOffset = clampScrollOffset(offset, content.height, viewport.height);
  const maxOffset = Math.max(0, content.height - viewport.height);

  useEffect(() => {
    if (effectiveOffset !== offset) onOffsetChange?.(effectiveOffset);
  }, [effectiveOffset, offset, onOffsetChange]);

  useEffect(() => { onMaxOffsetChange?.(maxOffset); }, [maxOffset, onMaxOffsetChange]);

  useEffect(() => {
    if (!target || !viewport.hasMeasured || !content.hasMeasured || !onOffsetChange) return;
    const next = ensureVisibleScrollOffset(effectiveOffset, target, content.height, viewport.height);
    if (next !== effectiveOffset) onOffsetChange(next);
  }, [target?.start, target?.height, viewport.hasMeasured, viewport.height, content.hasMeasured, content.height, effectiveOffset, onOffsetChange]);

  return <Box ref={viewportRef} flexDirection="column" flexGrow={1} minHeight={0} overflowY="hidden">
    <Box ref={contentRef} position="relative" top={effectiveOffset ? -effectiveOffset : 0} flexDirection="column" flexShrink={0}>{children}</Box>
  </Box>;
}
