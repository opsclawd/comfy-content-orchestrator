import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

export interface StartedMinioContainer {
  readonly container: StartedTestContainer;
  getEndpoint(): string;
  getAccessKey(): string;
  getSecretKey(): string;
  stop(): Promise<void>;
}

export async function startMinioContainer(): Promise<StartedMinioContainer> {
  const accessKey = "minioadmin";
  const secretKey = "minioadmin";
  const port = 9000;

  const container = await new GenericContainer("minio/minio:RELEASE.2024-01-18T22-51-28Z")
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
      await container.stop();
    }
  };
}
