import ts from 'typescript';

const edges = new Map<string, { text: string; values: readonly string[] }>();

// Test-only literal module edge extraction; shared by product and tooling guards.
// The file name selects the syntax (TS, TSX or JS), so JSX cannot hide a later edge.
export function imports(file: string, text: string): string[] {
  const cached = edges.get(file);
  if (cached?.text === text) return [...cached.values];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const values: string[] = [];
  const collect = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      values.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      values.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      values.push(node.argument.literal.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      values.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  // Retain literal edges, not ASTs. Fixture text changes invalidate the entry,
  // and callers receive their own array (some sort it for comparison).
  edges.set(file, { text, values: [...values] });
  return values;
}
