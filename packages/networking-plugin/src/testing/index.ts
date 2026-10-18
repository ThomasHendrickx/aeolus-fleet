/**
 * `@aeolus-fleet/networking-plugin/testing`: what core's end-to-end tests need to run
 * the networking plugin beside the console in their own process (decision 0049): the app
 * and its database in core's shared Postgres container.
 */
export { createNetworkingPluginApp, type NetworkingPluginApp } from '../app.js';
export { createPluginDatabase } from './database.js';
