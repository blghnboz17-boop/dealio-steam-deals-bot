import type { Plugin } from "@opencode-ai/plugin";

import { createHandoffPlugin } from "./handoff/runtime.js";

const handoffPlugin: Plugin = async (input) => createHandoffPlugin(input);

export default handoffPlugin;
export {
  createHandoffPlugin,
  type HandoffPluginDependencies,
  type HandoffPluginInput,
} from "./handoff/runtime.js";
