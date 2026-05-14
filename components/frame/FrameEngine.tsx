import React, { memo } from 'react';
import { FramePNGOverlay } from './FramePNGOverlay';
import { FrameStaticLayout, FrameStaticLeft, FrameStaticRight } from './FrameStaticLayout';
import type { FrameStaticLayoutProps } from './FrameStaticLayout';

export type FrameEngineProps = {
  frameId: number;
  /** When false, skip mounting composer (perf: off-screen carousel slides). */
  mountComposer: boolean;
  /** For frame 3+: static chrome mirrors Frame 1 (right) unless global slot 2 is selected in parent — passed in. */
  staticChromeSide: 'left' | 'right';
  overlayPngUrl: string | null;
} & Omit<FrameStaticLayoutProps, 'side'>;

function FrameEngineInner({
  frameId,
  mountComposer,
  staticChromeSide,
  overlayPngUrl,
  ...staticProps
}: FrameEngineProps) {
  if (!mountComposer) return null;

  if (frameId === 1) {
    return <FrameStaticRight {...staticProps} />;
  }
  if (frameId === 2) {
    return <FrameStaticLeft {...staticProps} />;
  }
  if (frameId >= 3) {
    // User PNG frames are full-bleed overlays; do not stack static chrome underneath (double frame).
    if (overlayPngUrl) {
      return <FramePNGOverlay overlayUrl={overlayPngUrl} />;
    }
    return <FrameStaticLayout {...staticProps} side={staticChromeSide} />;
  }
  return null;
}

export const FrameEngine = memo(FrameEngineInner);
