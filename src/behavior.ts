import type { UnitBehaviorState, UnitOrder, UnitState } from "./types";

export function ensureBehavior(unit: UnitState, now: number): UnitBehaviorState {
  if (!unit.behavior) {
    unit.behavior = { order: { kind: "idle" }, lastAttackAt: now };
  }
  return unit.behavior;
}

export function setOrder(unit: UnitState, order: UnitOrder, now: number): UnitBehaviorState {
  const behavior = ensureBehavior(unit, now);
  behavior.order = order;
  return behavior;
}
