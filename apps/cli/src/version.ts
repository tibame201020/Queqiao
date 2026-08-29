declare const __QUEQIAO_VERSION__: string | undefined;

export const QUEQIAO_CLI_VERSION =
  typeof __QUEQIAO_VERSION__ !== "undefined"
    ? __QUEQIAO_VERSION__
    : process.env.npm_package_version || "0.0.0-dev";
