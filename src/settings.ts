import type { MapDefinition, WorldSettings } from "./types";

export const maps: MapDefinition[] = [
  {
    id: "arrakis-dustbowl",
    name: "Пустынное плато",
    description: "Песчаная карта-заглушка для одиночной стычки.",
    size: { width: 120, height: 120 },
    tileSize: 6,
    startLocations: [
      { id: "player", label: "Игрок", position: { x: -36, z: -32 }, facingDeg: 45 },
      { id: "ai", label: "ИИ", position: { x: 36, z: 32 }, facingDeg: 225 },
    ],
    resources: [
      { id: "spice-north", position: { x: -10, z: -38 }, radius: 6.5, richness: 1.2 },
      { id: "spice-center", position: { x: 4, z: 6 }, radius: 8.5, richness: 1.6 },
      { id: "spice-south", position: { x: 22, z: 34 }, radius: 7, richness: 1.1 },
    ],
  },
];

export const worldSettings: WorldSettings = {
  camera: {
    minDistance: 14,
    maxDistance: 90,
    defaultDistance: 38,
    tiltDeg: 58,
    panSpeed: 32,
    edgeThreshold: 26,
    boundsPadding: 6,
    panSmoothing: 9,
    zoomSmoothing: 8,
  },
  terrain: {
    baseColor: "#caa46a",
    accentColor: "#5d4a2f",
    gridOpacity: 0.35,
  },
};
