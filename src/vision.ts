import type { GameWorld, MapDefinition, VisionState } from "./types";
import { buildingDefs } from "./defs";
import { unitDefs } from "./defs";

export function createVision(map: MapDefinition): VisionState {
  const cellSize = Math.max(2, Math.round(map.tileSize / 2));
  const width = Math.max(8, Math.ceil(map.size.width / cellSize));
  const height = Math.max(8, Math.ceil(map.size.height / cellSize));
  const size = width * height;
  return {
    width,
    height,
    cellSize,
    visible: new Uint8Array(size),
    explored: new Uint8Array(size),
  };
}

export function revealVision(
  vision: VisionState,
  map: MapDefinition,
  position: { x: number; z: number },
  radius: number,
): void {
  const mapHalfWidth = map.size.width / 2;
  const mapHalfHeight = map.size.height / 2;
  const radiusSq = radius * radius;
  const minX = Math.max(
    0,
    Math.floor((position.x - radius + mapHalfWidth) / vision.cellSize),
  );
  const maxX = Math.min(
    vision.width - 1,
    Math.floor((position.x + radius + mapHalfWidth) / vision.cellSize),
  );
  const minZ = Math.max(
    0,
    Math.floor((position.z - radius + mapHalfHeight) / vision.cellSize),
  );
  const maxZ = Math.min(
    vision.height - 1,
    Math.floor((position.z + radius + mapHalfHeight) / vision.cellSize),
  );

  for (let gz = minZ; gz <= maxZ; gz += 1) {
    const cellCenterZ = gz * vision.cellSize - mapHalfHeight + vision.cellSize * 0.5;
    const dz = cellCenterZ - position.z;
    for (let gx = minX; gx <= maxX; gx += 1) {
      const cellCenterX = gx * vision.cellSize - mapHalfWidth + vision.cellSize * 0.5;
      const dx = cellCenterX - position.x;
      if (dx * dx + dz * dz <= radiusSq) {
        const idx = gz * vision.width + gx;
        vision.visible[idx] = 1;
        vision.explored[idx] = 1;
      }
    }
  }
}

export function recomputeVision(world: GameWorld): void {
  (["player", "ai"] as const).forEach((id) => world.vision[id].visible.fill(0));
  world.units.forEach((unit) => {
    const def = unitDefs[unit.typeId];
    revealVision(world.vision[unit.owner], world.map, unit.position, def.visionRange);
  });
  world.buildings.forEach((building) => {
    const def = buildingDefs[building.typeId];
    revealVision(
      world.vision[building.owner],
      world.map,
      building.position,
      def.visionRange,
    );
  });
}
