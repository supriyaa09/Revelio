/**
 * Node ESM resolution hook for the test runner.
 *
 * App source uses extensionless relative imports (`./extract`), which is the
 * correct convention for TypeScript with bundler resolution and for Next's
 * webpack. Raw Node ESM requires an explicit extension, so rather than making
 * the application code less idiomatic to suit a test script, the test process
 * appends `.ts` on a failed relative resolution.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
    if (relative && !hasExtension) {
      return next(`${specifier}.ts`, context);
    }
    throw error;
  }
}
