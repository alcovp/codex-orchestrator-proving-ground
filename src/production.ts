import { buildingDefs, unitDefs } from "./defs";
import { spawnWorldUnit } from "./spawn";
import type {
  BuildingState,
  GameWorld,
  ProductionQueueItem,
  UnitTypeId,
} from "./types";
import { nextQueueId } from "./spawn";

export function queueProduction(
  world: GameWorld,
  now: number,
  building: BuildingState,
  unitTypeId: UnitTypeId,
  options?: { silent?: boolean },
): ProductionQueueItem | null {
  const def = buildingDefs[building.typeId];
  if (!def.produces.includes(unitTypeId)) {
    return null;
  }
  if (building.queue.length >= def.queueLimit) {
    return null;
  }
  const player = world.players[building.owner];
  const unitDef = unitDefs[unitTypeId];
  if (player.spice < unitDef.cost.spice) {
    if (!options?.silent && building.owner === "player") {
      world.statusMessage = `Недостаточно спайса: нужно ${unitDef.cost.spice}`;
    }
    return null;
  }
  player.spice -= unitDef.cost.spice;
  const item: ProductionQueueItem = {
    id: nextQueueId(),
    unitTypeId,
    startedAt: now,
    readyAt: now + unitDef.buildTime * 1000,
  };
  building.queue.push(item);
  if (!options?.silent && building.owner === "player") {
    world.statusMessage = `${unitDef.name}: заказ принят (${Math.floor(player.spice)} спайса осталось)`;
  }
  return item;
}

export function spawnFromQueue(
  world: GameWorld,
  building: BuildingState,
  queueItem: ProductionQueueItem,
): void {
  const def = buildingDefs[building.typeId];
  const facingRad = (building.facingDeg * Math.PI) / 180;
  const offsetX = Math.sin(facingRad) * def.size * 0.6 + building.rallyOffset.x;
  const offsetZ = Math.cos(facingRad) * def.size * 0.6 + building.rallyOffset.z;
  const position = {
    x: building.position.x + offsetX,
    z: building.position.z + offsetZ,
  };
  spawnWorldUnit(world, building.owner, queueItem.unitTypeId, position, building.facingDeg, world.lastTick);
  if (building.owner === "player") {
    const unitDef = world.defs.units[queueItem.unitTypeId];
    world.statusMessage = `${unitDef.name} готов к выходу`;
  }
}
