import { describe, expect, it } from "vitest";
import type { UnitOfWork, UnitOfWorkContext } from "@cco/application";
import { createControlApiApp } from "./app.js";

describe("reviewer identity default security", () => {
  it("rejects an unconfigured review command before unit-of-work execution", async () => {
    let executionCount = 0;
    const uowSpy: UnitOfWork = {
      async execute<TResult>(
        _work: (context: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> {
        executionCount += 1;
        throw new Error(
          "UnitOfWork.execute should not be called when reviewer identity is unconfigured"
        );
      }
    };

    const app = createControlApiApp({ uow: uowSpy });

    const sceneId = "11111111-1111-4111-8111-111111111111";
    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId: "22222222-2222-4222-8222-222222222222",
        sceneId,
        expectedSpecRevision: 1,
        action: "reroll",
        payload: {}
      }
    });

    expect(response.statusCode).toBe(401);

    type ProspectiveErrorResponse = {
      code: string;
      message: string;
    };
    const body = response.json() as ProspectiveErrorResponse;
    expect(body).toEqual({
      code: "AUTHENTICATION_REQUIRED",
      message: "Reviewer identity could not be established."
    });
    expect(executionCount).toBe(0);

    await app.close();
  });
});
