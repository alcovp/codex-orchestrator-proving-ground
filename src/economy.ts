import type { BuildingState, FactionId, GameWorld, ResourceNodeState, UnitState } from "./types";
import { buildingDefs } from "./defs";
import { moveUnitTowards } from "./movement";

function findNearestResourceNode(world: GameWorld, position: { x: number; z: number }): ResourceNodeState | null {
  let best: ResourceNodeState | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  world.resourceNodes.forEach((node) => {
    if (node.amount <= 0) {
      return;
    }
    const dx = node.position.x - position.x;
    const dz = node.position.z - position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDist) {
      bestDist = distSq;
      best = node;
    }
  });
  return best;
}

function findDropoffBuilding(world: GameWorld, owner: FactionId, position: { x: number; z: number }): BuildingState | null {
  const candidates = world.buildings.filter(
    (b) => b.owner === owner && buildingDefs[b.typeId].isRefinery,
  );
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => {
    const da =
      (a.position.x - position.x) * (a.position.x - position.x) +
      (a.position.z - position.z) * (a.position.z - position.z);
    const db =
      (b.position.x - position.x) * (b.position.x - position.x) +
      (b.position.z - position.z) * (b.position.z - position.z);
    return da - db;
  });
  return candidates[0] ?? null;
}

export function resetWorkerHarvest(worker: UnitState): void {
  if (!worker.harvest) {
    return;
  }
  worker.harvest = { mode: "idle", nodeId: null, dropoffId: null, carried: 0, progress: 0 };
}

export function updateWorker(world: GameWorld, worker: UnitState, deltaSeconds: number): void {
  if (worker.typeId !== "worker") {
    return;
  }
  const def = world.defs.units.worker;
  const carryCapacity = def.carryCapacity ?? 60;
  const harvestRate = def.harvestRate ?? 12;
  const task =
    worker.harvest ??
    { mode: "idle", nodeId: null, dropoffId: null, carried: 0, progress: 0 };
  worker.harvest = task;

  const targetNode =
    task.nodeId !== null
      ? world.resourceNodes.find((n) => n.id === task.nodeId && n.amount > 0)
      : null;

  if ((!targetNode || targetNode.amount <= 0) && task.mode !== "idle") {
    task.mode = "idle";
    task.nodeId = null;
  }

  if (task.mode === "idle") {
    const node = findNearestResourceNode(world, worker.position);
    if (node) {
      task.nodeId = node.id;
      task.mode = "toResource";
      task.dropoffId = findDropoffBuilding(world, worker.owner, worker.position)?.id ?? null;
    } else {
      return;
    }
  }

  const node =
    task.nodeId !== null
      ? world.resourceNodes.find((n) => n.id === task.nodeId)
      : null;
  const dropoff =
    task.dropoffId !== null
      ? world.buildings.find((b) => b.id === task.dropoffId)
      : findDropoffBuilding(world, worker.owner, worker.position);

  switch (task.mode) {
    case "toResource": {
      if (!node) {
        task.mode = "idle";
        break;
      }
      const remaining = moveUnitTowards(worker, node.position, def.moveSpeed, deltaSeconds);
      const arriveDistance = node.radius + 0.6;
      if (remaining <= arriveDistance) {
        task.mode = "gathering";
        task.progress = 0;
      }
      break;
    }
    case "gathering": {
      if (!node || node.amount <= 0) {
        task.mode = "idle";
        task.nodeId = null;
        break;
      }
      const remainingCap = carryCapacity - task.carried;
      if (remainingCap <= 0) {
        task.mode = "toDropoff";
        break;
      }
      const amountBefore = node.amount;
      const harvested = Math.min(
        node.amount,
        remainingCap,
        harvestRate * deltaSeconds * node.richness,
      );
      task.carried += harvested;
      node.amount = Math.max(0, node.amount - harvested);
      task.progress = task.carried / carryCapacity;
      if (amountBefore > 0 && node.amount <= 0) {
        world.statusMessage = "Залежь спайса истощена.";
      }
      if (task.carried >= carryCapacity || node.amount <= 0) {
        task.mode = "toDropoff";
      }
      break;
    }
    case "toDropoff": {
      if (task.carried <= 0) {
        task.mode = "toResource";
        break;
      }
      const target = dropoff ?? findDropoffBuilding(world, worker.owner, worker.position);
      if (!target) {
        world.players[worker.owner].spice += task.carried;
        task.carried = 0;
        task.mode = "toResource";
        break;
      }
      task.dropoffId = target.id;
      const defTarget = world.defs.buildings[target.typeId];
      const remaining = moveUnitTowards(worker, target.position, def.moveSpeed, deltaSeconds);
      const arriveDistance = defTarget.size * 0.6;
      if (remaining <= arriveDistance) {
        world.players[worker.owner].spice += task.carried;
        if (worker.owner === "player") {
          world.statusMessage = `Доставлено ${Math.round(task.carried)} спайса`;
        }
        task.carried = 0;
        task.progress = 0;
        if (node && node.amount > 0) {
          task.mode = "toResource";
        } else {
          task.mode = "idle";
          task.nodeId = null;
        }
      }
      break;
    }
    default:
      break;
  }
}
