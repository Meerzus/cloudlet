/** Layout-viewport CSS pixels. Deliberately never read VisualViewport.scale. */
export function visibleViewport(width: number, height: number, visual?: {
  readonly offsetLeft: number; readonly offsetTop: number; readonly width: number; readonly height: number;
} | null) {
  const left = Math.min(width, Math.max(0, visual?.offsetLeft ?? 0));
  const top = Math.min(height, Math.max(0, visual?.offsetTop ?? 0));
  const right = Math.max(left, Math.min(width, visual ? visual.offsetLeft + visual.width : width));
  const bottom = Math.max(top, Math.min(height, visual ? visual.offsetTop + visual.height : height));
  return { left, top, right: width - right, bottom: height - bottom, width: right - left, height: bottom - top };
}
