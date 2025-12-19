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
  amount?: number;
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
  cost: { spice: number; power?: number };
  harvestRate?: number;
  carryCapacity?: number;
  visionRange: number;
  attack?: AttackDefinition;
};

export type BuildingDefinition = {
  id: BuildingTypeId;
  name: string;
  maxHp: number;
  size: number;
  produces: UnitTypeId[];
  queueLimit: number;
  cost: { spice: number; power?: number };
  isRefinery?: boolean;
  visionRange: number;
};

export type ProductionQueueItem = {
  id: string;
  unitTypeId: UnitTypeId;
  startedAt: number;
  readyAt: number;
};

export type HarvestTaskState = {
  mode: "idle" | "toResource" | "gathering" | "toDropoff";
  nodeId: string | null;
  dropoffId: string | null;
  carried: number;
  progress: number;
};

export type UnitState = {
  id: string;
  typeId: UnitTypeId;
  owner: FactionId;
  position: { x: number; z: number };
  facingDeg: number;
  hp: number;
  harvest?: HarvestTaskState;
  attack?: AttackState;
  behavior?: UnitBehaviorState;
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

export type AttackDefinition = {
  damage: number;
  cooldown: number;
  range: number;
};

export type AttackState = {
  targetId: string | null;
  targetKind: "unit" | "building" | null;
  cooldown: number;
};

export type AiPlanStep =
  | { kind: "ensureWorkers"; count: number }
  | { kind: "trainUnits"; unitTypeId: UnitTypeId; count: number }
  | {
      kind: "buildStructure";
      typeId: BuildingTypeId;
      offset: { x: number; z: number };
      requireSpice?: number;
    }
  | { kind: "setRally"; offset: { x: number; z: number } }
  | { kind: "loopProduction"; unitTypeId: UnitTypeId; minQueue: number };

export type AiLoopProduction = {
  unitTypeId: UnitTypeId;
  minQueue: number;
};

export type UnitOrder =
  | { kind: "idle" }
  | { kind: "move"; target: { x: number; z: number } }
  | { kind: "attackMove"; target: { x: number; z: number } }
  | { kind: "attackTarget"; targetId: string; targetKind: "unit" | "building" };

export type UnitBehaviorState = {
  order: UnitOrder;
  lastAttackAt: number;
};

export type VisionState = {
  width: number;
  height: number;
  cellSize: number;
  visible: Uint8Array;
  explored: Uint8Array;
};

export type WorldOutcome = {
  winner: FactionId | "draw";
  message: string;
};

export type ResourceNodeState = {
  id: string;
  spotId: string;
  position: { x: number; z: number };
  radius: number;
  richness: number;
  amount: number;
  maxAmount: number;
};

export type Selection =
  | { kind: "unit"; id: string }
  | { kind: "building"; id: string };

export type AiState = {
  waveNumber: number;
  nextWaveAt: number;
  lastProductionCheck: number;
  desiredWorkers: number;
  rallyPoint: { x: number; z: number };
  attackTarget: { x: number; z: number };
  planStep: number;
  loopProduction: AiLoopProduction | null;
  nextScoutAt: number;
};

export type GameWorld = {
  map: MapDefinition;
  units: UnitState[];
  buildings: BuildingState[];
  resourceNodes: ResourceNodeState[];
  players: Record<FactionId, PlayerState>;
  defs: {
    units: Record<UnitTypeId, UnitDefinition>;
    buildings: Record<BuildingTypeId, BuildingDefinition>;
  };
  lastTick: number;
  statusMessage?: string;
  vision: Record<FactionId, VisionState>;
  outcome?: WorldOutcome | null;
  ai: AiState;
};
