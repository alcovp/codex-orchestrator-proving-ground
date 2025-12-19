import { buildingDefs, unitDefs } from "./defs";
import { distanceSq, moveUnitTowards } from "./movement";
import { ensureBehavior } from "./behavior";
import type {
  AttackState,
  BuildingState,
  FactionId,
  GameWorld,
  UnitState,
} from "./types";

function ensureAttackState(unit: UnitState, attackDef: NonNullable<(typeof unitDefs)[UnitState["typeId"]]["attack"]>): AttackState | undefined {
  if (!attackDef) {
    return undefined;
  }
  if (!unit.attack) {
    unit.attack = { targetId: null, targetKind: null, cooldown: 0 };
  }
  return unit.attack;
}

function resolveAttackTarget(
  world: GameWorld,
  state: AttackState | undefined,
): { target: UnitState | BuildingState; kind: "unit" | "building" } | null {
  if (!state || !state.targetId || !state.targetKind) {
    return null;
  }
  if (state.targetKind === "unit") {
    const unit = world.units.find((u) => u.id === state.targetId && u.hp > 0);
    if (unit) {
      return { target: unit, kind: "unit" };
    }
  } else {
    const building = world.buildings.find((b) => b.id === state.targetId && b.hp > 0);
    if (building) {
      return { target: building, kind: "building" };
    }
  }
  state.targetId = null;
  state.targetKind = null;
  return null;
}

function findNearestEnemyTarget(
  world: GameWorld,
  owner: FactionId,
  position: { x: number; z: number },
  maxRange: number,
): { target: UnitState | BuildingState; kind: "unit" | "building"; distSq: number } | null {
  const maxRangeSq = maxRange * maxRange;
  let best: { target: UnitState | BuildingState; kind: "unit" | "building"; distSq: number } | null = null;
  world.units.forEach((unit) => {
    if (unit.owner === owner || unit.hp <= 0) {
      return;
    }
    const d = distanceSq(position, unit.position);
    if (d <= maxRangeSq && (!best || d < best.distSq)) {
      best = { target: unit, kind: "unit", distSq: d };
    }
  });
  world.buildings.forEach((building) => {
    if (building.owner === owner || building.hp <= 0) {
      return;
    }
    const d = distanceSq(position, building.position);
    if (d <= maxRangeSq && (!best || d < best.distSq)) {
      best = { target: building, kind: "building", distSq: d };
    }
  });
  return best;
}

export function applyDamage(
  world: GameWorld,
  target: UnitState | BuildingState,
  amount: number,
  sourceOwner: FactionId,
): void {
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp > 0) {
    return;
  }
  if ("queue" in target) {
    const def = buildingDefs[target.typeId];
    if (target.owner === "player") {
      world.statusMessage = `${def.name} уничтожено.`;
    } else if (sourceOwner === "player") {
      world.statusMessage = `${def.name} противника уничтожено.`;
    }
  }
}

export function updateCombatUnit(
  world: GameWorld,
  unit: UnitState,
  deltaSeconds: number,
  now: number,
): void {
  const def = unitDefs[unit.typeId];
  const attackDef = def.attack;
  if (!attackDef) {
    return;
  }
  const behavior = ensureBehavior(unit, now);
  const attackState = ensureAttackState(unit, attackDef);
  if (!attackState) {
    return;
  }

  attackState.cooldown = Math.max(0, attackState.cooldown - deltaSeconds);
  const desiredRange = attackDef.range;
  const aggroRange = desiredRange + 5;

  let targetInfo = resolveAttackTarget(world, attackState);
  if (targetInfo && targetInfo.target.owner === unit.owner) {
    attackState.targetId = null;
    attackState.targetKind = null;
    targetInfo = null;
  }

  if (behavior.order.kind === "attackTarget" && !targetInfo) {
    attackState.targetId = behavior.order.targetId;
    attackState.targetKind = behavior.order.targetKind;
    targetInfo = resolveAttackTarget(world, attackState);
  }

  if (!targetInfo) {
    const enemy = findNearestEnemyTarget(world, unit.owner, unit.position, aggroRange);
    if (enemy) {
      attackState.targetId = enemy.target.id;
      attackState.targetKind = enemy.kind;
      targetInfo = enemy;
    }
  }

  if (targetInfo) {
    const targetPos = targetInfo.target.position;
    const distSqToTarget = distanceSq(unit.position, targetPos);
    const desiredRangeSq = desiredRange * desiredRange;
    if (distSqToTarget > desiredRangeSq * 0.85) {
      moveUnitTowards(unit, targetPos, def.moveSpeed, deltaSeconds);
    } else if (attackState.cooldown <= 0) {
      applyDamage(world, targetInfo.target, attackDef.damage, unit.owner);
      attackState.cooldown = attackDef.cooldown;
      behavior.lastAttackAt = now;
    }
    return;
  }

  if (behavior.order.kind === "attackMove" || behavior.order.kind === "move") {
    const dest = behavior.order.target;
    const remaining = moveUnitTowards(unit, dest, def.moveSpeed, deltaSeconds);
    if (remaining <= 0.5) {
      behavior.order = { kind: "idle" };
    }
  }
}
