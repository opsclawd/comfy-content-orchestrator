export interface EvidenceLockSession {
  acquireCommandLock(actionId: string): Promise<void>;
  acquireSourceLock(sha256: string): Promise<void>;
}

export interface EvidenceLockCoordinatorPort {
  withSourceLock<T>(clientId: string, sha256: string, action: () => Promise<T>): Promise<T>;
  withCommandLock<T>(clientId: string, actionId: string, action: () => Promise<T>): Promise<T>;
  withLockSession<T>(
    clientId: string,
    action: (session: EvidenceLockSession) => Promise<T>
  ): Promise<T>;
}
