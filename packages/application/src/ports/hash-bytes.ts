export interface HashBytesPort {
  readonly hashBytes: (bytes: Uint8Array) => Promise<string>;
}
