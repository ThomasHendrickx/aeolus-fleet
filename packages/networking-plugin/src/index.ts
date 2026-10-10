/** The networking plugin package's entry: its app, for whoever runs or tests it beside the fleet. */
export { createNetworkingPluginApp, type NetworkingPluginApp } from './app.js';
export type { NetworkingPluginRouter } from './adapters/trpc/router.js';
