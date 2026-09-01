const fs = require('node:fs');
const path = require('node:path');

function unsafePath() {
  return new Error('unsafe path');
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function lstatExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function realPathIfExists(target) {
  if (!lstatExists(target)) return null;
  return fs.realpathSync(target);
}

function nearestExistingAncestor(target) {
  let current = target;
  while (!lstatExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function resolveWithinRoot(root, relativePath, options = {}) {
  if (typeof root !== 'string' || typeof relativePath !== 'string' ||
      root.includes('\0') || relativePath.includes('\0') ||
      relativePath.includes('\\') || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw unsafePath();
  }

  const lexicalRoot = path.resolve(root);
  const candidate = path.resolve(lexicalRoot, relativePath);
  if (!isWithinRoot(lexicalRoot, candidate)) {
    throw unsafePath();
  }

  if (options.extensions) {
    if (!Array.isArray(options.extensions) || !options.extensions.includes(path.extname(candidate))) {
      throw unsafePath();
    }
  }

  const realRoot = realPathIfExists(lexicalRoot);
  if (!realRoot) return candidate;

  const realCandidate = realPathIfExists(candidate);
  if (realCandidate) {
    if (!isWithinRoot(realRoot, realCandidate)) throw unsafePath();
  } else {
    const ancestor = nearestExistingAncestor(candidate);
    if (!ancestor) throw unsafePath();
    const realAncestor = fs.realpathSync(ancestor);
    if (!isWithinRoot(realRoot, realAncestor)) throw unsafePath();
  }

  return candidate;
}

function validateFileName(name) {
  if (typeof name !== 'string') throw new Error('unsafe file name');

  const normalized = name.normalize('NFC');
  if (!normalized || normalized === '.' || normalized === '..' ||
      /[\u0000-\u001f\u007f]/.test(normalized) ||
      normalized.includes('/') || normalized.includes('\\') ||
      path.basename(normalized) !== normalized || Buffer.byteLength(normalized, 'utf8') > 255) {
    throw new Error('unsafe file name');
  }

  return normalized;
}

module.exports = { resolveWithinRoot, validateFileName };
