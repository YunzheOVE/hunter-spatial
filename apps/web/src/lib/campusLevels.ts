export const CAMPUS_TOP_FLOORS = {
  N: 16,
  E: 18,
  W: 18,
  TH: 7,
  BTB: 6,
} as const;

export const STOREY_HEIGHT = 3.5;

export type CampusBuildingId = keyof typeof CAMPUS_TOP_FLOORS;

const CAMPUS_BUILDINGS = Object.keys(CAMPUS_TOP_FLOORS) as CampusBuildingId[];
const CAMPUS_LEVELS = [
  0,
  ...Array.from({ length: Math.max(...Object.values(CAMPUS_TOP_FLOORS)) }, (_, index) => index + 1),
];

function hasCampusLevel(building: CampusBuildingId, level: number): boolean {
  return level === 0
    ? building === "N" || building === "TH" || building === "BTB"
    : level >= 1 && level <= CAMPUS_TOP_FLOORS[building];
}

export function campusBuildingsAtLevel(
  building: CampusBuildingId | null,
  level: number,
): readonly CampusBuildingId[] {
  return (building ? [building] : CAMPUS_BUILDINGS).filter((id) => hasCampusLevel(id, level));
}

export function campusLevelsForSelection(building: CampusBuildingId | null): readonly number[] {
  return building ? CAMPUS_LEVELS.filter((level) => hasCampusLevel(building, level)) : CAMPUS_LEVELS;
}

export function campusPodiumLevels(
  building: CampusBuildingId | null,
  level: number,
): ReadonlyArray<readonly [CampusBuildingId, number]> {
  const buildings = building ? [building] : CAMPUS_BUILDINGS;
  return buildings
    .map((id) => [id, Math.min(level - 1, CAMPUS_TOP_FLOORS[id])] as const)
    .filter(([, topLevel]) => topLevel >= 1);
}

export function closestCampusLevel(building: CampusBuildingId, level: number): number {
  const firstLevel = building === "N" || building === "TH" || building === "BTB" ? 0 : 1;
  return Math.min(Math.max(level, firstLevel), CAMPUS_TOP_FLOORS[building]);
}
