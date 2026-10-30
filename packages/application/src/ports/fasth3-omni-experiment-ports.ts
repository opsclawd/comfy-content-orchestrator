export interface FastH3OmniFilesystemPort {
  ensureDirectory(dirPath: string): Promise<void>;
  assertSafeContainment(targetPath: string, allowedRoot: string): void;
  stageInputFile(sourcePath: string, targetPath: string, expectedSha256: string): Promise<void>;
  writeJson(filePath: string, data: unknown): Promise<void>;
  readJson<T>(filePath: string): Promise<T>;
  writeText(filePath: string, content: string): Promise<void>;
  readText(filePath: string): Promise<string>;
  computeFileSha256(filePath: string): Promise<string>;
  fileExists(filePath: string): Promise<boolean>;
  directoryExists(dirPath: string): Promise<boolean>;
}
