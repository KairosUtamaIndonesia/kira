import { verifyPassword } from "../../../node_modules/.bun/node_modules/@better-auth/utils/dist/password.node.mjs";

const hash =
  "0b20c8cd6b82e732410a183a4342d7e6:1c437708b92b4a02ca74f25f2af880eae1d652f896271e1bc5d00be141fe8f12c9c5ccfd66f2ef67241e55ca8ddd1c194dc7074417463513f91cb9786045a105";
const password = "kairos2026?!";

try {
  const result = await verifyPassword(hash, password);
  console.log("Password verification result:", result);
} catch (error) {
  console.error("Error:", error);
}
