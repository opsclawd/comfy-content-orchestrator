export interface StagedComfyUiInput {
  readonly name: string;
  readonly subfolder: string;
}

export interface ComfyUiInputStagingPort {
  stage(input: {
    filename: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StagedComfyUiInput>;
  cleanup?(staged: StagedComfyUiInput): Promise<void>;
}
