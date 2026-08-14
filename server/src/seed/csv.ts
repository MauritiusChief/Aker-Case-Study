import { parse } from "csv-parse/sync";

export function parseCsv(text: string): string[][] {
  return parse(text, { bom: true }) as string[][];
}
