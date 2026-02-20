/**
 * Feature flags for experimental and parallel pipelines.
 * All flags default to OFF unless explicitly enabled via environment variables.
 */
export const FLAGS = {
  /**
   * Enables the experimental Parser V4 pipeline.
   * When true, uploads will run V4 parsing in parallel (dual-write) after the
   * legacy parser completes. Legacy output is never altered.
   * Set PARSER_V4=true to enable.
   */
  PARSER_V4: process.env.PARSER_V4 === 'true',

  /**
   * Controls whether V4 parse results are persisted to ParseJob + ParseArtifact tables.
   * Only evaluated when PARSER_V4 is true.
   * Defaults to true (dual-write on). Set PARSE_DUAL_WRITE=false to disable persistence.
   */
  PARSE_DUAL_WRITE: process.env.PARSE_DUAL_WRITE !== 'false',

  /**
   * When true, V4 becomes the PRIMARY parser: its output populates the plan's
   * weeks/days/activities in the DB and the old per-week AI parser is skipped.
   * Requires PARSER_V4=true. Set PARSER_V4_PRIMARY=true to enable.
   */
  PARSER_V4_PRIMARY: process.env.PARSER_V4_PRIMARY === 'true'
} as const;
