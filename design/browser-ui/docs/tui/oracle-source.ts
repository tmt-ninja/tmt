// The extracted Ops oracle. Vite builds replace this module through oracle-module.mjs; Node runs it.
import { extract } from './generate.mjs';

export default extract();
