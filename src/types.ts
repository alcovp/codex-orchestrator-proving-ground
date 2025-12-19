export type MapDefinition = {
  id: string;
  name: string;
  description: string;
  size: { width: number; height: number };
  tileSize: number;
  startLocations: StartLocation[];
  resources: ResourceSpot[];
};

export type WorldSettings = {
  camera: {
    minDistance: number;
    maxDistance: number;
    defaultDistance: number;
    tiltDeg: number;
    panSpeed: number;
    edgeThreshold: number;
    boundsPadding: number;
    panSmoothing: number;
    zoomSmoothing: number;
  };
  terrain: {
    baseColor: string;
    accentColor: string;
    gridOpacity: number;
  };
};

export type GamePhase = "menu" | "playing";

export type GameSession = {
  map: MapDefinition;
  startedAt: number;
};

export type StartLocation = {
  id: string;
  label: string;
  position: { x: number; z: number };
  facingDeg?: number;
};

export type ResourceSpot = {
  id: string;
  position: { x: number; z: number };
  radius: number;
  richness: number;
};

export type FactionId = "player" | "ai";

export type UnitTypeId = "worker" | "infantry";
export type BuildingTypeId = "hq" | "barracks" | "refinery";

export type UnitDefinition = {
  id: UnitTypeId;
  name: string;
  maxHp: number;
  buildTime: number;
  moveSpeed: number;
};

export type BuildingDefinition = {
  id: BuildingTypeId;
  name: string;
  maxHp: number;
  size: number;
  produces: UnitTypeId[];
  queueLimit: number;
};

export type ProductionQueueItem = {
  id: string;
  unitTypeId: UnitTypeId;
  startedAt: number;
  readyAt: number;
};

export type UnitState = {
  id: string;
  typeId: UnitTypeId;
  owner: FactionId;
  position: { x: number; z: number };
  facingDeg: number;
  hp: number;
};

export type BuildingState = {
  id: string;
  typeId: BuildingTypeId;
  owner: FactionId;
  position: { x: number; z: number };
  facingDeg: number;
  hp: number;
  queue: ProductionQueueItem[];
  rallyOffset: { x: number; z: number };
};

export type PlayerState = {
  id: FactionId;
  spice: number;
  power: number;
};

export type Selection =
  | { kind: "unit"; id: string }
  | { kind: "building"; id: string };

export type GameWorld = {
  map: MapDefinition;
  units: UnitState[];
  buildings: BuildingState[];
  players: Record<FactionId, PlayerState>;
  defs: {
    units: Record<UnitTypeId, UnitDefinition>;
    buildings: Record<BuildingTypeId, BuildingDefinition>;
  };
  lastTick: number;
};
