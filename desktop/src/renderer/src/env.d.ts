/// <reference types="vite/client" />

import type { RevelioApi } from '../../shared/types';

declare global {
  interface Window {
    api: RevelioApi;
  }
}

export {};
