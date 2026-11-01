import {
  validateComponent,
  validateSystem,
  type ComponentDoc,
  type DesignSystemConfig,
} from '../../../../../design/systems/compiler.mjs';
import { readBlock } from './design-system-pages.js';

export type DesignPageModel =
  | { kind: 'home'; config: DesignSystemConfig }
  | { kind: 'component'; doc: ComponentDoc & { notes?: string } }
  | { kind: 'page' };

/** Read the same validated author data that the compiler publishes; never execute it in the parent. */
export function designPageModel(source: string): DesignPageModel {
  const config = readBlock<DesignSystemConfig>(source, 'design-system');
  if (config) {
    validateSystem(config, 'Design home');
    return { kind: 'home', config };
  }
  const doc = readBlock<ComponentDoc & { notes?: string }>(source, 'component');
  if (doc) {
    validateComponent(doc, 'Design component');
    return { kind: 'component', doc };
  }
  return { kind: 'page' };
}

/** Template examples use the template prefix; each system owns the registered element names. */
export function designExample(markup: string, prefix: string): string {
  return markup.replaceAll('tmt-ui-', `${prefix}-`);
}
