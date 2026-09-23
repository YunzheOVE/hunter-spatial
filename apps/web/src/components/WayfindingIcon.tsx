import type { ReactNode } from "react";

export type WayfindingIconName =
  | "walk"
  | "forward"
  | "stairs"
  | "elevator"
  | "bridge"
  | "escalator"
  | "connector"
  | "destination";

export function WayfindingIcon({ name, size = 20, className }: {
  name: WayfindingIconName;
  size?: number;
  className?: string;
}) {
  let symbol: ReactNode;

  switch (name) {
    case "walk":
      symbol = <><circle cx="13" cy="3.5" r="1.5" /><path d="m7 21 3-4 2-4m5 8-2-5-3-2-2-4m-3 1 3-4 4 2 2 3" /></>;
      break;
    case "forward":
      symbol = <><path d="M4 12h16m-7-7 7 7-7 7" /></>;
      break;
    case "stairs":
      symbol = <><path d="M3 21h5v-5h5v-5h5V6h3" /><path d="M3 16h3m5-5h2m5-5h3" /></>;
      break;
    case "elevator":
      symbol = <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M12 8v14M8 5l-2 2m2-2 2 2m6 0 2-2m-2 2-2-2" /></>;
      break;
    case "bridge":
      symbol = <><path d="M2 19h20M4 19V8m16 11V8M4 10c4 0 4-5 8-5s4 5 8 5M4 13h16" /><path d="M8 13v6m8-6v6" /></>;
      break;
    case "escalator":
      symbol = <><path d="M3 19h4L17 5h4M3 15h3l10-10h5M4 19v2m16-16V3" /></>;
      break;
    case "connector":
      symbol = <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 6h5a4 4 0 0 1 4 4v4a4 4 0 0 0 3 4" /></>;
      break;
    case "destination":
      symbol = <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>;
      break;
  }

  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {symbol}
    </svg>
  );
}
