import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tests/cloudflare-test-loader.mjs", pathToFileURL("./"));
