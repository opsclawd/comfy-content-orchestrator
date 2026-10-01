import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { S3AcceptanceReadinessProbe } from "./s3-acceptance-readiness-probe.js";

describe("S3AcceptanceReadinessProbe", () => {
  it("reports ok:true when HeadBucket succeeds", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send } as unknown as S3Client;

    const probe = new S3AcceptanceReadinessProbe({ bucket: "reference", client });
    const result = await probe.probe();

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports ok:false with a detail message when HeadBucket rejects", async () => {
    const send = vi.fn(async () => {
      throw new Error("NoSuchBucket");
    });
    const client = { send } as unknown as S3Client;

    const probe = new S3AcceptanceReadinessProbe({ bucket: "reference", client });
    const result = await probe.probe();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("NoSuchBucket");
  });
});
