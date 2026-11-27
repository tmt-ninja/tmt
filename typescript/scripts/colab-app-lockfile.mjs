import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const PNPM_LOCKFILE = 'typescript/pnpm-lock.yaml';
const COLAB_APP = '../extensions/tmt-colab/typescript/app';
const INSTALL_EDGES = ['dependencies', 'devDependencies', 'optionalDependencies'];
const PACKAGE_NAME = /^(?:@[\w.-]+\/)?[\w.-]+$/;
const PACKAGE_ID = /^(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+[\w.+-]*(?:\(|$)/;

// The selector runs before the workspace install. Psych is part of the runner's
// Ruby standard library. Read its syntax tree without evaluating YAML objects
// or coercing scalar types. Preserve plain vs quoted scalars in the comparison.
const PARSE_LOCKFILES = `
def read_node(node)
  raise 'unsupported YAML' if (node.respond_to?(:anchor) && node.anchor) ||
    (node.respond_to?(:tag) && node.tag)
  case node
  when Psych::Nodes::Mapping
    node.children.each_slice(2).each_with_object({}) do |(key, value), result|
      name, plain = read_node(key)
      if !name.is_a?(String) || name == '<<' || result.key?(name) ||
          (plain && name.match?(/\\A(?:true|false|null|~|[+-]?\\d[\\d_.+-]*)\\z/i))
        raise 'unsupported or duplicate key'
      end
      result[name] = read_node(value)
    end
  when Psych::Nodes::Scalar
    [node.value, node.plain]
  when Psych::Nodes::Sequence
    node.children.map { |child| read_node(child) }
  else
    raise 'unsupported YAML node'
  end
end
locks = JSON.parse(STDIN.read).map do |text|
  stream = Psych.parse_stream(text)
  raise 'expected one YAML document' unless stream.children.length == 1
  document = stream.children.fetch(0)
  raise 'unsupported YAML document directives' unless document.version.empty? && document.tag_directives.empty?
  read_node(document.children.fetch(0))
end
puts JSON.generate(locks)
`;

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a lockfile mapping.');
  }
  return value;
}

function entry(table, key) {
  if (!Object.hasOwn(table, key)) throw new Error('Unresolved lockfile reference.');
  return record(table[key]);
}

function dependencyEdges(node) {
  return INSTALL_EDGES.flatMap((group) =>
    Object.hasOwn(node, group) ? Object.entries(record(node[group])) : []
  );
}

function scalar(value) {
  if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'boolean') {
    throw new Error('Expected a lockfile scalar.');
  }
  return value[0];
}

function appClosure(lock) {
  const { importers, packages, snapshots, ...global } = record(lock);
  if (scalar(global.lockfileVersion) !== '9.0') throw new Error('Unsupported lockfile version.');
  const imports = record(importers);
  const metadata = record(packages);
  const resolved = record(snapshots);
  const closure = { global, importers: new Map(), packages: new Map(), snapshots: new Map() };

  function visitPeer(binding) {
    if (Object.hasOwn(resolved, binding)) {
      visitSnapshot(binding);
      return;
    }
    // pnpm also emits a base peer ID inside a nested context without a
    // separate base snapshot. Keep every possible resolved variant in that case.
    const variants = Object.keys(resolved).filter((key) => key.startsWith(`${binding}(`));
    if (variants.length === 0) throw new Error('Unresolved peer binding.');
    for (const variant of variants) visitSnapshot(variant);
  }

  function visitSnapshot(key) {
    if (closure.snapshots.has(key)) return;
    if (!PACKAGE_ID.test(key)) throw new Error('Unsupported package identifier.');
    const node = entry(resolved, key);
    closure.snapshots.set(key, node);
    const base = key.split('(', 1)[0];
    closure.packages.set(base, entry(metadata, base));
    for (const [name, version] of dependencyEdges(node)) visitDependency(name, scalar(version));

    // pnpm can encode transitive peer bindings in snapshot IDs without listing
    // them as dependency edges of that snapshot. Retain those exact variants too.
    const opens = [];
    for (let index = base.length; index < key.length; index += 1) {
      if (key[index] === '(') opens.push(index);
      if (key[index] !== ')') continue;
      const open = opens.pop();
      if (open === undefined) throw new Error('Invalid peer binding.');
      const binding = key.slice(open + 1, index);
      if (!/^patch_hash=[a-f\d]+$/.test(binding)) visitPeer(binding);
    }
    if (opens.length !== 0) throw new Error('Invalid peer binding.');
  }

  function visitDependency(name, version, importer) {
    if (!PACKAGE_NAME.test(name) || typeof version !== 'string') {
      throw new Error('Invalid lockfile dependency.');
    }
    if (importer && /^link:\.{1,2}\//.test(version)) {
      visitImporter(posix.join(importer, version.slice('link:'.length)));
      return;
    }
    // An npm alias stores its resolved name in the reference.
    visitSnapshot(PACKAGE_ID.test(version) ? version : `${name}@${version}`);
  }

  function visitImporter(name) {
    if (closure.importers.has(name)) return;
    const node = entry(imports, name);
    closure.importers.set(name, node);
    for (const [dep, ref] of dependencyEdges(node)) {
      visitDependency(dep, scalar(record(ref).version), name);
    }
  }

  visitImporter(COLAB_APP);
  return closure;
}

/** A skip requires positive evidence that all supplied lockfiles resolve the same app closure. */
export function colabAppLockfilesDiffer(...texts) {
  try {
    if (texts.length < 2 || texts.some((text) => !text || text.length > 2 * 1024 * 1024)) {
      return true;
    }
    const parsed = spawnSync('ruby', ['-rpsych', '-rjson', '-e', PARSE_LOCKFILES], {
      input: JSON.stringify(texts),
      encoding: 'utf8',
      timeout: 5_000,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
    });
    if (parsed.status !== 0 || parsed.error || parsed.stderr) return true;
    const closures = JSON.parse(parsed.stdout).map(appClosure);
    return closures.slice(1).some((current) => !isDeepStrictEqual(closures[0], current));
  } catch {
    return true;
  }
}
