import type { AiPlanStep, BuildingDefinition, BuildingTypeId, UnitDefinition, UnitTypeId } from "./types";

export const unitDefs: Record<UnitTypeId, UnitDefinition> = {
  worker: {
    id: "worker",
    name: "Рабочий",
    maxHp: 60,
    buildTime: 6,
    moveSpeed: 6,
    cost: { spice: 50 },
    harvestRate: 18,
    carryCapacity: 60,
    visionRange: 18,
    attack: { damage: 4, cooldown: 1.2, range: 4 },
  },
  infantry: {
    id: "infantry",
    name: "Легкая пехота",
    maxHp: 85,
    buildTime: 8,
    moveSpeed: 6.5,
    cost: { spice: 90 },
    visionRange: 24,
    attack: { damage: 14, cooldown: 0.95, range: 8.5 },
  },
};

export const buildingDefs: Record<BuildingTypeId, BuildingDefinition> = {
  hq: {
    id: "hq",
    name: "Штаб",
    maxHp: 900,
    size: 12,
    produces: ["worker"],
    queueLimit: 4,
    cost: { spice: 0 },
    isRefinery: true,
    visionRange: 30,
  },
  barracks: {
    id: "barracks",
    name: "Казармы",
    maxHp: 650,
    size: 10,
    produces: ["infantry"],
    queueLimit: 4,
    cost: { spice: 120 },
    visionRange: 22,
  },
  refinery: {
    id: "refinery",
    name: "Переработка",
    maxHp: 700,
    size: 10,
    produces: [],
    queueLimit: 0,
    cost: { spice: 200 },
    isRefinery: true,
    visionRange: 20,
  },
};

export const aiBuildPlan: AiPlanStep[] = [
  { kind: "ensureWorkers", count: 4 },
  { kind: "trainUnits", unitTypeId: "infantry", count: 3 },
  {
    kind: "buildStructure",
    typeId: "refinery",
    offset: { x: 16, z: 6 },
    requireSpice: 160,
  },
  { kind: "ensureWorkers", count: 6 },
  {
    kind: "buildStructure",
    typeId: "barracks",
    offset: { x: 12, z: 10 },
    requireSpice: 140,
  },
  { kind: "setRally", offset: { x: 6, z: 10 } },
  { kind: "trainUnits", unitTypeId: "infantry", count: 5 },
  { kind: "loopProduction", unitTypeId: "infantry", minQueue: 2 },
];
