import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
  type StopOptions
} from "testcontainers";

export interface StartedMinioContainer {
  readonly container: StartedTestContainer;
  getEndpoint(): string;
  getAccessKey(): string;
  getSecretKey(): string;
  stop(): Promise<void>;
}

async function stopContainerSafely(container: {
  stop: (options?: Partial<StopOptions>) => Promise<unknown>;
}): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await container.stop();
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const is409 =
        msg.includes("409") ||
        msg.includes("cannot remove container") ||
        msg.includes("is running");
      const is404 = msg.includes("404") || msg.includes("No such container");

      if (is404) {
        return;
      }
      if (is409 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
        continue;
      }
      if (is409) {
        try {
          await container.stop({ remove: false });
          return;
        } catch {
          return;
        }
      }
      throw err;
    }
  }
}

export async function startMinioContainer(): Promise<StartedMinioContainer> {
  const accessKey = "minioadmin";
  const secretKey = "minioadmin";
  const port = 9000;

  const container = await new GenericContainer("cgr.dev/chainguard/minio:latest")
    .withEnvironment({
      MINIO_ROOT_USER: accessKey,
      MINIO_ROOT_PASSWORD: secretKey
    })
    .withCommand(["server", "/data"])
    .withExposedPorts(port)
    .withWaitStrategy(Wait.forHttp("/minio/health/ready", port).forStatusCode(200))
    .start();

  const mappedPort = container.getMappedPort(port);
  const host = container.getHost();
  const endpoint = `http://${host}:${mappedPort}`;

  return {
    container,
    getEndpoint: () => endpoint,
    getAccessKey: () => accessKey,
    getSecretKey: () => secretKey,
    stop: async () => {
      await stopContainerSafely(container);
    }
  };
}
