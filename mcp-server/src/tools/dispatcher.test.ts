import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../errors";
import { publicToolDefinitionsByName } from "../toolDefinitions";
import { ToolDispatcher } from "./dispatcher";
import type { ToolRegistry } from "./registry";

function createDispatcherForSyncLocalDb(): ToolDispatcher {
  const registry: ToolRegistry = new Map();
  registry.set("sync_local_db_from_dump", {
    definition: publicToolDefinitionsByName.sync_local_db_from_dump,
    handler: async (input) => input
  });
  return new ToolDispatcher(registry);
}

test("sync_local_db_from_dump rejects mixed db + file sync requests", async () => {
  const dispatcher = createDispatcherForSyncLocalDb();

  await assert.rejects(
    async () => {
      await dispatcher.dispatch({
        tool: "sync_local_db_from_dump",
        input: {
          dumpPath: "/Users/me/Downloads/live.sql.gz",
          uploadsPath: "/Users/me/site/wp-content/uploads"
        }
      });
    },
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "TOOL_INPUT_INVALID");
      assert.match(error.message, /database-only/iu);
      assert.match(error.message, /uploads\/media\/files/iu);
      return true;
    }
  );
});

