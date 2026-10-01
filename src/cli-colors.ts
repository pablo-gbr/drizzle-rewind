type ColorName = "red" | "green" | "yellow" | "cyan" | "gray" | "bold";

const codes: Record<ColorName, [number, number]> = {
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  gray: [90, 39],
  bold: [1, 22],
};

function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";
}

export function color(name: ColorName, value: string): string {
  if (!useColor()) return value;
  const [open, close] = codes[name];
  return `\u001b[${open}m${value}\u001b[${close}m`;
}
