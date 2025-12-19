import type { MapDefinition, StartLocation } from "./types";

export function findStartLocation(map: MapDefinition, id: string): StartLocation | null {
  return map.startLocations.find((loc) => loc.id === id) ?? null;
}
