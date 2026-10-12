import { publicToolDefinitionsByName, type PublicToolDefinition } from "../toolDefinitions";
import type { ProjectServices } from "../services";
import { createConnectWordpressToolAdapter } from "./adapters/connectWordpress";
import { createBuildWpIndexToolAdapter, createGetIndexStatusToolAdapter } from "./adapters/indexTools";
import { createSyncLocalDbFromDumpToolAdapter } from "./adapters/localDbSync";
import {
  createApplyPatchToolAdapter,
  createAuditComponentToolAdapter,
  createFindSimilarContentToolAdapter,
  createQueryWpDbReadonlyToolAdapter,
  createReadProjectFileToolAdapter,
  createSearchProjectFilesToolAdapter,
  createWhereIsUsedToolAdapter
} from "./adapters/endpointTools";
import {
  createBridgeDesignToImplementationToolAdapter,
  createGetDesignBridgeReadinessToolAdapter,
  createGetThemeProfileToolAdapterDirect
} from "./adapters/designBridgeTools";

// Some tools still use endpoint-backed adapters during migration.
// Tool invocation remains the preferred public interface.
export type ToolInvokeInput = Record<string, unknown>;
export type ToolInvokeResult = Record<string, unknown>;
export type ToolHandler = (input: ToolInvokeInput) => ToolInvokeResult | Promise<ToolInvokeResult>;

export type ToolRegistration = {
  definition: PublicToolDefinition;
  handler: ToolHandler;
};

export type ToolRegistry = Map<string, ToolRegistration>;

function requireToolDefinition(toolName: string): PublicToolDefinition {
  const definition = publicToolDefinitionsByName[toolName];
  if (!definition) {
    throw new Error(`Missing public tool definition for "${toolName}"`);
  }
  return definition;
}

export function createPublicToolRegistry(services: ProjectServices): ToolRegistry {
  const registry: ToolRegistry = new Map();

  registry.set("connect_wordpress", {
    definition: requireToolDefinition("connect_wordpress"),
    handler: createConnectWordpressToolAdapter(services)
  });

  registry.set("build_wp_index", {
    definition: requireToolDefinition("build_wp_index"),
    handler: createBuildWpIndexToolAdapter(services)
  });

  registry.set("get_index_status", {
    definition: requireToolDefinition("get_index_status"),
    handler: createGetIndexStatusToolAdapter(services)
  });

  registry.set("sync_local_db_from_dump", {
    definition: requireToolDefinition("sync_local_db_from_dump"),
    handler: createSyncLocalDbFromDumpToolAdapter(services)
  });

  registry.set("get_theme_profile", {
    definition: requireToolDefinition("get_theme_profile"),
    handler: createGetThemeProfileToolAdapterDirect(services)
  });

  registry.set("get_design_bridge_readiness", {
    definition: requireToolDefinition("get_design_bridge_readiness"),
    handler: createGetDesignBridgeReadinessToolAdapter(services)
  });

  registry.set("bridge_design_to_implementation", {
    definition: requireToolDefinition("bridge_design_to_implementation"),
    handler: createBridgeDesignToImplementationToolAdapter(services)
  });

  registry.set("audit_component", {
    definition: requireToolDefinition("audit_component"),
    handler: createAuditComponentToolAdapter(services)
  });

  registry.set("find_similar_content", {
    definition: requireToolDefinition("find_similar_content"),
    handler: createFindSimilarContentToolAdapter(services)
  });

  registry.set("where_is_used", {
    definition: requireToolDefinition("where_is_used"),
    handler: createWhereIsUsedToolAdapter(services)
  });

  registry.set("query_wp_db_readonly", {
    definition: requireToolDefinition("query_wp_db_readonly"),
    handler: createQueryWpDbReadonlyToolAdapter(services)
  });

  registry.set("apply_patch", {
    definition: requireToolDefinition("apply_patch"),
    handler: createApplyPatchToolAdapter(services)
  });

  registry.set("read_project_file", {
    definition: requireToolDefinition("read_project_file"),
    handler: createReadProjectFileToolAdapter(services)
  });

  registry.set("search_project_files", {
    definition: requireToolDefinition("search_project_files"),
    handler: createSearchProjectFilesToolAdapter(services)
  });

  return registry;
}

