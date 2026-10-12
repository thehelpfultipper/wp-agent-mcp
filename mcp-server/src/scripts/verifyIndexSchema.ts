import { getIndexPaths, getSchemaTables, initializeIndexAndGetStatus } from "../indexStore";
import { resolveWpRoot } from "../sandbox";

const REQUIRED_TABLES = [
  "blocks",
  "patterns",
  "templates",
  "content",
  "postmeta_index",
  "options_index",
  "menus_index"
];

function main(): void {
  const wpRootInput = process.argv[2] ?? process.env.WP_ROOT;
  const wpRoot = resolveWpRoot(wpRootInput);

  const status = initializeIndexAndGetStatus(wpRoot);
  const tables = getSchemaTables(wpRoot);
  const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));

  if (missing.length > 0) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "Missing required tables",
          missing,
          tables
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const paths = getIndexPaths(wpRoot);
  console.log(
    JSON.stringify(
      {
        ok: true,
        wpRoot,
        indexDir: paths.indexDir,
        dbPath: paths.dbPath,
        status,
        tables
      },
      null,
      2
    )
  );
}

main();
