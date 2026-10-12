import "dotenv/config";
import express from "express";
import net from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHealthRouter } from "./routes/health";
import { createProjectRouter } from "./routes/project";
import { type AppConfig } from "./config";
import { ConfigValidationError } from "./config";
import { loadResolvedConfig } from "./config";
import { AppError } from "./errors";
import { createPublicToolRegistry } from "./tools/registry";
import { ToolDispatcher } from "./tools/dispatcher";
import { jsonSchemaToZod } from "./tools/jsonSchemaToZod";
import { createProjectServices } from "./services";
import { wpRootLooksValid } from "./sandbox";

const version = "0.1.0";

function logStartup(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[wp-agent-mcp][startup][${timestamp}] ${message}`);
}

let config: AppConfig;
try {
  logStartup("Loading config from environment.");
  config = loadResolvedConfig();
} catch (error) {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

if (!wpRootLooksValid(config.wpRoot)) {
  console.error(
    `Invalid MCP server configuration:\n- WP_ROOT is not a valid WordPress root: ${config.wpRoot}\n- Expected \`wp-includes\` in WP_ROOT or \`wp-config.php\` in WP_ROOT (or its parent directory).`
  );
  process.exit(1);
}

logStartup(`Validated WP_ROOT at ${config.wpRoot}.`);

const app = express();
app.use(express.json());
app.use(createHealthRouter(version));

logStartup("Initializing service layer and public tool registry.");
const projectServices = createProjectServices({
  configuredWpRoot: config.wpRoot,
  wpCli: config.wpCli,
  phpBin: config.phpBin
});
const toolRegistry = createPublicToolRegistry(projectServices);
const toolDispatcher = new ToolDispatcher(toolRegistry);

logStartup(`Registered ${String(toolDispatcher.listTools().length)} public tools.`);
app.use(
  createProjectRouter({
    configuredWpRoot: config.wpRoot,
    wpCli: config.wpCli,
    phpBin: config.phpBin,
    services: projectServices,
    toolDispatcher
  })
);

type ListenError = NodeJS.ErrnoException & { code?: string };

function listenOnPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      server.removeListener("error", onError);
      resolve();
    });
    const onError = (error: ListenError): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Unable to resolve an open TCP port.")));
        return;
      }
      const { port } = address;
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startServer(): Promise<void> {
  const requestedPort = config.mcpPort;
  const hasExplicitPort = typeof process.env.MCP_PORT === "string" && process.env.MCP_PORT.trim().length > 0;
  let activePort = requestedPort;

  try {
    await listenOnPort(activePort);
  } catch (error) {
    const listenError = error as ListenError;
    if (listenError.code !== "EADDRINUSE") {
      throw error;
    }

    if (hasExplicitPort) {
      console.error(
        `Port ${String(requestedPort)} is already in use and MCP_PORT is explicitly set. Stop the existing process or choose a different MCP_PORT.`
      );
      process.exit(1);
      return;
    }

    const fallbackPort = await findOpenPort();
    activePort = fallbackPort;
    process.env.MCP_PORT = String(fallbackPort);
    logStartup(
      `Port ${String(requestedPort)} is already in use; automatically using open port ${String(fallbackPort)}.`
    );
    await listenOnPort(activePort);
  }

  logStartup(`Server listening on port ${activePort}.`);

  const mcpServer = new McpServer({
    name: "wp-agent-mcp",
    version
  });

  for (const definition of toolDispatcher.listTools()) {
    mcpServer.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: jsonSchemaToZod(definition.inputSchema)
      },
      async (rawArgs) => {
        try {
          const result = await toolDispatcher.dispatch({
            tool: definition.name,
            input: rawArgs as Record<string, unknown>
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.data, null, 2)
              }
            ],
            structuredContent: result.data
          };
        } catch (error) {
          if (error instanceof AppError) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      code: error.code,
                      message: error.message,
                      details: error.details
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
          const message = error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    code: "INTERNAL_ERROR",
                    message
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logStartup("MCP stdio transport connected.");
  logStartup("Startup complete. Expensive index work remains lazy until index tools are invoked.");
}

void startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
