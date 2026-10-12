/// <reference types="vite/client" />
import type { AuramApi } from '../../shared/ipc';

declare global {
  interface Window {
    /** Provided by the preload script. Undefined if the renderer runs outside Electron. */
    readonly auram?: AuramApi;
  }
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
