type Tokens = typeof import('../../../tokens/tokens.json');

export declare const root: URL;
export declare const sources: string[];
export declare const scenes: string[];
export interface ExtractedFrame {
  state: string;
  look: string;
  width: number;
  height: number;
  lines: number[];
  styles: number[];
}
export interface ExtractedOracle {
  sources: string[];
  ansiRgb: string[];
  roles: Tokens['color'];
  marks: Tokens['mark'];
  defaults: Record<'light' | 'dark', { fg: string; bg: string }>;
  styles: Record<string, string>;
  lineDictionary: string[];
  styleDictionary: string[];
  frames: ExtractedFrame[];
}
export interface SourceOracle {
  frames: {
    state: string;
    look: string;
    width: number;
    height: number;
    lines: number[];
    styles: number[];
  }[];
  line_dictionary: string[];
  style_row_dictionary: string[];
  styles: Record<string, string>;
}
export declare function extract(oracle?: SourceOracle): ExtractedOracle;
