export const infrastructureName = "infrastructure";

export {
  runMigrations,
  type MigrationRunOptions,
  type AppliedMigration
} from "./postgres/migration-runner.js";
