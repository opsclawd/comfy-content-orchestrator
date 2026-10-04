export class ProductionInputFingerprintMismatchError extends Error {
  override readonly name = "ProductionInputFingerprintMismatchError";
  readonly sceneId: string;
  readonly expectedFingerprint: string;
  readonly actualFingerprint: string;

  constructor(sceneId: string, expectedFingerprint: string, actualFingerprint: string) {
    super(
      `Production input fingerprint mismatch for scene '${sceneId}': expected '${expectedFingerprint}', but computed '${actualFingerprint}'.`
    );
    this.sceneId = sceneId;
    this.expectedFingerprint = expectedFingerprint;
    this.actualFingerprint = actualFingerprint;
  }
}
