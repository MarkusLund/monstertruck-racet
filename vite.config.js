import { relayPlugin } from './server/relay.js';

// host: true gjør spillet tilgjengelig for andre maskiner på nettet (og via tunnel, derfor allowedHosts).
export default {
  plugins: [relayPlugin()],
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
};
