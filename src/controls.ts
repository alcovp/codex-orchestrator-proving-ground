import type { Point } from "./types";

const directionsByKey: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

export function attachKeyboardControls(
  onDirection: (direction: Point) => void,
): () => void {
  const handler = (event: KeyboardEvent): void => {
    const requested = directionsByKey[event.key];
    if (requested) {
      event.preventDefault();
      onDirection(requested);
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
