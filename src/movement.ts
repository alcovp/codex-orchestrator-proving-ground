import type { UnitState } from "./types";

export function distanceSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function moveUnitTowards(
  unit: UnitState,
  target: { x: number; z: number },
  speed: number,
  deltaSeconds: number,
): number {
  const dx = target.x - unit.position.x;
  const dz = target.z - unit.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-3) {
    return 0;
  }
  const step = speed * deltaSeconds;
  const t = step >= dist ? 1 : step / dist;
  unit.position.x += dx * t;
  unit.position.z += dz * t;
  unit.facingDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
  return dist - step;
}
