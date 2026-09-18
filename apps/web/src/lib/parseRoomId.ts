export type ParsedRoomId = {
  id: string;
  buildingId: string;
  floor: number;
  room: string;
};

const PREFIXES: Array<[string, string]> = [
  ["BTB", "BTB"],
  ["TH", "TH"],
  ["EB", "E"],
  ["HN", "N"],
  ["HW", "W"],
  ["HE", "E"],
  ["N", "N"],
  ["E", "E"],
  ["W", "W"],
  ["C", "N"],
];

export function parseRoomId(raw: string): ParsedRoomId {
  const id = raw.trim().toUpperCase();
  const prefix = PREFIXES.find(([token]) => id.startsWith(token));
  if (!prefix) {
    throw new Error(`Unknown building prefix: ${raw}`);
  }
  const [token, buildingId] = prefix;
  const rest = id.slice(token.length);
  const match = rest.match(/^(\d+)([A-Z]?)$/);
  if (!match) {
    throw new Error(`Invalid room number: ${raw}`);
  }
  const digits = match[1];
  const letter = match[2] ?? "";

  if (token === "C" || token === "EB") {
    return { id, buildingId, floor: 0, room: digits + letter };
  }

  let floor: number;
  let room: string;
  if (digits.length >= 4) {
    floor = Number.parseInt(digits.slice(0, 2), 10);
    room = digits.slice(2) + letter;
  } else if (digits.length === 3) {
    floor = Number.parseInt(digits.slice(0, 1), 10);
    room = digits.slice(1) + letter;
  } else {
    floor = 1;
    room = digits + letter;
  }

  return { id, buildingId, floor, room };
}

export function canonicalRoomId(parsed: ParsedRoomId): string {
  if (!parsed.floor) return parsed.id.replace(/[\s-]/g, "");
  return `${parsed.buildingId}${parsed.floor}${parsed.room}`;
}
