import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: ["drizzle/**", ".next/**", "dist/**", "dist-app/**", "release/**", "private/**"] },
];

export default config;
