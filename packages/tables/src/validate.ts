import type { CustomTableFields, TableSpec, ValidationIssue } from "./types";

/**
 * Checks custom table fields against sane ranges. Errors block the table from being used;
 * warnings do not. Implemented by task 1.4.
 */
export const validateTable: (
  fields: CustomTableFields,
  ballDiameterM: number,
) => ValidationIssue[] = () => {
  throw new Error("not implemented");
};

/**
 * Turns custom fields into a full TableSpec by filling in derived defaults (jaw radius and
 * facing angle from the jaw style, drop circle, cushion nose height, restitution, friction).
 * Throws if `validateTable` reports an error. Implemented by task 1.4.
 */
export const resolveCustomTable: (
  fields: CustomTableFields,
  ballDiameterM: number,
) => TableSpec = () => {
  throw new Error("not implemented");
};
