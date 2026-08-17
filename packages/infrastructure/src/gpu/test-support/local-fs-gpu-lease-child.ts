import { GpuLeaseUnavailableError } from "@cco/application";
import { LocalFsGpuLeaseAdapter } from "../local-fs-gpu-lease-adapter.js";

async function main(): Promise<void> {
  const mode = process.argv[2];
  const lockFilePath = process.argv[3];
  const holdDurationMs = process.argv[4] !== undefined ? Number(process.argv[4]) : 0;

  if (!mode || !lockFilePath) {
    process.stderr.write(
      "Usage: local-fs-gpu-lease-child <acquire|hold> <lockFilePath> [holdDurationMs]\n"
    );
    process.exit(1);
  }

  const adapter = new LocalFsGpuLeaseAdapter({ lockFilePath });

  try {
    const lease = await adapter.acquireLease();
    process.stdout.write(`${JSON.stringify({ status: "acquired", holder: lease.holder })}\n`);

    if (mode === "hold") {
      if (holdDurationMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, holdDurationMs));
        await lease.release();
        process.exit(0);
      } else {
        await new Promise<void>((resolve) => {
          process.on("SIGTERM", () => resolve());
          process.on("SIGINT", () => resolve());
        });
        await lease.release();
        process.exit(0);
      }
    } else {
      await lease.release();
      process.exit(0);
    }
  } catch (err: unknown) {
    if (err instanceof GpuLeaseUnavailableError) {
      process.stdout.write(`${JSON.stringify({ status: "unavailable", holder: err.holder })}\n`);
      process.exit(73);
    }
    process.stderr.write(`Unexpected error in child: ${String(err)}\n`);
    process.exit(1);
  }
}

void main();
