'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@babel/parser');

function invalid(code = 'RELEASE_MANIFEST_INVALID') {
  return Object.assign(new Error(code), { code });
}
function requireThat(condition) {
  if (!condition) throw invalid();
}
function checkSha(value) {
  requireThat(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value));
}
function checkRoot(dir) {
  requireThat(typeof dir === 'string' && path.isAbsolute(dir));
  requireThat(fs.lstatSync(dir).isDirectory() && !fs.lstatSync(dir).isSymbolicLink());
}
function checkedFile(dir, relative) {
  let current = dir;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    requireThat(!stat.isSymbolicLink() && (i === parts.length - 1 ? stat.isFile() : stat.isDirectory()));
  }
  return current;
}
function read(dir, relative) {
  const file = checkedFile(dir, relative);
  requireThat(fs.statSync(file).size <= 2 * 1024 * 1024);
  return fs.readFileSync(file, 'utf8');
}
function member(node, object, property) {
  return node?.type === 'MemberExpression' && !node.computed &&
    node.object.type === 'Identifier' && node.object.name === object &&
    node.property.type === 'Identifier' && node.property.name === property;
}
function frozen(node) {
  requireThat(node?.type === 'CallExpression' && member(node.callee, 'Object', 'freeze') && node.arguments.length === 1);
  return node.arguments[0];
}
function properties(node, names) {
  requireThat(node?.type === 'ObjectExpression' && node.properties.length === names.length);
  const result = Object.create(null);
  for (const prop of node.properties) {
    requireThat(prop.type === 'ObjectProperty' && !prop.computed && prop.key.type === 'Identifier');
    requireThat(names.includes(prop.key.name) && !Object.hasOwn(result, prop.key.name));
    result[prop.key.name] = prop.value;
  }
  return result;
}
// Parse only the repository's declarative migration format. Never load release code.
function schemaVersion(source) {
  const program = parse(source, { sourceType: 'script' }).program;
  requireThat(program.body.length === 2 && program.directives.every(d => d.value.value === 'use strict'));
  const [declaration, exported] = program.body;
  requireThat(declaration.type === 'VariableDeclaration' && declaration.kind === 'const' && declaration.declarations.length === 1);
  const binding = declaration.declarations[0];
  requireThat(binding.id.type === 'Identifier' && binding.id.name === 'MYSQL_MIGRATIONS');
  const array = frozen(binding.init);
  requireThat(array.type === 'ArrayExpression' && array.elements.length > 0);
  let highest = 0;
  for (const element of array.elements) {
    const entry = properties(frozen(element), ['version', 'statements']);
    requireThat(entry.version.type === 'NumericLiteral' && Number.isSafeInteger(entry.version.value) && entry.version.value > highest);
    requireThat(entry.statements.type === 'ArrayExpression' && entry.statements.elements.length > 0);
    for (const statement of entry.statements.elements) {
      requireThat(statement?.type === 'StringLiteral' ||
        (statement?.type === 'TemplateLiteral' && statement.expressions.length === 0));
      const value = statement.type === 'StringLiteral' ? statement.value : statement.quasis[0].value.cooked;
      requireThat(typeof value === 'string' && value.trim().length > 0);
    }
    highest = entry.version.value;
  }
  requireThat(exported.type === 'ExpressionStatement');
  const assignment = exported.expression;
  requireThat(assignment.type === 'AssignmentExpression' && assignment.operator === '=' && member(assignment.left, 'module', 'exports'));
  const exportedValue = properties(assignment.right, ['MYSQL_MIGRATIONS']).MYSQL_MIGRATIONS;
  requireThat(exportedValue.type === 'Identifier' && exportedValue.name === 'MYSQL_MIGRATIONS');
  return highest;
}
function createReleaseManifest({ releaseDir, gitSha } = {}) {
  try {
    checkSha(gitSha);
    checkRoot(releaseDir);
    checkedFile(releaseDir, 'scripts/start-production.js');
    checkedFile(releaseDir, 'dist/web/index.html');
    const pkg = JSON.parse(read(releaseDir, 'package.json'));
    requireThat(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version));
    return { schemaVersion: 1, gitSha, appVersion: pkg.version,
      mysqlSchemaVersion: schemaVersion(read(releaseDir, 'src/db/mysql-migrations.js')) };
  } catch { throw invalid(); }
}
function validateReleaseManifest({ releaseDir, expectedSha } = {}) {
  try {
    const expected = createReleaseManifest({ releaseDir, gitSha: expectedSha });
    const actual = JSON.parse(read(releaseDir, 'release-manifest.json'));
    requireThat(actual && typeof actual === 'object' && Object.keys(actual).length === 4);
    requireThat(Object.keys(expected).every(key => actual[key] === expected[key]));
    return expected;
  } catch { throw invalid(); }
}
function writeReleaseManifest(options) {
  const manifest = createReleaseManifest(options);
  try {
    fs.writeFileSync(path.join(options.releaseDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
    return manifest;
  } catch (error) {
    throw invalid(error.code === 'EEXIST' ? 'RELEASE_MANIFEST_EXISTS' : 'RELEASE_MANIFEST_INVALID');
  }
}
module.exports = { createReleaseManifest, validateReleaseManifest, writeReleaseManifest };
