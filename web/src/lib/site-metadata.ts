/** Site-wide <title> pieces shared by the root layout and nested layouts. */

export const SITE_TITLE = "NANDA Index - a global switchboard for the agentic web";

export const SITE_DESCRIPTION =
  "NandaIndex is a federated index of AI Catalog-formatted resolution records.";

/**
 * Appends the site name to a page title. Next applies a template only from
 * the nearest layout that defines one, so a nested layout that sets its own
 * title must pass this template on or its child routes lose the suffix.
 */
export const TITLE_TEMPLATE = "%s - NANDA Index";
