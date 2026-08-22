import { register } from 'node:module';

// Relative to this file, so it resolves regardless of the working directory.
register('./ts-ext-hook.mjs', import.meta.url);
