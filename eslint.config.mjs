import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: ["drizzle/**", ".next/**", "dist/**", "release/**", "private/**"] },
];

export default config;
