// Folder layout as pure string functions.
//
// Deliberately no `node:path` import: it would fail test/boundary.test.js, and every path
// this project builds is a POSIX-shaped, repository-relative string, so joining with '/' is
// both correct and testable. Anything that needs a real absolute path resolves these
// strings against the repository root in `shell/`, where the platform lives.

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MIN = 2;
const SLUG_MAX = 48;

// Recipe extensions are file-name fragments that end up in a spawn argument, so they are
// validated as tightly as slugs are rather than interpolated on trust.
const EXT_PATTERN = /^[a-z0-9]{1,8}$/;

/**
 * Validate a model slug.
 *
 * The reason string is shown to the user, so it names the rule that was broken rather than
 * the pattern that rejected it.
 *
 * @param {unknown} input
 * @returns {{ok: true, slug: string} | {ok: false, reason: string}}
 */
export function validateSlug(input) {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'A model name must be text.' };
  }
  if (input.length === 0) {
    return { ok: false, reason: 'A model name cannot be empty.' };
  }
  if (input.length < SLUG_MIN) {
    return {
      ok: false,
      reason: `A model name must be at least ${SLUG_MIN} characters long; "${input}" is ${input.length}.`,
    };
  }
  if (input.length > SLUG_MAX) {
    return {
      ok: false,
      reason: `A model name must be at most ${SLUG_MAX} characters long; that one is ${input.length}.`,
    };
  }
  if (!SLUG_PATTERN.test(input)) {
    return {
      ok: false,
      reason:
        `A model name may contain only lowercase letters, digits and single dashes between ` +
        `them, like "cable-clip"; "${input}" does not.`,
    };
  }
  return { ok: true, slug: input };
}

/**
 * The slug, or an exception. Every path function goes through this: a path builder that
 * returns something plausible for '..' is a traversal waiting for a caller who forgot to
 * validate, and `model pick` deletes directories.
 *
 * @param {unknown} input
 * @returns {string}
 */
function requireSlug(input) {
  const result = validateSlug(input);
  if (!result.ok) {
    throw new Error(`Invalid model name: ${result.reason}`);
  }
  return result.slug;
}

/** @param {unknown} ext @returns {string} extension with no leading dot */
function requireExt(ext) {
  const bare = typeof ext === 'string' && ext.startsWith('.') ? ext.slice(1) : ext;
  if (typeof bare !== 'string' || !EXT_PATTERN.test(bare)) {
    throw new Error(
      'Invalid recipe extension: expected 1-8 lowercase letters or digits, like "scad".',
    );
  }
  return bare;
}

/** @param {string} slug @returns {string} */
export function modelDir(slug) {
  return `models/${requireSlug(slug)}`;
}

/** @param {string} slug @returns {string} */
export function optionsDir(slug) {
  return `${modelDir(slug)}/options`;
}

/** @param {string} slug @returns {string} */
export function buildDir(slug) {
  return `.build/${requireSlug(slug)}`;
}

/** @param {string} slug @returns {string} */
export function notesPath(slug) {
  return `${modelDir(slug)}/NOTES.md`;
}

/**
 * The recipe. The extension is a parameter because the recipe language is a project-level
 * decision (OpenSCAD today, DESIGN.md §5.3) and the layout should not have to change if it
 * ever moves.
 *
 * @param {string} slug @param {string} [ext] with or without a leading dot
 * @returns {string}
 */
export function recipePath(slug, ext = 'scad') {
  return `${modelDir(slug)}/model.${requireExt(ext)}`;
}

/** @param {string} slug @returns {string} */
export function stlPath(slug) {
  return `${buildDir(slug)}/model.stl`;
}

/** @param {string} slug @returns {string} */
export function reportPath(slug) {
  return `${buildDir(slug)}/model.report.json`;
}

/** @param {string} slug @returns {string} */
export function hashPath(slug) {
  return `${buildDir(slug)}/model.hash`;
}

/**
 * Split a repository-relative POSIX path into its meaningful segments, resolving '.' and
 * '..' as it goes.
 *
 * @param {unknown} p
 * @returns {string[] | null} null if it is not repository-relative — absolute, empty, not a
 *   string, or climbing above the repository root.
 */
function segmentsOf(p) {
  if (typeof p !== 'string' || p.length === 0) return null;
  if (p.startsWith('/')) return null;
  const out = [];
  for (const segment of p.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out;
}

/**
 * True if `child` resolves to a location strictly inside `root`. Both are POSIX-shaped and
 * repository-relative.
 *
 * Compares resolved segments, never string prefixes: 'models/xy' starts with 'models/x' as
 * text and is not inside it. A path equal to `root` is not *inside* root and returns false;
 * callers that mean to accept the directory itself compare for equality separately, which is
 * what `model pick` does.
 *
 * @param {string} root @param {string} child
 * @returns {boolean}
 */
export function isInside(root, child) {
  const rootSegments = segmentsOf(root);
  const childSegments = segmentsOf(child);
  if (rootSegments === null || childSegments === null) return false;
  if (rootSegments.length === 0) return false;
  if (childSegments.length <= rootSegments.length) return false;
  return rootSegments.every((segment, i) => segment === childSegments[i]);
}
