declare module "pannellum";

interface PannellumViewer {
  destroy(): void;
  resize(): void;
  getHfov(): number;
  setHfov(hfov: number, animated: boolean): PannellumViewer;
  setHfovBounds(bounds: [number, number]): PannellumViewer;
  on(event: "load" | "error", listener: (message?: string) => void): PannellumViewer;
}

interface Window {
  pannellum?: {
    viewer(container: HTMLElement, config: Record<string, unknown>): PannellumViewer;
  };
}
