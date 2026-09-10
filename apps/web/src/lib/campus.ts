import campusData from "../data/campus.json";
import roomsData from "../data/rooms.json";

export type Vec3 = [number, number, number];

export type ScanAsset = {
  url: string;
  position: number[];
  rotationY: number;
  scale: number;
};

export type Building = {
  id: string;
  name: string;
  floorCount: number;
  floorHeight: number;
  color: string;
  footprint: number[][];
  center: number[];
  floors: Array<{ level: number; scan?: ScanAsset }>;
};

export type Room = {
  id: string;
  buildingId: string;
  floor: number;
  label: string;
  doorPosition: number[];
};

export type FloorView =
  | { kind: "scan"; building: Building; level: number; scan: ScanAsset }
  | { kind: "plan"; building: Building; level: number };

const campus = campusData as {
  campusGltf: string;
  buildings: Building[];
};

const rooms = roomsData as { rooms: Room[] };

export function getCampusGltf(): string {
  return campus.campusGltf;
}

export function listBuildings(): Building[] {
  return campus.buildings;
}

export function getBuilding(id: string): Building | undefined {
  return campus.buildings.find((building) => building.id === id);
}

export function listRooms(): Room[] {
  return rooms.rooms;
}

export function findRoom(id: string): Room | undefined {
  const wanted = id.trim().toUpperCase();
  return rooms.rooms.find((room) => room.id.toUpperCase() === wanted);
}

export function roomsOnFloor(buildingId: string, level: number): Room[] {
  return rooms.rooms.filter((room) => room.buildingId === buildingId && room.floor === level);
}

export function getFloorView(buildingId: string, level: number): FloorView {
  const building = getBuilding(buildingId);
  if (!building) {
    throw new Error(`Unknown building: ${buildingId}`);
  }
  const scanned = building.floors.find((floor) => floor.level === level && floor.scan);
  if (scanned?.scan) {
    return { kind: "scan", building, level, scan: scanned.scan };
  }
  return { kind: "plan", building, level };
}
