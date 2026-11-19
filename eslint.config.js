import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const BANNED_MATH = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "pow",
  "exp",
  "expm1",
  "log",
  "log2",
  "log10",
  "log1p",
  "cbrt",
  "hypot",
];

const TRANSCENDENTAL_MSG =
  "Math transcendentals are not correctly rounded and may differ between JS engines, which would break deterministic simulation. Use Math.sqrt/abs/min/max/floor/ceil/round/trunc/sign or an in-repo implementation.";

/** Selector fragments shared by every physics purity rule. */
const physicsSyntax = [
  {
    selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
    message: `The ** operator is banned in physics: it maps to Math.pow, whose results can differ between JS engines. Use multiplication or Math.sqrt.`,
  },
  {
    selector: "NewExpression[callee.name='Date'], CallExpression[callee.name='Date']",
    message: "Date is banned in physics: wall-clock time makes the simulation non-deterministic.",
  },
  {
    selector: `VariableDeclarator[init.name='Math'] > ObjectPattern > Property[key.name=/^(${BANNED_MATH.join("|")}|random)$/]`,
    message: `Destructuring banned Math functions is not allowed in physics. ${TRANSCENDENTAL_MSG}`,
  },
  {
    selector: "MemberExpression[object.name='Math'][computed=true]",
    message:
      "Computed access on Math is banned in physics so banned functions cannot be reached indirectly. Use Math.<name> directly.",
  },
  {
    selector: "ImportDeclaration[source.value=/^[^.]/]",
    message:
      "Physics may only use relative imports (zero runtime dependencies, no UI or app code, no node:* APIs).",
  },
  {
    selector:
      "ExportAllDeclaration[source.value=/^[^.]/], ExportNamedDeclaration[source.value=/^[^.]/]",
    message: "Physics may only re-export from relative paths.",
  },
  {
    selector: "ImportExpression:not([source.value=/^[.]/])",
    message: "Physics may only dynamically import relative paths.",
  },
  {
    selector: "CallExpression[callee.name='require']",
    message: "Physics must not use require(); use relative ES imports only.",
  },
];

const physicsProperties = [
  {
    object: "Math",
    property: "random",
    message: "Math.random is banned in physics: the simulator must be deterministic.",
  },
  {
    object: "Date",
    property: "now",
    message:
      "Date.now is banned in physics: wall-clock time makes the simulation non-deterministic.",
  },
  {
    object: "performance",
    property: "now",
    message: "performance.now is banned in physics: timing makes the simulation non-deterministic.",
  },
  ...BANNED_MATH.map((property) => ({
    object: "Math",
    property,
    message: `Math.${property} is banned in physics. ${TRANSCENDENTAL_MSG}`,
  })),
];

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.vite/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["packages/physics/src/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", ...physicsProperties],
      "no-restricted-syntax": ["error", ...physicsSyntax],
    },
  },
  {
    // The planner follows the physics' determinism rules (the same route on every machine),
    // but may import the physics and tables packages.
    files: ["packages/planner/src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...physicsProperties.map((p) => ({
          ...p,
          message: p.message.replace("in physics", "in the planner"),
        })),
      ],
      "no-restricted-syntax": [
        "error",
        ...physicsSyntax
          .filter((s) => !/Import|Export|require/.test(s.selector))
          .map((s) => ({ ...s, message: s.message.replace("in physics", "in the planner") })),
        {
          selector:
            "ImportDeclaration[source.value=/^[^.]/][source.value!='@baize/physics'][source.value!='@baize/tables'], ExportAllDeclaration[source.value=/^[^.]/], ExportNamedDeclaration[source.value=/^[^.]/]",
          message: "The planner may import only relative paths, @baize/physics and @baize/tables.",
        },
        {
          selector: "ImportExpression:not([source.value=/^[.]/])",
          message: "The planner may only dynamically import relative paths.",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: "The planner must not use require(); use ES imports only.",
        },
      ],
      "no-restricted-globals": [
        "error",
        ...["fetch", "XMLHttpRequest", "WebSocket", "localStorage", "indexedDB", "document"].map(
          (name) => ({
            name,
            message: `${name} is banned in the planner: it works only on the positions it is given.`,
          }),
        ),
      ],
    },
  },
  {
    files: ["packages/tables/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value=/^[^.]/], ExportAllDeclaration[source.value=/^[^.]/], ExportNamedDeclaration[source.value=/^[^.]/]",
          message: "Tables has no dependencies: only relative imports are allowed.",
        },
        {
          selector: "ImportExpression:not([source.value=/^[.]/])",
          message: "Tables may only dynamically import relative paths.",
        },
      ],
    },
  },
  {
    files: ["packages/vision/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value=/^[^.]/][source.value!='@baize/tables'], ExportAllDeclaration[source.value=/^[^.]/], ExportNamedDeclaration[source.value=/^[^.]/]",
          message:
            "Vision may import only relative paths and @baize/tables: photos are processed in the browser with nothing else involved.",
        },
        {
          selector: "ImportExpression:not([source.value=/^[.]/])",
          message: "Vision may only dynamically import relative paths.",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: "Vision must not use require(); use relative ES imports only.",
        },
      ],
      "no-restricted-globals": [
        "error",
        ...[
          "fetch",
          "XMLHttpRequest",
          "WebSocket",
          "EventSource",
          "navigator",
          "localStorage",
          "sessionStorage",
          "indexedDB",
          "caches",
          "document",
          "window",
          "importScripts",
        ].map((name) => ({
          name,
          message: `${name} is banned in vision: a photo must never be uploaded or stored, and the package must not reach outside the pixels it is given.`,
        })),
      ],
      "no-restricted-properties": [
        "error",
        ...["fetch", "localStorage", "sessionStorage", "indexedDB", "caches", "navigator"].flatMap(
          (property) =>
            ["globalThis", "self"].map((object) => ({
              object,
              property,
              message: `${object}.${property} is banned in vision: a photo must never be uploaded or stored.`,
            })),
        ),
      ],
    },
  },
  prettier,
);
